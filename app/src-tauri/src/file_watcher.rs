use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub const FILE_WATCHER_ERROR_EVENT: &str = "spec-ops/fs/watcher-error";

pub const FILE_CHANGED_EVENT: &str = "spec-ops/fs/file-changed";

/// Directory names skipped by the project-tree recursive watch emit path.
///
/// Mirrors the frontend `SKIPPED_DIRECTORY_NAMES` set so a recursive root watch
/// does not flood IPC with every `.git`/`node_modules`/build-artifact rewrite.
const IGNORED_WATCH_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "__pycache__",
];

/// Coarse filesystem-event kind emitted alongside each watched path.
/// Consumers use this to apply incremental catalog invalidation safely
/// (e.g. remove entries for a deleted file) and fall back to a full
/// rebuild when the kind cannot be classified locally.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum FileChangeKind {
    Create,
    Remove,
    Modify,
    Rename,
    Other,
}

impl From<EventKind> for FileChangeKind {
    fn from(kind: EventKind) -> Self {
        match kind {
            EventKind::Create(_) => FileChangeKind::Create,
            EventKind::Remove(_) => FileChangeKind::Remove,
            EventKind::Modify(notify::event::ModifyKind::Name(_)) => FileChangeKind::Rename,
            EventKind::Modify(_) => FileChangeKind::Modify,
            EventKind::Any | EventKind::Access(_) | EventKind::Other => FileChangeKind::Other,
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct FileChangedPayload {
    path: String,
    kind: FileChangeKind,
}

/// One entry in the shared canonical→original map.
///
/// The two watch sets (`sync_file_watcher_paths` for individual files and
/// `sync_project_tree_watcher` for a recursive workspace root) share a single
/// canonical→original map so the debounce callback can rewrite emitted paths
/// back to the frontend's registered form. A canonical target can be claimed by
/// more than one registration — a file watched by path whose canonical form
/// equals the recursive root, or two frontend paths that canonicalize to the
/// same target. Removing it from one set must not delete the mapping while the
/// other still records it as watched, so each canonical path carries a reference
/// count and is only evicted when the last registrant goes away (F39).
#[derive(Clone)]
struct CanonicalEntry {
    /// The frontend-registered path notify's canonical event path should be
    /// rewritten to. When several originals map to the same canonical, the most
    /// recently registered one wins (any of them produces a path the frontend
    /// recognises; they all resolve to the same file on disk).
    original: String,
    /// Number of live registrations across both watch sets.
    refcount: usize,
}

#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WatcherHealth {
    last_error: Option<String>,
    last_event_at: Option<u64>,
    last_tree_sync_at: Option<u64>,
}

fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub struct FileWatcherState {
    /// `Arc` so an async command can clone the handle into a `spawn_blocking`
    /// task without borrowing the non-`'static` Tauri `State` reference (F43).
    inner: Arc<Mutex<FileWatcherInner>>,
}

struct FileWatcherInner {
    debouncer: Option<Debouncer<notify::RecommendedWatcher, FileIdMap>>,
    /// Paths as the frontend registered them (not necessarily canonical).
    watched_paths: HashSet<String>,
    file_paths_by_window: HashMap<String, HashSet<String>>,
    tree_roots_by_window: HashMap<String, HashSet<String>>,
    project_tree_roots: HashSet<String>,
    /// `frontend path → canonical path` actually passed to notify.
    original_to_canonical: HashMap<String, String>,
    /// Shared with the debounce callback so emitted paths can be rewritten
    /// back to the frontend's registered form (notify often returns the
    /// canonical symlink-resolved path, e.g. `/private/tmp/...` on macOS).
    ///
    /// Reference-counted so a canonical target claimed by both watch sets is
    /// only evicted once the last registrant is removed (F39).
    canonical_to_original: Arc<Mutex<HashMap<String, CanonicalEntry>>>,
    app_handle: Option<AppHandle>,
    restart_requested: Arc<AtomicBool>,
    health: Arc<Mutex<WatcherHealth>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(FileWatcherInner {
                debouncer: None,
                watched_paths: HashSet::new(),
                file_paths_by_window: HashMap::new(),
                tree_roots_by_window: HashMap::new(),
                project_tree_roots: HashSet::new(),
                original_to_canonical: HashMap::new(),
                canonical_to_original: Arc::new(Mutex::new(HashMap::new())),
                app_handle: None,
                restart_requested: Arc::new(AtomicBool::new(false)),
                health: Arc::new(Mutex::new(WatcherHealth::default())),
            })),
        }
    }

    pub fn set_app_handle(&self, app_handle: AppHandle) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.app_handle = Some(app_handle);
        }
    }
}

/// Best-effort canonicalize. Falls back to the input when the path does not
/// exist yet or cannot be resolved — callers still need to watch something.
fn canonicalize_path_string(path: &str) -> String {
    PathBuf::from(path)
        .canonicalize()
        .map(|resolved| resolved.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string())
}

/// True when `name` matches one of the heavy/ignored directory names, case-insensitively.
fn name_is_ignored_dir(name: &str) -> bool {
    IGNORED_WATCH_DIR_NAMES
        .iter()
        .any(|ignored| name.eq_ignore_ascii_case(ignored))
}

/// True when `path` has an ignored directory component *strictly below* one of
/// the registered canonical `roots`.
///
/// The previous check ran against the whole absolute path, so a workspace whose
/// path merely contained `build`, `dist`, `target`, `.git` or `.venv` —
/// `~/dev/dist/site`, `~/Documents/Build/proj` — had every file-change event
/// dropped, silently killing external-change detection and project-tree refresh
/// (F37). Only components below a watched root should be filtered: a root like
/// `/Users/me/Build/project` is the user's workspace, not a build artifact.
fn path_has_ignored_component_below_roots(path: &Path, roots: &[&str]) -> bool {
    // Find the longest registered root that is an ancestor of (or equal to) the
    // event path. Only components strictly below it count as workspace-internal.
    let mut best_root_len = None;
    for root in roots {
        let matches = path.as_os_str() == std::ffi::OsStr::new(root) || {
            let root_path = Path::new(root);
            path.starts_with(root_path)
        };
        if matches {
            let len = root.len();
            match best_root_len {
                None => best_root_len = Some(len),
                Some(current) if len > current => best_root_len = Some(len),
                _ => {}
            }
        }
    }

    let Some(root_len) = best_root_len else {
        // No registered root is an ancestor — the event is for something we are
        // not watching. Drop it; the frontend has no document under it anyway.
        return true;
    };

    // Examine only the suffix below the matched root. The root's own components
    // (which may legitimately contain an ignored name) are excluded.
    let path_str = path.to_string_lossy();
    let suffix = if path_str.len() == root_len {
        ""
    } else {
        // Skip the separator after the root prefix, if present.
        let after = &path_str[root_len..];
        after
            .strip_prefix(std::path::MAIN_SEPARATOR)
            .unwrap_or(after)
    };

    Path::new(suffix).components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(name_is_ignored_dir)
    })
}

/// Rewrite a notify-emitted path so it uses the frontend-registered root prefix.
///
/// Without this, a workspace rooted at `/tmp/proj` (symlink → `/private/tmp/proj`)
/// receives events under `/private/tmp/...` that never match document paths.
fn rewrite_emit_path(
    path: &Path,
    canonical_to_original: &HashMap<String, CanonicalEntry>,
) -> String {
    let raw = path.to_string_lossy();
    let candidate = path
        .canonicalize()
        .map(|resolved| resolved.to_string_lossy().into_owned())
        .unwrap_or_else(|_| raw.clone().into_owned());

    let mut best: Option<(usize, &str, &str)> = None;
    for (canonical, entry) in canonical_to_original {
        if candidate == *canonical
            || candidate.starts_with(&format!("{canonical}/"))
            || candidate.starts_with(&format!("{canonical}\\"))
        {
            let replace = match best {
                None => true,
                Some((len, _, _)) => canonical.len() > len,
            };
            if replace {
                best = Some((canonical.len(), canonical.as_str(), entry.original.as_str()));
            }
        }
    }

    if let Some((_, canonical, original)) = best {
        if candidate.len() == canonical.len() {
            return original.to_string();
        }
        return format!("{original}{}", &candidate[canonical.len()..]);
    }

    raw.into_owned()
}

fn event_path_for_frontend(path: &Path, map: &HashMap<String, CanonicalEntry>) -> Option<String> {
    let canonical_roots: Vec<&str> = map.keys().map(String::as_str).collect();
    if path_has_ignored_component_below_roots(path, &canonical_roots) {
        return None;
    }
    let rewritten = rewrite_emit_path(path, map);
    let original_roots: Vec<&str> = map.values().map(|entry| entry.original.as_str()).collect();
    if path_has_ignored_component_below_roots(Path::new(&rewritten), &original_roots) {
        return None;
    }
    Some(rewritten)
}

fn discard_failed_debouncer(inner: &mut FileWatcherInner) {
    if inner.restart_requested.swap(false, Ordering::AcqRel) {
        // The callback never locks `inner`, so stopping its worker here cannot
        // deadlock. Keep window contributions and rebuild their actual watches.
        inner.debouncer.take();
        inner.watched_paths.clear();
        inner.project_tree_roots.clear();
        inner.original_to_canonical.clear();
        if let Ok(mut map) = inner.canonical_to_original.lock() {
            map.clear();
        }
    }
}

fn ensure_debouncer(inner: &mut FileWatcherInner) -> Result<(), String> {
    discard_failed_debouncer(inner);
    if inner.debouncer.is_some() {
        return Ok(());
    }

    let app_handle = inner
        .app_handle
        .clone()
        .ok_or_else(|| "File watcher app handle is not initialized".to_string())?;
    let canonical_to_original = Arc::clone(&inner.canonical_to_original);
    let restart_requested = Arc::clone(&inner.restart_requested);
    let health = Arc::clone(&inner.health);

    let debouncer = new_debouncer(
        Duration::from_millis(200),
        None,
        move |result: DebounceEventResult| {
            let events = match result {
                Ok(events) => events,
                Err(errors) => {
                    let message = errors
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join("; ");
                    log::warn!("file watcher event failure: {message}");
                    if let Ok(mut health) = health.lock() {
                        health.last_error = Some(message);
                    }
                    if !restart_requested.swap(true, Ordering::AcqRel) {
                        let _ = app_handle.emit(FILE_WATCHER_ERROR_EVENT, ());
                    }
                    return;
                }
            };

            let rewrite_map = canonical_to_original
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_default();
            for event in events {
                // An overflow can carry no paths. Ask the frontend to reconcile
                // the tree and re-arm watches rather than treating it as a no-op.
                if event.need_rescan() {
                    if let Ok(mut health) = health.lock() {
                        health.last_error = Some("Filesystem events require a rescan".to_string());
                    }
                    if !restart_requested.swap(true, Ordering::AcqRel) {
                        let _ = app_handle.emit(FILE_WATCHER_ERROR_EVENT, ());
                    }
                }
                let kind = FileChangeKind::from(event.kind);
                for path in &event.paths {
                    let Some(path_str) = event_path_for_frontend(path, &rewrite_map) else {
                        continue;
                    };
                    if let Ok(mut health) = health.lock() {
                        health.last_event_at = Some(timestamp_millis());
                    }
                    let _ = app_handle.emit(
                        FILE_CHANGED_EVENT,
                        FileChangedPayload {
                            path: path_str,
                            kind,
                        },
                    );
                }
            }
        },
    )
    .map_err(|error| error.to_string())?;

    inner.debouncer = Some(debouncer);
    reconcile_registered_paths(inner);
    Ok(())
}

fn compute_watcher_path_diff(
    watched_paths: &HashSet<String>,
    next_paths: &HashSet<String>,
) -> (Vec<String>, Vec<String>) {
    let to_remove: Vec<String> = watched_paths.difference(next_paths).cloned().collect();
    let to_add: Vec<String> = next_paths.difference(watched_paths).cloned().collect();
    (to_remove, to_add)
}

/// Decrement the refcount for `canonical` in the shared map, evicting the entry
/// only when the last registrant is removed. Returns `true` if the entry was
/// evicted (so the caller knows notify no longer has a watch it can rewrite).
///
/// F39: the two watch sets share one canonical→original map. A canonical target
/// claimed by both (a file path that canonicalizes to the recursive root, or two
/// originals that resolve to the same file) must not be evicted while the other
/// set still references it — otherwise the surviving watch's emitted events lose
/// their rewrite and the frontend never sees the change.
fn release_canonical_entry(map: &mut HashMap<String, CanonicalEntry>, canonical: &str) -> bool {
    let Some(entry) = map.get_mut(canonical) else {
        return false;
    };
    if entry.refcount > 1 {
        entry.refcount -= 1;
        false
    } else {
        map.remove(canonical);
        true
    }
}

/// Register or bump the refcount for `canonical` → `original` in the shared map.
fn register_canonical_entry(
    map: &mut HashMap<String, CanonicalEntry>,
    canonical: &str,
    original: &str,
) {
    match map.get_mut(canonical) {
        Some(entry) => {
            entry.refcount += 1;
            // The most recently registered original wins; all originals resolve
            // to the same on-disk target, so any of them rewrites correctly.
            entry.original = original.to_string();
        }
        None => {
            map.insert(
                canonical.to_string(),
                CanonicalEntry {
                    original: original.to_string(),
                    refcount: 1,
                },
            );
        }
    }
}

/// For a freshly-registered recursive root, best-effort stop watching its heavy
/// subdirectories so notify does not install a watch per ignored dir (inotify
/// watch exhaustion on Linux, FSEvents churn on macOS) and the file-ID cache
/// walk does not stat every entry under `.git`/`node_modules`/`target`.
///
/// notify's `unwatch` of a subpath of a recursive watch is backend-specific: it
/// removes the per-directory inotify watch on Linux and is a harmless no-op on
/// backends that stream the whole tree (FSEvents, Windows). The authoritative
/// filter remains the root-aware emit check (`path_has_ignored_component_below_roots`),
/// so a backend that ignores the `unwatch` still drops those events before IPC.
fn prune_ignored_subdirectories(
    debouncer: &mut Debouncer<notify::RecommendedWatcher, FileIdMap>,
    root_canonical: &str,
) {
    let root_path = Path::new(root_canonical);
    let Ok(entries) = std::fs::read_dir(root_path) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if !name_is_ignored_dir(name_str) {
            continue;
        }
        let subdir = entry.path();
        if let Err(error) = debouncer.watcher().unwatch(&subdir) {
            log::debug!(
                "file watcher could not prune ignored subdir {} (non-fatal; emit filter applies): {error}",
                subdir.display()
            );
        }
        // Drop the ignored subtree from the file-ID cache too, mirroring the
        // unwatch. Best-effort: a missing root is expected here.
        debouncer.cache().remove_root(subdir);
    }
}

/// Apply a watch/unwatch diff and return the set the watcher actually holds afterwards.
///
/// Every path is attempted even when an earlier one fails, and the returned set reflects
/// reality rather than intent. The previous version used `?` inside the loops and
/// assigned the bookkeeping set only after both had completed, so a single failing path
/// — routine, since notify errors when asked to watch something that does not exist, and
/// tracked files do get deleted — leaked the watches already registered in that call,
/// discarded the removals, and left every later sync aborting at the same path. External
/// change detection and project-tree refresh then stayed broken for the rest of the
/// session, signalled only by a rejected IPC promise.
///
/// A failed `unwatch` still drops the path from the set: notify's usual error here is
/// "not watched", and retrying it forever would be worse than leaking one watcher. A
/// failed `watch` is left out of the set so the next sync retries it, which is what makes
/// a file that appears later start being watched.
///
/// Paths are canonicalized before being handed to notify, and the
/// original→canonical mapping is kept (reference-counted across both watch sets)
/// so emitted events can be rewritten back to the frontend-registered form.
fn apply_watcher_path_diff(
    debouncer: &mut Debouncer<notify::RecommendedWatcher, FileIdMap>,
    previous: &HashSet<String>,
    next_paths: &HashSet<String>,
    mode: RecursiveMode,
    original_to_canonical: &mut HashMap<String, String>,
    canonical_to_original: &Mutex<HashMap<String, CanonicalEntry>>,
) -> HashSet<String> {
    let (to_remove, to_add) = compute_watcher_path_diff(previous, next_paths);
    let mut watched = previous.clone();

    for path in to_remove {
        let canonical = original_to_canonical
            .remove(&path)
            .unwrap_or_else(|| path.clone());
        let evicted = canonical_to_original
            .lock()
            .map(|mut map| release_canonical_entry(&mut map, &canonical))
            .unwrap_or(false);
        // Only unw+drop the notify watch when the last registrant for this
        // canonical target has gone away (F39). A surviving registration in the
        // other watch set still needs the watch live to receive its events.
        if evicted {
            if let Err(error) = debouncer
                .watcher()
                .unwatch(PathBuf::from(&canonical).as_path())
            {
                log::debug!("file watcher unwatch failed for {canonical}: {error}");
            }
            debouncer.cache().remove_root(PathBuf::from(&canonical));
        }
        watched.remove(&path);
    }

    for path in to_add {
        let canonical = canonicalize_path_string(&path);
        match debouncer
            .watcher()
            .watch(PathBuf::from(&canonical).as_path(), mode)
        {
            Ok(()) => {
                // The FileIdMap cache (`add_root`) walks and stats every entry
                // under a recursive root to build rename-correlation state.
                // This app does not rely on FileIdMap rename tracking — the
                // debounce callback rewrites emitted paths via the
                // `canonical_to_original` map and filters ignored subtrees via
                // `path_has_ignored_component_below_roots`, neither of which
                // needs the FileIdMap. Registering the cache only for individual
                // file paths (NonRecursive) skips the 10^4–10^5 stats per
                // workspace switch that `add_root(Recursive)` performs.
                if matches!(mode, RecursiveMode::NonRecursive) {
                    debouncer.cache().add_root(PathBuf::from(&canonical), mode);
                }
                // F38: prune heavy subdirectories at registration so notify does
                // not install per-dir watches (or stat every entry) under
                // `.git`/`node_modules`/`target`. Only meaningful for a recursive
                // root; for individual files `read_dir` finds nothing.
                if matches!(mode, RecursiveMode::Recursive) {
                    prune_ignored_subdirectories(debouncer, &canonical);
                }
                original_to_canonical.insert(path.clone(), canonical.clone());
                if let Ok(mut map) = canonical_to_original.lock() {
                    register_canonical_entry(&mut map, &canonical, &path);
                }
                watched.insert(path);
            }
            Err(error) => {
                log::warn!("file watcher watch failed for {path} (canonical {canonical}): {error}");
            }
        }
    }

    watched
}

/// Reconcile both consumers after watcher recovery, preserving all windows.
fn reconcile_registered_paths(inner: &mut FileWatcherInner) {
    let files = union_contributions(&inner.file_paths_by_window);
    let roots = union_contributions(&inner.tree_roots_by_window);
    let Some(debouncer) = inner.debouncer.as_mut() else {
        return;
    };
    inner.watched_paths = apply_watcher_path_diff(
        debouncer,
        &inner.watched_paths,
        &files,
        RecursiveMode::NonRecursive,
        &mut inner.original_to_canonical,
        &inner.canonical_to_original,
    );
    inner.project_tree_roots = apply_watcher_path_diff(
        debouncer,
        &inner.project_tree_roots,
        &roots,
        RecursiveMode::Recursive,
        &mut inner.original_to_canonical,
        &inner.canonical_to_original,
    );
}

/// Sync the set of individually-watched file paths.
///
/// Marked `async` (F43): `watch()`/`unwatch()` are blocking calls, and on macOS
/// each one stops the FSEvents run-loop thread and recreates the whole stream
/// with all N paths — so a large diff holds the watcher mutex (and the main
/// thread, since this was previously a sync command) for the full duration.
/// Running the diff in `spawn_blocking` keeps the main/IPC thread free to
/// service file reads and session-lock IPC while the watch set is reconciled.
#[tauri::command(async)]
pub async fn sync_file_watcher_paths(
    paths: Vec<String>,
    window: WebviewWindow,
    state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    // Clone the Arc handle out of the borrowed `State` so the blocking task is
    // `'static` and can run on the blocking-pool without escaping the lifetime
    // of the IPC reference.
    let window_id = window.label().to_string();
    let app_handle = window.app_handle().clone();
    let inner = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = inner.lock().map_err(|error| error.to_string())?;

        if app_handle.get_webview_window(&window_id).is_none() {
            return Ok(());
        }
        ensure_debouncer(&mut guard)?;

        // One deref of the guard, so the disjoint `debouncer` / `watched_paths` field
        // borrows below are accepted.
        let inner = &mut *guard;
        inner
            .file_paths_by_window
            .insert(window_id, paths.into_iter().collect());
        let next_paths = union_contributions(&inner.file_paths_by_window);
        let previous = std::mem::take(&mut inner.watched_paths);

        let Some(debouncer) = inner.debouncer.as_mut() else {
            // Put the bookkeeping back before bailing so state still matches the watcher.
            inner.watched_paths = previous;
            return Err("File watcher debouncer is not initialized".to_string());
        };

        let next_watched = apply_watcher_path_diff(
            debouncer,
            &previous,
            &next_paths,
            RecursiveMode::NonRecursive,
            &mut inner.original_to_canonical,
            &inner.canonical_to_original,
        );
        inner.watched_paths = next_watched;
        Ok(())
    })
    .await
    .map_err(|error| format!("file watcher path sync task failed: {error}"))?
}

/// Register the recursive project-tree watch for every open workspace root.
///
/// Watching all open roots (not just the active one) means a workspace switch
/// is a diff — add the newly-opened root, remove the closed one — instead of
/// unwatching the old root and re-walking/re-stat'ing the new root on every
/// switch (the FSEvents/inotify cost of `add_root(Recursive)` + the ignored-
/// subdir prune).
///
/// Marked `async` (F43): registering a recursive root walks and stats every
/// entry under it (the ignored-subdir prune), so a large workspace would
/// otherwise block the UI/main thread for the whole walk.
#[tauri::command(async)]
pub async fn sync_project_tree_watcher(
    roots: Vec<String>,
    window: WebviewWindow,
    state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    // Clone the Arc handle out of the borrowed `State` so the blocking task is
    // `'static` and can run on the blocking-pool without escaping the lifetime
    // of the IPC reference.
    let window_id = window.label().to_string();
    let app_handle = window.app_handle().clone();
    let inner = Arc::clone(&state.inner);
    // Move the blocking diff onto a dedicated thread so the main thread is not
    // held while the file-ID cache walks the workspace tree.
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = inner.lock().map_err(|error| error.to_string())?;

        if app_handle.get_webview_window(&window_id).is_none() {
            return Ok(());
        }
        ensure_debouncer(&mut guard)?;

        let inner = &mut *guard;
        inner
            .tree_roots_by_window
            .insert(window_id, roots.into_iter().collect());
        let next_roots = union_contributions(&inner.tree_roots_by_window);
        let previous = std::mem::take(&mut inner.project_tree_roots);

        let Some(debouncer) = inner.debouncer.as_mut() else {
            inner.project_tree_roots = previous;
            return Err("File watcher debouncer is not initialized".to_string());
        };

        let next_watched = apply_watcher_path_diff(
            debouncer,
            &previous,
            &next_roots,
            RecursiveMode::Recursive,
            &mut inner.original_to_canonical,
            &inner.canonical_to_original,
        );
        inner.project_tree_roots = next_watched;
        record_tree_registration_result(inner, &next_roots)
    })
    .await
    .map_err(|error| format!("project tree watcher task failed: {error}"))?
}

fn record_tree_registration_result(
    inner: &FileWatcherInner,
    requested: &HashSet<String>,
) -> Result<(), String> {
    let mut missing: Vec<_> = requested
        .difference(&inner.project_tree_roots)
        .cloned()
        .collect();
    missing.sort();
    if !missing.is_empty() {
        let message = format!("Could not watch project roots: {}", missing.join(", "));
        if let Ok(mut health) = inner.health.lock() {
            health.last_error = Some(message.clone());
        }
        return Err(message);
    }
    if let Ok(mut health) = inner.health.lock() {
        health.last_error = None;
        health.last_tree_sync_at = Some(timestamp_millis());
    }
    Ok(())
}

fn union_contributions(contributions: &HashMap<String, HashSet<String>>) -> HashSet<String> {
    contributions
        .values()
        .flat_map(|paths| paths.iter().cloned())
        .collect()
}
/// Closing one webview must not remove resources still owned by another window.
pub fn window_destroyed(app: &AppHandle, label: &str) {
    let inner = Arc::clone(&app.state::<FileWatcherState>().inner);
    let label = label.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(mut guard) = inner.lock() else {
            return;
        };
        let inner = &mut *guard;
        inner.file_paths_by_window.remove(&label);
        inner.tree_roots_by_window.remove(&label);
        let files = union_contributions(&inner.file_paths_by_window);
        let roots = union_contributions(&inner.tree_roots_by_window);
        if let Some(debouncer) = inner.debouncer.as_mut() {
            inner.watched_paths = apply_watcher_path_diff(
                debouncer,
                &inner.watched_paths,
                &files,
                RecursiveMode::NonRecursive,
                &mut inner.original_to_canonical,
                &inner.canonical_to_original,
            );
            inner.project_tree_roots = apply_watcher_path_diff(
                debouncer,
                &inner.project_tree_roots,
                &roots,
                RecursiveMode::Recursive,
                &mut inner.original_to_canonical,
                &inner.canonical_to_original,
            );
        }
    });
}
#[tauri::command(async)]
pub async fn get_file_watcher_diagnostics(
    state: State<'_, FileWatcherState>,
) -> Result<serde_json::Value, String> {
    let shared = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
    let inner = shared.lock().map_err(|error| error.to_string())?;
    let mut files: Vec<_> = inner.watched_paths.iter().cloned().collect(); files.sort();
    let mut roots: Vec<_> = inner.project_tree_roots.iter().cloned().collect(); roots.sort();
    Ok(serde_json::json!({"filePathCount": files.len(), "filePaths": files, "projectRootCount": roots.len(), "projectRoots": roots,
        "fileWindowCount": inner.file_paths_by_window.values().filter(|paths| !paths.is_empty()).count(),
        "treeWindowCount": inner.tree_roots_by_window.values().filter(|paths| !paths.is_empty()).count(),
        "requestedProjectRoots": union_contributions(&inner.tree_roots_by_window),
        "restartRequested": inner.restart_requested.load(Ordering::Acquire),
        "health": inner.health.lock().ok().map(|health| serde_json::to_value(&*health).unwrap_or_default())}))
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event as nev;
    use std::collections::HashSet;

    fn set(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|path| (*path).to_string()).collect()
    }

    fn test_debouncer() -> Debouncer<notify::RecommendedWatcher, FileIdMap> {
        new_debouncer(
            Duration::from_millis(200),
            None,
            |_result: DebounceEventResult| {},
        )
        .expect("create debouncer")
    }

    /// Regression: one unwatchable path used to abort the whole sync via `?` before the
    /// bookkeeping set was assigned, so the watches registered earlier in the same call
    /// leaked, the removals were forgotten, and every later sync aborted at the same
    /// path — external-change detection silently died for the session.
    #[test]
    fn apply_diff_keeps_going_past_a_failing_path() {
        let mut debouncer = test_debouncer();
        let existing = std::env::temp_dir();
        let existing_path = existing.to_string_lossy().into_owned();
        let missing_path = existing
            .join("spec-ops-watcher-does-not-exist-1a2b3c")
            .to_string_lossy()
            .into_owned();
        let mut original_to_canonical = HashMap::new();
        let canonical_to_original = Mutex::new(HashMap::<String, CanonicalEntry>::new());

        // The missing path is listed first so a failure there would, under the old
        // behaviour, prevent the real path from ever being watched.
        let next = set(&[missing_path.as_str(), existing_path.as_str()]);
        let watched = apply_watcher_path_diff(
            &mut debouncer,
            &set(&[]),
            &next,
            RecursiveMode::NonRecursive,
            &mut original_to_canonical,
            &canonical_to_original,
        );

        assert!(
            watched.contains(&existing_path),
            "a watchable path must still be registered after an earlier failure"
        );
        assert!(
            !watched.contains(&missing_path),
            "a path that failed to watch must stay out of the set so the next sync retries it"
        );
        assert!(
            original_to_canonical.contains_key(&existing_path),
            "canonical mapping must be recorded for successfully watched paths"
        );

        // And the state is usable afterwards: removing the good path works.
        let after = apply_watcher_path_diff(
            &mut debouncer,
            &watched,
            &set(&[]),
            RecursiveMode::NonRecursive,
            &mut original_to_canonical,
            &canonical_to_original,
        );
        assert!(after.is_empty());
        assert!(original_to_canonical.is_empty());
        assert!(canonical_to_original.lock().expect("lock").is_empty());
    }

    /// Watching multiple recursive roots must not unwatch the first when the
    /// second is added — a workspace switch is now a diff, not a full unwatch +
    /// rewatch. Without this, every switch paid the full `add_root(Recursive)`
    /// walk cost again (the P03-08-11 regression class).
    #[test]
    fn apply_diff_recursive_multi_root_keeps_existing_roots() {
        let mut debouncer = test_debouncer();
        let tmp = std::env::temp_dir();
        let root_a = tmp
            .join("spec-ops-watcher-multiroot-a")
            .to_string_lossy()
            .into_owned();
        let root_b = tmp
            .join("spec-ops-watcher-multiroot-b")
            .to_string_lossy()
            .into_owned();
        std::fs::create_dir_all(&root_a).ok();
        std::fs::create_dir_all(&root_b).ok();

        let mut original_to_canonical = HashMap::new();
        let canonical_to_original = Mutex::new(HashMap::<String, CanonicalEntry>::new());

        // Register the first root.
        let after_first = apply_watcher_path_diff(
            &mut debouncer,
            &set(&[]),
            &set(&[root_a.as_str()]),
            RecursiveMode::Recursive,
            &mut original_to_canonical,
            &canonical_to_original,
        );
        assert!(after_first.contains(&root_a));

        // Add the second root without removing the first.
        let after_second = apply_watcher_path_diff(
            &mut debouncer,
            &after_first,
            &set(&[root_a.as_str(), root_b.as_str()]),
            RecursiveMode::Recursive,
            &mut original_to_canonical,
            &canonical_to_original,
        );
        assert!(
            after_second.contains(&root_a),
            "adding a second recursive root must not unwatch the first"
        );
        assert!(after_second.contains(&root_b));

        // Removing the second root keeps the first watched.
        let after_remove_second = apply_watcher_path_diff(
            &mut debouncer,
            &after_second,
            &set(&[root_a.as_str()]),
            RecursiveMode::Recursive,
            &mut original_to_canonical,
            &canonical_to_original,
        );
        assert!(after_remove_second.contains(&root_a));
        assert!(!after_remove_second.contains(&root_b));
    }

    #[test]
    fn diff_empty_to_paths_adds_all() {
        let (to_remove, to_add) = compute_watcher_path_diff(&set(&[]), &set(&["/a", "/b"]));
        assert!(to_remove.is_empty());
        assert_eq!(to_add.len(), 2);
        assert!(to_add.contains(&"/a".to_string()));
        assert!(to_add.contains(&"/b".to_string()));
    }

    #[test]
    fn diff_paths_to_empty_removes_all() {
        let (to_remove, to_add) = compute_watcher_path_diff(&set(&["/a", "/b"]), &set(&[]));
        assert!(to_add.is_empty());
        assert_eq!(to_remove.len(), 2);
    }

    #[test]
    fn diff_unchanged_set_has_no_changes() {
        let current = set(&["/a", "/b"]);
        let (to_remove, to_add) = compute_watcher_path_diff(&current, &current);
        assert!(to_remove.is_empty());
        assert!(to_add.is_empty());
    }

    #[test]
    fn diff_partial_update() {
        let watched = set(&["/a", "/b"]);
        let next = set(&["/b", "/c"]);
        let (to_remove, to_add) = compute_watcher_path_diff(&watched, &next);
        assert_eq!(to_remove, vec!["/a".to_string()]);
        assert_eq!(to_add, vec!["/c".to_string()]);
    }

    #[test]
    fn file_changed_payload_serializes_path_and_kind() {
        let payload = FileChangedPayload {
            path: "/tmp/example.txt".to_string(),
            kind: FileChangeKind::Create,
        };
        let value = serde_json::to_value(&payload).expect("serialize payload");
        assert_eq!(value["path"], "/tmp/example.txt");
        assert_eq!(value["kind"], "create");
    }

    #[test]
    fn file_change_kind_maps_from_event_kind() {
        assert_eq!(
            FileChangeKind::from(EventKind::Create(nev::CreateKind::Any)),
            FileChangeKind::Create
        );
        assert_eq!(
            FileChangeKind::from(EventKind::Remove(nev::RemoveKind::Any)),
            FileChangeKind::Remove
        );
        assert_eq!(
            FileChangeKind::from(EventKind::Modify(nev::ModifyKind::Name(
                nev::RenameMode::Any
            ))),
            FileChangeKind::Rename
        );
        assert_eq!(
            FileChangeKind::from(EventKind::Modify(nev::ModifyKind::Data(
                nev::DataChange::Any
            ))),
            FileChangeKind::Modify
        );
        assert_eq!(FileChangeKind::from(EventKind::Any), FileChangeKind::Other);
    }

    /// F37: the ignore filter must only consider components *below* a registered
    /// root. A workspace path that happens to contain `build`/`dist`/`target`/
    /// `.git`/`.venv` (e.g. `~/dev/dist/site`, `~/Documents/Build/proj`) used to
    /// have 100% of its events dropped because the filter ran against the whole
    /// absolute path.
    #[test]
    fn ignored_filter_is_root_aware() {
        // Root whose own path contains an ignored name — must NOT be filtered.
        let build_root = ["/Users/me/Documents/Build/proj"];
        assert!(
            !path_has_ignored_component_below_roots(
                Path::new("/Users/me/Documents/Build/proj/src/main.rs"),
                &build_root,
            ),
            "an ignored name in a root's own ancestor path must not drop events"
        );
        assert!(
            !path_has_ignored_component_below_roots(
                Path::new("/Users/me/Documents/Build/proj/build.rs"),
                &build_root,
            ),
            "a file literally named like an ignored dir, but directly under the root, must pass"
        );

        // An ignored dir strictly below a root must still be filtered.
        let proj_root = ["/proj"];
        assert!(path_has_ignored_component_below_roots(
            Path::new("/proj/.git/HEAD"),
            &proj_root,
        ));
        assert!(path_has_ignored_component_below_roots(
            Path::new("/proj/node_modules/x"),
            &proj_root,
        ));
        assert!(path_has_ignored_component_below_roots(
            Path::new("/proj/target/debug"),
            &proj_root,
        ));
        assert!(!path_has_ignored_component_below_roots(
            Path::new("/proj/src/main.rs"),
            &proj_root,
        ));

        // A path with no registered root as an ancestor is dropped (not watched).
        assert!(path_has_ignored_component_below_roots(
            Path::new("/elsewhere/.git/config"),
            &proj_root,
        ));
    }

    #[test]
    fn frontend_event_paths_validate_each_root_spelling_and_ignore_heavy_dirs() {
        let mut map = HashMap::new();
        register_canonical_entry(&mut map, "/private/tmp/proj", "/tmp/proj");
        assert_eq!(
            event_path_for_frontend(Path::new("/private/tmp/proj/new.txt"), &map),
            Some("/tmp/proj/new.txt".into())
        );
        assert_eq!(
            event_path_for_frontend(Path::new("/private/tmp/proj/node_modules/x"), &map),
            None
        );
        assert_eq!(
            event_path_for_frontend(Path::new("/unrelated/new.txt"), &map),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn recursive_watch_delivers_new_file_under_symlinked_root() {
        let directory =
            std::env::temp_dir().join(format!("specops-watch-live-{}", std::process::id()));
        std::fs::create_dir_all(directory.join("actual")).unwrap();
        std::os::unix::fs::symlink(directory.join("actual"), directory.join("alias")).unwrap();
        let root = directory.join("alias").to_string_lossy().into_owned();
        let map = Arc::new(Mutex::new(HashMap::new()));
        let callback_map = Arc::clone(&map);
        let (send, receive) = std::sync::mpsc::channel();
        let mut debouncer = new_debouncer(
            Duration::from_millis(200),
            None,
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    let map = callback_map.lock().unwrap();
                    for event in events {
                        for path in &event.paths {
                            if let Some(path) = event_path_for_frontend(path, &map) {
                                let _ = send.send(path);
                            }
                        }
                    }
                }
            },
        )
        .unwrap();
        let watched = apply_watcher_path_diff(
            &mut debouncer,
            &HashSet::new(),
            &set(&[&root]),
            RecursiveMode::Recursive,
            &mut HashMap::new(),
            &map,
        );
        assert_eq!(watched, set(&[&root]));
        let expected = format!("{root}/new.txt");
        std::fs::write(&expected, "new file").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let path = receive
                .recv_timeout(remaining)
                .expect("new file event must reach the frontend using its registered root");
            if path == expected {
                break;
            }
        }
        drop(debouncer);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn watcher_recovery_restores_document_and_tree_watches_from_all_windows() {
        let directory =
            std::env::temp_dir().join(format!("specops-watch-recovery-{}", std::process::id()));
        std::fs::create_dir_all(directory.join("first")).unwrap();
        std::fs::create_dir_all(directory.join("second")).unwrap();
        let document = directory.join("first/note.txt");
        std::fs::write(&document, "test").unwrap();
        let first = directory.join("first").to_string_lossy().into_owned();
        let second = directory.join("second").to_string_lossy().into_owned();
        let document = document.to_string_lossy().into_owned();
        let state = FileWatcherState::new();
        {
            let mut inner = state.inner.lock().unwrap();
            inner.debouncer = Some(test_debouncer());
            inner
                .file_paths_by_window
                .insert("first".into(), set(&[&document]));
            inner
                .tree_roots_by_window
                .insert("first".into(), set(&[&first]));
            inner
                .tree_roots_by_window
                .insert("second".into(), set(&[&second]));
            reconcile_registered_paths(&mut inner);
            inner.restart_requested.store(true, Ordering::Release);
            discard_failed_debouncer(&mut inner);
            assert!(inner.debouncer.is_none());
            assert!(inner.project_tree_roots.is_empty());
            assert!(inner.watched_paths.is_empty());
            assert!(inner.canonical_to_original.lock().unwrap().is_empty());
            inner.debouncer = Some(test_debouncer());
            reconcile_registered_paths(&mut inner);
            assert_eq!(inner.project_tree_roots, set(&[&first, &second]));
            assert_eq!(inner.watched_paths, set(&[&document]));
            assert_eq!(inner.canonical_to_original.lock().unwrap().len(), 3);
        }
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn missing_tree_root_reports_failure_and_retries_after_it_appears() {
        let directory =
            std::env::temp_dir().join(format!("specops-watch-retry-{}", std::process::id()));
        let root = directory.join("missing").to_string_lossy().into_owned();
        let state = FileWatcherState::new();
        {
            let mut inner = state.inner.lock().unwrap();
            inner.debouncer = Some(test_debouncer());
            inner
                .tree_roots_by_window
                .insert("first".into(), set(&[&root]));
            reconcile_registered_paths(&mut inner);
            assert!(record_tree_registration_result(&inner, &set(&[&root])).is_err());
            assert!(inner.health.lock().unwrap().last_error.is_some());
            std::fs::create_dir_all(&root).unwrap();
            reconcile_registered_paths(&mut inner);
            assert!(record_tree_registration_result(&inner, &set(&[&root])).is_ok());
            assert!(inner.health.lock().unwrap().last_error.is_none());
            assert!(inner.health.lock().unwrap().last_tree_sync_at.is_some());
        }
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rewrite_emit_path_swaps_canonical_prefix() {
        let mut map = HashMap::new();
        map.insert(
            "/private/tmp/proj".to_string(),
            CanonicalEntry {
                original: "/tmp/proj".to_string(),
                refcount: 1,
            },
        );
        assert_eq!(
            rewrite_emit_path(Path::new("/private/tmp/proj/src/a.ts"), &map),
            "/tmp/proj/src/a.ts"
        );
        assert_eq!(
            rewrite_emit_path(Path::new("/private/tmp/proj"), &map),
            "/tmp/proj"
        );
        assert_eq!(
            rewrite_emit_path(Path::new("/other/path"), &map),
            "/other/path"
        );
    }

    /// F39: the canonical→original map is reference-counted. Registering the
    /// same canonical target from two originals bumps the count; removing one
    /// must not evict the entry while the other survives.
    #[test]
    fn canonical_entry_refcount_keeps_entry_until_last_release() {
        let mut map = HashMap::<String, CanonicalEntry>::new();
        let canonical = "/private/tmp/proj";

        register_canonical_entry(&mut map, canonical, "/tmp/proj");
        register_canonical_entry(&mut map, canonical, "/symlink/to/proj");
        assert_eq!(map.get(canonical).expect("entry").refcount, 2);

        // First release: entry survives, serving the remaining registrant.
        assert!(!release_canonical_entry(&mut map, canonical));
        assert!(map.contains_key(canonical));

        // Second release: entry is evicted.
        assert!(release_canonical_entry(&mut map, canonical));
        assert!(map.is_empty());

        // Releasing a missing entry is a no-op (not a panic).
        assert!(!release_canonical_entry(&mut map, canonical));
    }
    #[test]
    fn per_window_contributions_keep_other_window_paths_on_clear_and_close() {
        let mut owners = HashMap::from([
            ("first".to_string(), set(&["/first", "/shared"])),
            ("second".to_string(), set(&["/second", "/shared"])),
        ]);
        assert_eq!(
            union_contributions(&owners),
            set(&["/first", "/second", "/shared"])
        );
        owners.insert("first".into(), HashSet::new());
        assert_eq!(union_contributions(&owners), set(&["/second", "/shared"]));
        owners.remove("first");
        assert_eq!(union_contributions(&owners), set(&["/second", "/shared"]));
        owners.remove("second");
        assert!(union_contributions(&owners).is_empty());
    }

    #[test]
    fn registered_watch_sets_release_only_the_closed_window_contribution() {
        let directory =
            std::env::temp_dir().join(format!("specops-watch-owners-{}", std::process::id()));
        let first = directory.join("first");
        let second = directory.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let first = first.to_string_lossy().into_owned();
        let second = second.to_string_lossy().into_owned();
        for mode in [RecursiveMode::NonRecursive, RecursiveMode::Recursive] {
            let mut debouncer = test_debouncer();
            let mut originals = HashMap::new();
            let canonical = Mutex::new(HashMap::new());
            let mut contributions = HashMap::from([
                ("first".to_string(), set(&[&first])),
                ("second".to_string(), set(&[&second])),
            ]);
            let watched = apply_watcher_path_diff(
                &mut debouncer,
                &HashSet::new(),
                &union_contributions(&contributions),
                mode,
                &mut originals,
                &canonical,
            );
            assert_eq!(watched, set(&[&first, &second]));
            contributions.remove("first");
            let watched = apply_watcher_path_diff(
                &mut debouncer,
                &watched,
                &union_contributions(&contributions),
                mode,
                &mut originals,
                &canonical,
            );
            assert_eq!(watched, set(&[&second]));
            assert_eq!(originals.len(), 1);
            contributions.remove("second");
            let watched = apply_watcher_path_diff(
                &mut debouncer,
                &watched,
                &union_contributions(&contributions),
                mode,
                &mut originals,
                &canonical,
            );
            assert!(watched.is_empty());
            assert!(originals.is_empty());
            assert!(canonical.lock().unwrap().is_empty());
        }
        let _ = std::fs::remove_dir_all(directory);
    }
}
