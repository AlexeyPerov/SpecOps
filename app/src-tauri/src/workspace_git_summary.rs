//! App-wide coordination for compact Git readers. Git execution remains in `git`.
use crate::git::{self, RunGitRequest, RunGitResponse};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, WebviewWindow};

const EVENT: &str = "spec-ops/workspace-git-summary";
const LIMIT: usize = 4;
const CACHE_LIMIT: usize = 128;
const TTL: u64 = 60_000;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[derive(Clone, Debug)]
struct Layout {
    root: PathBuf,
    git_dir: Option<PathBuf>,
    common_dir: Option<PathBuf>,
}
fn layout(path: &str) -> Layout {
    let path = canonical(Path::new(path));
    for root in path.ancestors() {
        let marker = root.join(".git");
        let git_dir = if marker.is_dir() {
            Some(canonical(&marker))
        } else {
            std::fs::read_to_string(&marker).ok().and_then(|text| {
                text.trim()
                    .strip_prefix("gitdir:")
                    .map(str::trim)
                    .map(|dir| canonical(&root.join(dir)))
            })
        };
        if let Some(git_dir) = git_dir {
            let common_dir = std::fs::read_to_string(git_dir.join("commondir"))
                .ok()
                .map(|value| canonical(&git_dir.join(value.trim())))
                .unwrap_or_else(|| git_dir.clone());
            return Layout {
                root: root.to_path_buf(),
                git_dir: Some(git_dir),
                common_dir: Some(common_dir),
            };
        }
    }
    Layout {
        root: path,
        git_dir: None,
        common_dir: None,
    }
}
fn key(layout: &Layout) -> String {
    layout.root.to_string_lossy().into_owned()
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Demand {
    root_path: String,
    priority: u8,
}
#[derive(Clone)]
struct Entry {
    layout: Layout,
    summary: Option<Value>,
    checked_at: Option<u64>,
    error: Option<String>,
    not_git: bool,
    last_attempt: u64,
    touched: u64,
    revision: u64,
    completed_revision: u64,
    pending: bool,
    debounce: bool,
}
impl Entry {
    fn new(layout: Layout) -> Self {
        Self {
            layout,
            summary: None,
            checked_at: None,
            error: None,
            not_git: false,
            last_attempt: 0,
            touched: now(),
            revision: 0,
            completed_revision: 0,
            pending: false,
            debounce: false,
        }
    }
    fn needs_read(&self) -> bool {
        self.last_attempt == 0
            || self.revision != self.completed_revision
            || now().saturating_sub(self.last_attempt) >= TTL
    }
    fn snapshot(&self, refreshing: bool) -> Value {
        let status = if self.error.is_some() {
            "error"
        } else if self.last_attempt == 0 {
            if refreshing {
                "loading"
            } else {
                "unknown"
            }
        } else if self.needs_read() {
            "stale"
        } else if self.not_git {
            "notGit"
        } else {
            "fresh"
        };
        json!({"status":status,"refreshing":refreshing,"summary":self.summary,"checkedAt":self.checked_at,"error":self.error})
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    key: String,
    root_path: String,
    lease: String,
    revision: u64,
    window: String,
}
struct Lease {
    grant: Grant,
    commands: usize,
    revoked: bool,
}
#[derive(Default)]
struct Coordinator {
    entries: HashMap<String, Entry>,
    demands: HashMap<String, Vec<(String, String, u8)>>,
    leases: HashMap<String, Lease>,
    sequence: u64,
    publication: u64,
    watcher: Option<notify::RecommendedWatcher>,
    watched: HashMap<PathBuf, bool>,
}
static STATE: OnceLock<Mutex<Coordinator>> = OnceLock::new();
fn coordinator() -> &'static Mutex<Coordinator> {
    STATE.get_or_init(|| Mutex::new(Coordinator::default()))
}
impl Coordinator {
    fn begin_command(&mut self, lease: &str, window: &str) -> Result<(), String> {
        let active = self.leases.get_mut(lease).ok_or("Expired summary lease")?;
        if active.revoked || active.grant.window != window {
            return Err("Revoked summary lease".into());
        }
        if active.commands != 0 {
            return Err("Summary lease already has a subprocess".into());
        }
        active.commands += 1;
        Ok(())
    }
    fn end_command(&mut self, lease: &str) {
        if let Some(active) = self.leases.get_mut(lease) {
            active.commands = active.commands.saturating_sub(1);
            if active.commands == 0 && active.revoked {
                let key = active.grant.key.clone();
                self.leases.remove(lease);
                if let Some(entry) = self.entries.get_mut(&key) {
                    entry.pending = true;
                }
            }
        }
    }
    fn drop_window(&mut self, window: &str) {
        self.demands.remove(window);
        let mut orphaned = Vec::new();
        self.leases.retain(|_, active| {
            if active.grant.window != window {
                return true;
            }
            active.revoked = true;
            if active.commands == 0 {
                orphaned.push(active.grant.key.clone());
            }
            active.commands != 0
        });
        for key in orphaned {
            if let Some(entry) = self.entries.get_mut(&key) {
                entry.pending = true;
            }
        }
    }
    fn finish(
        &mut self,
        window: &str,
        lease: &str,
        revision: u64,
        summary: Option<Value>,
        error: Option<String>,
        not_git: bool,
    ) -> Result<(), String> {
        let Some(active) = self.leases.get(lease) else {
            return Ok(());
        };
        if active.grant.window != window || active.grant.revision != revision {
            return Err("Invalid summary lease".into());
        }
        if active.commands != 0 {
            return Err("Summary subprocess is still running".into());
        }
        let key = active.grant.key.clone();
        self.leases.remove(lease);
        let entry = self.entries.get_mut(&key).unwrap();
        if entry.revision == revision {
            entry.last_attempt = now();
            entry.completed_revision = revision;
            entry.error = error;
            if entry.error.is_none() {
                entry.summary = summary;
                entry.not_git = not_git;
                entry.checked_at = Some(now());
            }
        } else {
            entry.pending = true;
        }
        Ok(())
    }
    fn demanded(&self, key: &str) -> bool {
        self.demands
            .values()
            .flatten()
            .any(|(_, target, _)| target == key)
    }
    fn running(&self, key: &str) -> bool {
        self.leases.values().any(|lease| lease.grant.key == key)
    }
    fn schedule(&mut self) -> Vec<Grant> {
        let mut grants = Vec::new();
        while self.leases.len() < LIMIT {
            let mut candidates: Vec<_> = self
                .demands
                .iter()
                .flat_map(|(window, demands)| {
                    demands.iter().map(move |(root, key, priority)| {
                        (window.clone(), root.clone(), key.clone(), *priority)
                    })
                })
                .filter(|(_, _, key, _)| {
                    self.entries
                        .get(key)
                        .is_some_and(|entry| entry.pending && !entry.debounce)
                        && !self.running(key)
                })
                .collect();
            candidates.sort_by_key(|(_, _, key, priority)| {
                (*priority, self.entries[key].touched, key.clone())
            });
            let Some((window, root_path, key, _)) = candidates.into_iter().next() else {
                break;
            };
            self.sequence += 1;
            let lease = format!("summary-{}", self.sequence);
            let entry = self.entries.get_mut(&key).unwrap();
            entry.pending = false;
            let grant = Grant {
                key,
                root_path,
                lease: lease.clone(),
                revision: entry.revision,
                window,
            };
            self.leases.insert(
                lease,
                Lease {
                    grant: grant.clone(),
                    commands: 0,
                    revoked: false,
                },
            );
            grants.push(grant);
        }
        grants
    }
    fn payload(&self, grants: Vec<Grant>) -> Value {
        let rows: Vec<_> = self.demands.values().flatten().filter_map(|(path, key, _)| self.entries.get(key)
            .map(|entry| json!({"path":path,"snapshot":entry.snapshot(self.running(key) || entry.pending)}))).collect();
        json!({"sequence":self.publication,"rows":rows,"grants":grants})
    }
    fn evict(&mut self) {
        let mut unused: Vec<_> = self
            .entries
            .iter()
            .filter(|(key, _)| !self.demanded(key) && !self.running(key))
            .map(|(key, entry)| (entry.touched, key.clone()))
            .collect();
        unused.sort();
        let remove = self.entries.len().saturating_sub(CACHE_LIMIT);
        for (_, key) in unused.into_iter().take(remove) {
            self.entries.remove(&key);
        }
    }
    fn watch_targets(&self) -> HashMap<PathBuf, bool> {
        let mut wanted = HashMap::<PathBuf, bool>::new();
        for (key, entry) in &self.entries {
            if !self.demanded(key) {
                continue;
            }
            // Watch the marker's parent nonrecursively, including creation/replacement of .git.
            wanted.insert(entry.layout.root.clone(), false);
            for dir in [&entry.layout.git_dir, &entry.layout.common_dir]
                .into_iter()
                .flatten()
            {
                wanted.insert(dir.clone(), false);
                let refs = dir.join("refs");
                if refs.is_dir() {
                    wanted.insert(refs, true);
                }
            }
        }
        wanted
    }
    fn sync_watchers(&mut self, app: &AppHandle) {
        let wanted = self.watch_targets();
        if self.watcher.is_none() && !wanted.is_empty() {
            let app = app.clone();
            self.watcher =
                notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
                    if let Ok(mut event) = result {
                        event.paths.retain(|path| {
                            !path
                                .file_name()
                                .is_some_and(|name| name.to_string_lossy().ends_with(".lock"))
                        });
                        if event.paths.is_empty() {
                            return;
                        }
                        // Access events from our own status reads must not perpetually invalidate.
                        if matches!(event.kind, notify::EventKind::Access(_)) {
                            return;
                        }
                        // Watcher removal may join this callback while holding coordinator state.
                        // Dispatch invalidation so the watcher thread never waits for that lock.
                        let app = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            metadata_changed(&app, &event.paths)
                        });
                    }
                })
                .ok();
        }
        if let Some(watcher) = self.watcher.as_mut() {
            for path in self
                .watched
                .keys()
                .filter(|path| !wanted.contains_key(*path))
                .cloned()
                .collect::<Vec<_>>()
            {
                let _ = watcher.unwatch(&path);
                self.watched.remove(&path);
            }
            for (path, recursive) in wanted {
                if self.watched.get(&path) == Some(&recursive) {
                    continue;
                }
                if self.watched.contains_key(&path) {
                    let _ = watcher.unwatch(&path);
                }
                if watcher
                    .watch(
                        &path,
                        if recursive {
                            RecursiveMode::Recursive
                        } else {
                            RecursiveMode::NonRecursive
                        },
                    )
                    .is_ok()
                {
                    self.watched.insert(path, recursive);
                }
            }
        }
        if self.watched.is_empty() {
            self.watcher = None;
        }
    }
}
fn publish(app: &AppHandle, state: &mut Coordinator) -> Value {
    state.evict();
    state.publication += 1;
    let grants = state.schedule();
    let payload = state.payload(grants);
    let _ = app.emit(EVENT, payload.clone());
    payload
}

#[tauri::command]
pub fn workspace_git_summary_sync(
    app: AppHandle,
    window: WebviewWindow,
    demands: Vec<Demand>,
) -> Value {
    let mut state = coordinator().lock().unwrap();
    let mut next = Vec::new();
    for demand in demands {
        let layout = layout(&demand.root_path);
        let key = key(&layout);
        let running = state.running(&key);
        let entry = state
            .entries
            .entry(key.clone())
            .or_insert_with(|| Entry::new(layout.clone()));
        entry.layout = layout;
        entry.touched = now();
        if entry.needs_read() && !running && !entry.debounce {
            entry.pending = true;
        }
        next.push((demand.root_path, key, demand.priority.min(1)));
    }
    state.demands.insert(window.label().to_string(), next);
    state.sync_watchers(&app);
    publish(&app, &mut state)
}

#[tauri::command]
pub fn workspace_git_summary_refresh(app: AppHandle, paths: Vec<String>) -> Value {
    let mut state = coordinator().lock().unwrap();
    for path in paths {
        let key = key(&layout(&path));
        if state.running(&key) {
            continue;
        } // Force bypasses TTL, never single-flight.
        if let Some(entry) = state.entries.get_mut(&key) {
            entry.pending = true;
        }
    }
    publish(&app, &mut state)
}

fn invalidate_keys(app: &AppHandle, keys: Vec<String>) {
    let mut state = coordinator().lock().unwrap();
    for key in keys {
        let Some(entry) = state.entries.get_mut(&key) else {
            continue;
        };
        entry.revision += 1;
        if entry.debounce {
            continue;
        }
        entry.debounce = true;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
            let mut state = coordinator().lock().unwrap();
            if let Some(entry) = state.entries.get_mut(&key) {
                entry.layout = layout(&entry.layout.root.to_string_lossy());
                entry.debounce = false;
                entry.pending = true;
            }
            state.sync_watchers(&app);
            publish(&app, &mut state);
        });
    }
    state.publication += 1;
    let _ = app.emit(EVENT, state.payload(Vec::new()));
}
fn metadata_changed(app: &AppHandle, paths: &[PathBuf]) {
    let keys = {
        let state = coordinator().lock().unwrap();
        state
            .entries
            .iter()
            .filter(|(_, entry)| {
                paths.iter().any(|path| {
                    path == &entry.layout.root.join(".git")
                        || [&entry.layout.git_dir, &entry.layout.common_dir]
                            .into_iter()
                            .flatten()
                            .any(|dir| path.starts_with(dir))
                        || path.parent() == Some(entry.layout.root.as_path())
                })
            })
            .map(|(key, _)| key.clone())
            .collect()
    };
    invalidate_keys(app, keys);
}
#[tauri::command]
pub fn workspace_git_summary_invalidate(app: AppHandle, path: String) {
    let keys = {
        let state = coordinator().lock().unwrap();
        state
            .entries
            .iter()
            .filter(|(_, entry)| {
                Path::new(&path).starts_with(&entry.layout.root)
                    || entry.layout.root.starts_with(&path)
            })
            .map(|(key, _)| key.clone())
            .collect()
    };
    invalidate_keys(&app, keys);
}

#[tauri::command]
pub fn workspace_git_summary_complete(
    app: AppHandle,
    window: WebviewWindow,
    lease: String,
    revision: u64,
    summary: Option<Value>,
    error: Option<String>,
    not_git: bool,
    deferred: Option<bool>,
) -> Result<Value, String> {
    let mut state = coordinator().lock().unwrap();
    if deferred.unwrap_or(false) {
        // An owner lost focus between two commands. Do not cache the partial read.
        if let Some(active) = state.leases.get(&lease) {
            let key = active.grant.key.clone();
            if let Some(entry) = state.entries.get_mut(&key) {
                entry.revision += 1;
            }
        }
        state.demands.remove(window.label());
        state.sync_watchers(&app);
    }
    state.finish(window.label(), &lease, revision, summary, error, not_git)?;
    Ok(publish(&app, &mut state))
}

/// Accounting lives inside the existing blocking runner, including timeout/reap.
struct CommandGuard {
    app: AppHandle,
    lease: String,
}
impl Drop for CommandGuard {
    fn drop(&mut self) {
        let mut state = coordinator().lock().unwrap();
        state.end_command(&self.lease);
        publish(&self.app, &mut state);
    }
}
#[tauri::command(async)]
pub async fn workspace_git_summary_run(
    app: AppHandle,
    window: WebviewWindow,
    request: RunGitRequest,
    lease: String,
) -> Result<RunGitResponse, String> {
    {
        let mut state = coordinator().lock().unwrap();
        state.begin_command(&lease, window.label())?;
    }
    git::run_git_with_lifetime(request, CommandGuard { app, lease }).await
}
pub fn window_destroyed(app: &AppHandle, window: &str) {
    let mut state = coordinator().lock().unwrap();
    state.drop_window(window);
    state.sync_watchers(app);
    publish(app, &mut state);
}
#[tauri::command]
pub fn workspace_git_summary_detach(app: AppHandle, window: WebviewWindow) {
    window_destroyed(&app, window.label());
}
#[tauri::command]
pub fn workspace_git_summary_release(path: String) {
    let mut state = coordinator().lock().unwrap();
    let key = key(&layout(&path));
    if !state.demanded(&key) && !state.running(&key) {
        state.entries.remove(&key);
    }
}
#[tauri::command]
pub fn workspace_git_summary_diagnostics() -> Value {
    let state = coordinator().lock().unwrap();
    json!({"activeLeases":state.leases.len(),"activeCommands":state.leases.values().map(|lease| lease.commands).sum::<usize>(),
        "queuedEntries":state.entries.values().filter(|entry|entry.pending).count(),"watchTargets":state.watched.len(),"cacheEntries":state.entries.len()})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(path: &str) -> Entry {
        Entry::new(Layout {
            root: PathBuf::from(path),
            git_dir: None,
            common_dir: None,
        })
    }
    #[test]
    fn windows_share_four_leases_and_active_priority() {
        let mut state = Coordinator::default();
        for index in 0..10 {
            let key = format!("/repo{index}");
            let mut entry = entry(&key);
            entry.pending = true;
            state.entries.insert(key.clone(), entry);
            state
                .demands
                .entry(format!("window{}", index % 2))
                .or_default()
                .push((key.clone(), key, if index == 9 { 0 } else { 1 }));
        }
        let grants = state.schedule();
        assert_eq!(grants.len(), 4);
        assert_eq!(grants[0].root_path, "/repo9");
        assert_eq!(state.schedule().len(), 0);
    }
    #[test]
    fn duplicate_demand_shares_one_lease() {
        let mut state = Coordinator::default();
        let mut entry = entry("/repo");
        entry.pending = true;
        state.entries.insert("/repo".into(), entry);
        state
            .demands
            .insert("a".into(), vec![("/repo/a".into(), "/repo".into(), 1)]);
        state
            .demands
            .insert("b".into(), vec![("/repo/b".into(), "/repo".into(), 0)]);
        assert_eq!(state.schedule().len(), 1);
        assert_eq!(state.leases.len(), 1);
    }
    #[test]
    fn stale_error_retains_last_summary_and_success_time() {
        let mut entry = entry("/repo");
        entry.summary = Some(json!({"branchName":"main"}));
        entry.checked_at = Some(10);
        entry.last_attempt = now();
        entry.error = Some("timeout".into());
        let snapshot = entry.snapshot(false);
        assert_eq!(snapshot["status"], "error");
        assert_eq!(snapshot["summary"]["branchName"], "main");
        assert_eq!(snapshot["checkedAt"], 10);
    }
    #[test]
    fn cache_evicts_only_undemanded_entries() {
        let mut state = Coordinator::default();
        for index in 0..200 {
            let key = format!("/repo{index}");
            state.entries.insert(key.clone(), entry(&key));
        }
        state
            .demands
            .insert("window".into(), vec![("/repo0".into(), "/repo0".into(), 0)]);
        state.evict();
        assert_eq!(state.entries.len(), CACHE_LIMIT);
        assert!(state.entries.contains_key("/repo0"));
    }
    #[test]
    fn git_file_resolves_linked_metadata_and_subpaths() {
        let root =
            std::env::temp_dir().join(format!("specops-summary-{}-{}", std::process::id(), now()));
        let main = root.join("main");
        let linked = root.join("linked");
        let git = main.join(".git");
        let worktree = git.join("worktrees/linked");
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::create_dir_all(linked.join("src/deep")).unwrap();
        std::fs::write(
            linked.join(".git"),
            format!("gitdir: {}", worktree.display()),
        )
        .unwrap();
        std::fs::write(worktree.join("commondir"), "../..").unwrap();
        let layout = layout(linked.join("src/deep").to_str().unwrap());
        assert_eq!(layout.root, canonical(&linked));
        assert_eq!(layout.git_dir, Some(canonical(&worktree)));
        assert_eq!(layout.common_dir, Some(canonical(&git)));
        assert_ne!(key(&layout), key(&super::layout(main.to_str().unwrap())));
        std::fs::remove_dir_all(root).unwrap();
    }
    fn demanded_state() -> (Coordinator, Grant) {
        let mut state = Coordinator::default();
        let mut entry = entry("/repo");
        entry.pending = true;
        state.entries.insert("/repo".into(), entry);
        state
            .demands
            .insert("a".into(), vec![("/repo".into(), "/repo".into(), 1)]);
        let grant = state.schedule().remove(0);
        (state, grant)
    }
    #[test]
    fn force_and_repeated_consumers_cannot_duplicate_running_check() {
        let (mut state, grant) = demanded_state();
        state.entries.get_mut("/repo").unwrap().pending = true;
        assert!(state.schedule().is_empty());
        assert_eq!(state.leases.len(), 1);
        assert!(state.begin_command(&grant.lease, "a").is_ok());
        assert!(state.begin_command(&grant.lease, "a").is_err());
    }
    #[test]
    fn invalidation_during_read_rejects_old_answer_and_schedules_one_followup() {
        let (mut state, grant) = demanded_state();
        let entry = state.entries.get_mut("/repo").unwrap();
        entry.summary = Some(json!({"branchName":"previous"}));
        entry.revision += 1;
        state
            .finish(
                "a",
                &grant.lease,
                grant.revision,
                Some(json!({"branchName":"obsolete"})),
                None,
                false,
            )
            .unwrap();
        assert_eq!(
            state.entries["/repo"].summary.as_ref().unwrap()["branchName"],
            "previous"
        );
        let next = state.schedule();
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].revision, 1);
        assert!(state.schedule().is_empty());
        state
            .finish(
                "a",
                &next[0].lease,
                1,
                Some(json!({"branchName":"new"})),
                None,
                false,
            )
            .unwrap();
        state
            .finish(
                "a",
                &grant.lease,
                0,
                Some(json!({"branchName":"late"})),
                None,
                false,
            )
            .unwrap();
        assert_eq!(
            state.entries["/repo"].summary.as_ref().unwrap()["branchName"],
            "new"
        );
    }
    #[test]
    fn destroy_revokes_future_commands_but_keeps_slot_until_native_runner_finishes() {
        let (mut state, grant) = demanded_state();
        state
            .demands
            .insert("b".into(), vec![("/repo".into(), "/repo".into(), 1)]);
        state.begin_command(&grant.lease, "a").unwrap();
        state.drop_window("a");
        assert_eq!(state.leases.len(), 1);
        assert!(state.begin_command(&grant.lease, "a").is_err());
        assert!(state
            .finish("a", &grant.lease, 0, None, None, false)
            .is_err());
        assert!(state.schedule().is_empty());
        state.end_command(&grant.lease);
        assert!(state.leases.is_empty());
        assert_eq!(state.schedule()[0].window, "b");
    }
    #[test]
    fn destroy_before_first_subprocess_reassigns_and_old_lease_cannot_start() {
        let (mut state, grant) = demanded_state();
        state
            .demands
            .insert("b".into(), vec![("/repo".into(), "/repo".into(), 1)]);
        state.drop_window("a");
        assert!(state.begin_command(&grant.lease, "a").is_err());
        assert_eq!(state.schedule()[0].window, "b");
    }
    #[test]
    fn dropping_demand_retains_running_process_and_releases_all_watch_targets() {
        let (mut state, grant) = demanded_state();
        assert!(!state.watch_targets().is_empty());
        state.demands.clear();
        assert!(state.watch_targets().is_empty());
        assert_eq!(state.leases.len(), 1);
        state
            .finish("a", &grant.lease, 0, Some(json!({})), None, false)
            .unwrap();
        assert!(state.leases.is_empty());
        assert!(state.schedule().is_empty());
    }
    #[test]
    fn fresh_cache_skips_checks_and_ttl_alone_never_queues() {
        let (mut state, grant) = demanded_state();
        state
            .finish("a", &grant.lease, 0, Some(json!({})), None, false)
            .unwrap();
        assert!(!state.entries["/repo"].needs_read());
        assert!(state.schedule().is_empty());
        let entry = state.entries.get_mut("/repo").unwrap();
        entry.last_attempt = now() - TTL - 1;
        assert_eq!(entry.snapshot(false)["status"], "stale");
        assert!(state.schedule().is_empty());
    }
    #[test]
    fn real_metadata_watcher_observes_head_and_common_refs_without_tree_recursion() {
        use std::sync::mpsc;
        let root =
            std::env::temp_dir().join(format!("specops-watch-{}-{}", std::process::id(), now()));
        let git = root.join(".git");
        std::fs::create_dir_all(git.join("refs/heads")).unwrap();
        std::fs::write(git.join("HEAD"), "ref: refs/heads/main").unwrap();
        let mut state = Coordinator::default();
        let layout = layout(root.to_str().unwrap());
        let key = key(&layout);
        state.entries.insert(key.clone(), Entry::new(layout));
        state
            .demands
            .insert("a".into(), vec![(key.clone(), key, 1)]);
        let targets = state.watch_targets();
        assert_eq!(targets.get(&canonical(&root)), Some(&false));
        assert_eq!(targets.get(&canonical(&git).join("refs")), Some(&true));
        let (tx, rx) = mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(move |event: Result<notify::Event, notify::Error>| {
                if let Ok(event) = event {
                    let _ = tx.send(event);
                }
            })
            .unwrap();
        for (path, recursive) in targets {
            watcher
                .watch(
                    &path,
                    if recursive {
                        RecursiveMode::Recursive
                    } else {
                        RecursiveMode::NonRecursive
                    },
                )
                .unwrap();
        }
        std::fs::write(git.join("HEAD"), "ref: refs/heads/next").unwrap();
        std::fs::write(git.join("refs/heads/next"), "1234").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let (mut head, mut refs) = (false, false);
        while std::time::Instant::now() < deadline && !(head && refs) {
            if let Ok(event) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
                for path in event.paths {
                    head |= path.ends_with("HEAD");
                    refs |= path.ends_with("refs/heads/next");
                }
            }
        }
        assert!(head && refs);
        drop(watcher);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn real_status_reads_do_not_self_invalidate_metadata_watchers() {
        if !git::probe_git_available().available {
            return;
        }
        use std::sync::mpsc;
        let root = std::env::temp_dir().join(format!(
            "specops-status-watch-{}-{}",
            std::process::id(),
            now()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            git::execute_git(
                &root,
                &args
                    .iter()
                    .map(|value| value.to_string())
                    .collect::<Vec<_>>(),
                None,
            )
        };
        assert_eq!(run(&["init"]).exit_code, 0);
        std::fs::write(root.join("tracked.txt"), "initial").unwrap();
        assert_eq!(run(&["add", "tracked.txt"]).exit_code, 0);
        assert_eq!(
            run(&[
                "-c",
                "user.name=SpecOps Test",
                "-c",
                "user.email=specops@example.test",
                "commit",
                "-m",
                "initial"
            ])
            .exit_code,
            0
        );
        std::fs::write(root.join("tracked.txt"), "changed").unwrap();
        let layout = layout(root.to_str().unwrap());
        let (tx, rx) = mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(move |event: Result<notify::Event, notify::Error>| {
                if let Ok(event) = event {
                    let _ = tx.send(event);
                }
            })
            .unwrap();
        watcher
            .watch(layout.git_dir.as_ref().unwrap(), RecursiveMode::Recursive)
            .unwrap();
        // Native streams may initially deliver events buffered before registration.
        // Drain initialization/commit events before observing the read-only operation.
        let drain_deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while std::time::Instant::now() < drain_deadline
            && rx
                .recv_timeout(std::time::Duration::from_millis(300))
                .is_ok()
        {}
        for _ in 0..3 {
            assert_eq!(run(&["status", "-sb"]).exit_code, 0);
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
        let events: Vec<_> = rx
            .try_iter()
            .filter(|event| !matches!(event.kind, notify::EventKind::Access(_)))
            .flat_map(|event| event.paths)
            .filter(|path| {
                !path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .ends_with(".lock")
            })
            .collect();
        assert!(
            events.is_empty(),
            "status changed watched metadata: {events:?}"
        );
        drop(watcher);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn dropping_async_caller_keeps_accounting_until_blocking_runner_exits() {
        use std::future::Future;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::mpsc;
        use std::task::{Context, Poll, Waker};
        if !git::probe_git_available().available {
            return;
        }
        let root =
            std::env::temp_dir().join(format!("specops-lifetime-{}-{}", std::process::id(), now()));
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(git::execute_git(&root, &["init".into()], None).exit_code, 0);
        let hook = root.join(".git/hooks/status-wait");
        std::fs::write(&hook, "#!/bin/sh\nsleep 0.3\nexit 0\n").unwrap();
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        let config = root.join(".git/config");
        let mut text = std::fs::read_to_string(&config).unwrap();
        text.push_str(&format!("\n[core]\nfsmonitor = {}\n", hook.display()));
        std::fs::write(config, text).unwrap();
        struct Lifetime(std::sync::mpsc::Sender<()>);
        impl Drop for Lifetime {
            fn drop(&mut self) {
                let _ = self.0.send(());
            }
        }
        let (tx, rx) = mpsc::channel();
        let request = RunGitRequest {
            repo_root: root.to_string_lossy().into_owned(),
            args: vec!["status".into(), "-sb".into()],
            env: None,
            command_id: None,
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: Some(5_000),
        };
        let mut future = Box::pin(git::run_git_with_lifetime(request, Lifetime(tx)));
        assert!(matches!(
            future
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop())),
            Poll::Pending
        ));
        drop(future);
        assert!(rx
            .recv_timeout(std::time::Duration::from_millis(75))
            .is_err());
        assert!(rx.recv_timeout(std::time::Duration::from_secs(5)).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}
