use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub const FILE_CHANGED_EVENT: &str = "spec-ops/fs/file-changed";

#[derive(Clone, serde::Serialize)]
struct FileChangedPayload {
    path: String,
}

pub struct FileWatcherState {
    inner: Mutex<FileWatcherInner>,
}

struct FileWatcherInner {
    debouncer: Option<Debouncer<notify::RecommendedWatcher, FileIdMap>>,
    watched_paths: HashSet<String>,
    app_handle: Option<AppHandle>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(FileWatcherInner {
                debouncer: None,
                watched_paths: HashSet::new(),
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
                for path in &event.paths {
                    let path_str = path.to_string_lossy().into_owned();
                    let _ = app_handle.emit(
                        FILE_CHANGED_EVENT,
                        FileChangedPayload {
                            path: path_str,
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

    let to_remove: Vec<String> = inner
        .watched_paths
        .difference(&next_paths)
        .cloned()
        .collect();
    let to_add: Vec<String> = next_paths
        .difference(&inner.watched_paths)
        .cloned()
        .collect();

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
