use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

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

pub struct FileWatcherState {
    inner: Mutex<FileWatcherInner>,
}

struct FileWatcherInner {
    debouncer: Option<Debouncer<notify::RecommendedWatcher, FileIdMap>>,
    /// Paths as the frontend registered them (not necessarily canonical).
    watched_paths: HashSet<String>,
    project_tree_roots: HashSet<String>,
    /// `frontend path → canonical path` actually passed to notify.
    original_to_canonical: HashMap<String, String>,
    /// Shared with the debounce callback so emitted paths can be rewritten
    /// back to the frontend's registered form (notify often returns the
    /// canonical symlink-resolved path, e.g. `/private/tmp/...` on macOS).
    canonical_to_original: Arc<Mutex<HashMap<String, String>>>,
    app_handle: Option<AppHandle>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(FileWatcherInner {
                debouncer: None,
                watched_paths: HashSet::new(),
                project_tree_roots: HashSet::new(),
                original_to_canonical: HashMap::new(),
                canonical_to_original: Arc::new(Mutex::new(HashMap::new())),
                app_handle: None,
            }),
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

/// True when any path component is a heavy/ignored directory name.
fn path_has_ignored_component(path: &Path) -> bool {
    path.components().any(|component| {
        let Some(name) = component.as_os_str().to_str() else {
            return false;
        };
        IGNORED_WATCH_DIR_NAMES
            .iter()
            .any(|ignored| name.eq_ignore_ascii_case(ignored))
    })
}

/// Rewrite a notify-emitted path so it uses the frontend-registered root prefix.
///
/// Without this, a workspace rooted at `/tmp/proj` (symlink → `/private/tmp/proj`)
/// receives events under `/private/tmp/...` that never match document paths.
fn rewrite_emit_path(path: &Path, canonical_to_original: &HashMap<String, String>) -> String {
    let raw = path.to_string_lossy();
    let candidate = path
        .canonicalize()
        .map(|resolved| resolved.to_string_lossy().into_owned())
        .unwrap_or_else(|_| raw.clone().into_owned());

    let mut best: Option<(usize, &str, &str)> = None;
    for (canonical, original) in canonical_to_original {
        if candidate == *canonical
            || candidate.starts_with(&format!("{canonical}/"))
            || candidate.starts_with(&format!("{canonical}\\"))
        {
            let replace = match best {
                None => true,
                Some((len, _, _)) => canonical.len() > len,
            };
            if replace {
                best = Some((canonical.len(), canonical.as_str(), original.as_str()));
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

fn ensure_debouncer(inner: &mut FileWatcherInner) -> Result<(), String> {
    if inner.debouncer.is_some() {
        return Ok(());
    }

    let app_handle = inner
        .app_handle
        .clone()
        .ok_or_else(|| "File watcher app handle is not initialized".to_string())?;
    let canonical_to_original = Arc::clone(&inner.canonical_to_original);

    let debouncer = new_debouncer(
        Duration::from_millis(200),
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };

            let rewrite_map = canonical_to_original
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_default();

            for event in events {
                let kind = FileChangeKind::from(event.kind);
                for path in &event.paths {
                    if path_has_ignored_component(path) {
                        continue;
                    }
                    let path_str = rewrite_emit_path(path, &rewrite_map);
                    // Re-check after rewrite in case the original form still
                    // contains an ignored segment the canonical path did too.
                    if path_has_ignored_component(Path::new(&path_str)) {
                        continue;
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
    Ok(())
}

fn compute_watcher_path_diff(
    watched_paths: &HashSet<String>,
    next_paths: &HashSet<String>,
) -> (Vec<String>, Vec<String>) {
    let to_remove: Vec<String> = watched_paths
        .difference(next_paths)
        .cloned()
        .collect();
    let to_add: Vec<String> = next_paths
        .difference(watched_paths)
        .cloned()
        .collect();
    (to_remove, to_add)
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
/// original→canonical mapping is kept so emitted events can be rewritten back
/// to the frontend-registered form.
fn apply_watcher_path_diff(
    debouncer: &mut Debouncer<notify::RecommendedWatcher, FileIdMap>,
    previous: &HashSet<String>,
    next_paths: &HashSet<String>,
    mode: RecursiveMode,
    original_to_canonical: &mut HashMap<String, String>,
    canonical_to_original: &Mutex<HashMap<String, String>>,
) -> HashSet<String> {
    let (to_remove, to_add) = compute_watcher_path_diff(previous, next_paths);
    let mut watched = previous.clone();

    for path in to_remove {
        let canonical = original_to_canonical
            .remove(&path)
            .unwrap_or_else(|| path.clone());
        if let Ok(mut map) = canonical_to_original.lock() {
            map.remove(&canonical);
        }
        if let Err(error) = debouncer.watcher().unwatch(PathBuf::from(&canonical).as_path()) {
            log::debug!("file watcher unwatch failed for {canonical}: {error}");
        }
        // Keep the file-ID cache in sync so rename From/To pairs can still be
        // correlated for the remaining roots (notify-debouncer-full requires
        // `cache().add_root` alongside `watcher().watch`).
        debouncer.cache().remove_root(PathBuf::from(&canonical));
        watched.remove(&path);
    }

    for path in to_add {
        let canonical = canonicalize_path_string(&path);
        match debouncer
            .watcher()
            .watch(PathBuf::from(&canonical).as_path(), mode)
        {
            Ok(()) => {
                debouncer
                    .cache()
                    .add_root(PathBuf::from(&canonical), mode);
                original_to_canonical.insert(path.clone(), canonical.clone());
                if let Ok(mut map) = canonical_to_original.lock() {
                    map.insert(canonical, path.clone());
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

#[tauri::command]
pub fn sync_file_watcher_paths(
    paths: Vec<String>,
    state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?;

    ensure_debouncer(&mut guard)?;

    // One deref of the guard, so the disjoint `debouncer` / `watched_paths` field
    // borrows below are accepted.
    let inner = &mut *guard;
    let next_paths: HashSet<String> = paths.into_iter().collect();
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
}

#[tauri::command]
pub fn sync_project_tree_watcher(
    root: Option<String>,
    state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?;

    ensure_debouncer(&mut guard)?;

    let inner = &mut *guard;
    let next_roots: HashSet<String> = root.into_iter().collect();
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
    Ok(())
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
        new_debouncer(Duration::from_millis(200), None, |_result: DebounceEventResult| {})
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
        let canonical_to_original = Mutex::new(HashMap::new());

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

    #[test]
    fn ignored_components_match_heavy_dirs() {
        assert!(path_has_ignored_component(Path::new("/proj/.git/HEAD")));
        assert!(path_has_ignored_component(Path::new("/proj/node_modules/x")));
        assert!(path_has_ignored_component(Path::new("/proj/target/debug")));
        assert!(path_has_ignored_component(Path::new("/proj/build/out")));
        assert!(path_has_ignored_component(Path::new("/proj/dist/bundle.js")));
        assert!(!path_has_ignored_component(Path::new("/proj/src/main.rs")));
        assert!(!path_has_ignored_component(Path::new("/proj/src/build.rs")));
    }

    #[test]
    fn rewrite_emit_path_swaps_canonical_prefix() {
        let mut map = HashMap::new();
        map.insert(
            "/private/tmp/proj".to_string(),
            "/tmp/proj".to_string(),
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
}
