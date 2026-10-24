//! Bounded metadata reads and explicit, cancellable folder-size calculations.
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{ipc::Channel, State};

const MAX_BATCH: usize = 128;
const MAX_ENTRIES: u64 = 1_000_000;
const MAX_DEPTH: usize = 128;
const MAX_DURATION: Duration = Duration::from_secs(30);

#[derive(Default, Clone)]
pub struct ProjectSizesState(Arc<Mutex<HashMap<u64, SizeJob>>>);
struct SizeJob {
    path: PathBuf,
    cancelled: Arc<AtomicBool>,
}

fn scoped_path(root: &Path, raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if !root.is_absolute()
        || !path.is_absolute()
        || root
            .components()
            .chain(path.components())
            .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("Expected absolute project paths without parent traversal.".into());
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Path is outside the project.")?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut current = canonical_root.clone();
    for segment in relative.components() {
        current.push(segment);
        let meta = fs::symlink_metadata(&current).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Err("Symbolic links are excluded from size calculations.".into());
        }
    }
    let canonical = current.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path is outside the project.".into());
    }
    Ok(canonical)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSize {
    path: String,
    bytes: Option<u64>,
}

#[tauri::command]
pub async fn project_file_sizes(
    workspace_root: String,
    paths: Vec<String>,
) -> Result<Vec<FileSize>, String> {
    if paths.len() > MAX_BATCH {
        return Err("Too many file-size requests.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root);
        paths
            .into_iter()
            .map(|path| {
                let bytes = scoped_path(root, &path)
                    .ok()
                    .and_then(|p| fs::symlink_metadata(p).ok())
                    .filter(|m| m.is_file())
                    .map(|m| m.len());
                FileSize { path, bytes }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSize {
    bytes: u64,
    files: u64,
    entries: u64,
    errors: u64,
    done: bool,
    reason: Option<&'static str>,
    calculated_at: u64,
}

struct Scan<'a> {
    result: FolderSize,
    cancelled: &'a AtomicBool,
    started: Instant,
    last_publish: Instant,
    publish: &'a mut dyn FnMut(FolderSize) -> bool,
    max_entries: u64,
    max_duration: Duration,
}
impl Scan<'_> {
    fn stopped(&mut self) -> bool {
        if self.result.reason.is_some() {
            return true;
        }
        self.result.reason = if self.cancelled.load(Ordering::Relaxed) {
            Some("cancelled")
        } else if self.result.entries >= self.max_entries {
            Some("entryLimit")
        } else if self.started.elapsed() >= self.max_duration {
            Some("timeLimit")
        } else {
            None
        };
        self.result.reason.is_some()
    }
    fn visit(&mut self, path: &Path, depth: usize) {
        if self.stopped() {
            return;
        }
        if depth > MAX_DEPTH {
            self.result.errors += 1;
            return;
        }
        // Re-check each directory just before descending. Never intentionally follow links.
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
            _ => {
                self.result.errors += 1;
                return;
            }
        }
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(_) => {
                self.result.errors += 1;
                return;
            }
        };
        for entry in entries {
            if self.stopped() {
                break;
            }
            self.result.entries += 1;
            match entry.and_then(|entry| Ok((entry.path(), fs::symlink_metadata(entry.path())?))) {
                Ok((path, meta)) if !meta.file_type().is_symlink() => {
                    if meta.is_dir() {
                        self.visit(&path, depth + 1);
                    } else if meta.is_file() {
                        self.result.bytes = self.result.bytes.saturating_add(meta.len());
                        self.result.files += 1;
                    }
                }
                Ok(_) => {}
                Err(_) => self.result.errors += 1,
            }
            if self.last_publish.elapsed() >= Duration::from_millis(150) {
                self.last_publish = Instant::now();
                if !(self.publish)(self.result.clone()) {
                    self.cancelled.store(true, Ordering::Relaxed);
                }
            }
        }
    }
}

fn scan_folder(
    path: &Path,
    cancelled: &AtomicBool,
    publish: &mut dyn FnMut(FolderSize) -> bool,
    max_entries: u64,
    max_duration: Duration,
) -> FolderSize {
    let mut scan = Scan {
        result: FolderSize::default(),
        cancelled,
        started: Instant::now(),
        last_publish: Instant::now(),
        publish,
        max_entries,
        max_duration,
    };
    scan.visit(path, 0);
    scan.result.done = true;
    scan.result.calculated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    scan.result
}

#[tauri::command]
pub async fn project_start_folder_size(
    state: State<'_, ProjectSizesState>,
    workspace_root: String,
    path: String,
    on_progress: Channel<FolderSize>,
) -> Result<u64, String> {
    let state = state.inner().clone();
    // Resolving the selected path may touch a slow filesystem; keep it off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let path = scoped_path(Path::new(&workspace_root), &path)?;
        if !path.is_dir() {
            return Err("Choose a folder to calculate its size.".into());
        }
        static NEXT_JOB: AtomicU64 = AtomicU64::new(1);
        let id = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut jobs = state.0.lock().map_err(|e| e.to_string())?;
            if jobs.len() >= 2 {
                return Err("Two folder calculations are already running.".into());
            }
            if jobs
                .values()
                .any(|job| path.starts_with(&job.path) || job.path.starts_with(&path))
            {
                return Err(
                    "A calculation for this folder or an overlapping folder is already running."
                        .into(),
                );
            }
            jobs.insert(
                id,
                SizeJob {
                    path: path.clone(),
                    cancelled: cancelled.clone(),
                },
            );
        }
        tauri::async_runtime::spawn_blocking(move || {
            let result = scan_folder(
                &path,
                &cancelled,
                &mut |progress| on_progress.send(progress).is_ok(),
                MAX_ENTRIES,
                MAX_DURATION,
            );
            let _ = on_progress.send(result);
            if let Ok(mut jobs) = state.0.lock() {
                jobs.remove(&id);
            }
        });
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn project_cancel_folder_size(state: State<'_, ProjectSizesState>, job_id: u64) {
    if let Ok(jobs) = state.0.lock() {
        if let Some(job) = jobs.get(&job_id) {
            job.cancelled.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "spec-ops-sizes-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn includes_hidden_heavy_and_binary_files() {
        let temp = Temp::new();
        fs::create_dir_all(temp.0.join("node_modules/.hidden")).unwrap();
        fs::write(temp.0.join("a.dds"), [0u8; 12]).unwrap();
        fs::write(temp.0.join("node_modules/.hidden/b"), [0u8; 7]).unwrap();
        let result = scan_folder(
            &temp.0,
            &AtomicBool::new(false),
            &mut |_| true,
            MAX_ENTRIES,
            MAX_DURATION,
        );
        assert_eq!(result.bytes, 19);
        assert_eq!(result.files, 2);
        assert!(result.done);
        assert!(result.reason.is_none());
        assert_eq!(result.errors, 0);
    }
    #[test]
    fn cancellation_and_limits_are_partial() {
        let temp = Temp::new();
        for n in 0..5 {
            fs::write(temp.0.join(n.to_string()), [0u8; 2]).unwrap();
        }
        let cancelled = scan_folder(
            &temp.0,
            &AtomicBool::new(true),
            &mut |_| true,
            MAX_ENTRIES,
            MAX_DURATION,
        );
        assert_eq!(cancelled.reason, Some("cancelled"));
        assert_eq!(cancelled.bytes, 0);
        let limited = scan_folder(
            &temp.0,
            &AtomicBool::new(false),
            &mut |_| true,
            2,
            MAX_DURATION,
        );
        assert_eq!(limited.reason, Some("entryLimit"));
        assert_eq!(limited.files, 2);
        let timed = scan_folder(
            &temp.0,
            &AtomicBool::new(false),
            &mut |_| true,
            MAX_ENTRIES,
            Duration::ZERO,
        );
        assert_eq!(timed.reason, Some("timeLimit"));
    }
    #[test]
    fn rejects_outside_and_parent_paths() {
        let temp = Temp::new();
        assert!(scoped_path(&temp.0, "/etc").is_err());
        assert!(scoped_path(&temp.0, &temp.0.join("../x").to_string_lossy()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn skips_symlink_files_directories_and_cycles() {
        use std::os::unix::fs::symlink;
        let temp = Temp::new();
        fs::write(temp.0.join("file"), [0u8; 5]).unwrap();
        symlink(temp.0.join("file"), temp.0.join("link")).unwrap();
        symlink(&temp.0, temp.0.join("cycle")).unwrap();
        assert!(scoped_path(&temp.0, &temp.0.join("link").to_string_lossy()).is_err());
        let result = scan_folder(
            &temp.0,
            &AtomicBool::new(false),
            &mut |_| true,
            MAX_ENTRIES,
            MAX_DURATION,
        );
        assert_eq!(result.bytes, 5);
        assert_eq!(result.files, 1);
        assert_eq!(result.errors, 0);
    }
}
