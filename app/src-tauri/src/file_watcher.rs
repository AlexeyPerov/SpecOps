use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub const FILE_CHANGED_EVENT: &str = "spec-ops/fs/file-changed";

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
    watched_paths: HashSet<String>,
    project_tree_roots: HashSet<String>,
    app_handle: Option<AppHandle>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(FileWatcherInner {
                debouncer: None,
                watched_paths: HashSet::new(),
                project_tree_roots: HashSet::new(),
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

fn ensure_debouncer(inner: &mut FileWatcherInner) -> Result<(), String> {
    if inner.debouncer.is_some() {
        return Ok(());
    }

    let app_handle = inner
        .app_handle
        .clone()
        .ok_or_else(|| "File watcher app handle is not initialized".to_string())?;

    let debouncer = new_debouncer(
        Duration::from_millis(200),
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };

            for event in events {
                let kind = FileChangeKind::from(event.kind);
                for path in &event.paths {
                    let path_str = path.to_string_lossy().into_owned();
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

#[tauri::command]
pub fn sync_file_watcher_paths(
    paths: Vec<String>,
    state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?;

    ensure_debouncer(&mut inner)?;

    let next_paths: HashSet<String> = paths.into_iter().collect();

    let (to_remove, to_add) = compute_watcher_path_diff(&inner.watched_paths, &next_paths);

    let debouncer = inner
        .debouncer
        .as_mut()
        .ok_or_else(|| "File watcher debouncer is not initialized".to_string())?;

    for path in to_remove {
        let path_buf = PathBuf::from(&path);
        debouncer
            .watcher()
            .unwatch(path_buf.as_path())
            .map_err(|error| error.to_string())?;
    }

    for path in to_add {
        let path_buf = PathBuf::from(&path);
        debouncer
            .watcher()
            .watch(path_buf.as_path(), RecursiveMode::NonRecursive)
            .map_err(|error| error.to_string())?;
    }

    inner.watched_paths = next_paths;
    Ok(())
}

#[tauri::command]
pub fn sync_project_tree_watcher(
    root: Option<String>,
    state: State<'_, FileWatcherState>,
) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|error| error.to_string())?;

    ensure_debouncer(&mut inner)?;

    let next_roots: HashSet<String> = root.into_iter().collect();
    let (to_remove, to_add) =
        compute_watcher_path_diff(&inner.project_tree_roots, &next_roots);

    let debouncer = inner
        .debouncer
        .as_mut()
        .ok_or_else(|| "File watcher debouncer is not initialized".to_string())?;

    for path in to_remove {
        let path_buf = PathBuf::from(&path);
        debouncer
            .watcher()
            .unwatch(path_buf.as_path())
            .map_err(|error| error.to_string())?;
    }

    for path in to_add {
        let path_buf = PathBuf::from(&path);
        debouncer
            .watcher()
            .watch(path_buf.as_path(), RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;
    }

    inner.project_tree_roots = next_roots;
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
}
