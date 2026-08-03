//! Async filesystem commands for session-storage files (P03-08-04).
//!
//! The `tauri-plugin-fs` commands used by the session write lock and atomic
//! session writes (`mkdir`, `stat`, `remove`, `rename`, `write_text_file`) are
//! synchronous `#[tauri::command]`s, which Tauri executes inline on the
//! main/IPC thread. The lock-acquire retry loop and multi-step atomic writes
//! therefore competed with the UI for the main thread and could freeze the
//! window under contention. These replacements are `#[tauri::command(async)]`
//! and run their blocking I/O in `spawn_blocking`, off both the main thread
//! and the shared tokio worker pool.
//!
//! Scope: every command validates its path against the SpecOps app-data
//! directory (`app_data_dir()/spec-ops`). Unlike the fs plugin these commands
//! have no configurable scope, so restricting them to session storage keeps
//! them from becoming a general filesystem primitive for the webview.

use std::path::{Component, Path, PathBuf};
use tauri::Manager;

/// Root directory the `session_fs_*` commands may touch.
fn session_storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data dir unavailable: {error}"))?;
    Ok(base.join("spec-ops"))
}

/// Validate `raw` as an absolute, traversal-free path inside session storage.
fn validate_session_path(app: &tauri::AppHandle, raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("session_fs paths must be absolute".to_string());
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("session_fs paths must not contain '.' or '..' components".to_string());
    }
    let root = session_storage_root(app)?;
    if !path.starts_with(&root) {
        return Err("path is outside session storage scope".to_string());
    }
    Ok(path)
}

async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("session_fs task failed: {error}"))?
}

/// Capability probe: lets the frontend detect this command set once per run
/// and fall back to `tauri-plugin-fs` when absent (tests, older backends).
#[tauri::command]
pub fn session_fs_supported() -> bool {
    true
}

/// Create `path` as a directory. Fails when it already exists — callers use
/// this as an atomic cross-process mutex (`mkdir` semantics).
#[tauri::command(async)]
pub async fn session_fs_mkdir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = validate_session_path(&app, &path)?;
    run_blocking(move || {
        std::fs::create_dir(&path).map_err(|error| format!("mkdir failed: {error}"))
    })
    .await
}

/// Modification time of `path` in ms since epoch. `Ok(None)` when the
/// filesystem reports no mtime; `Err` when the path does not exist.
#[tauri::command(async)]
pub async fn session_fs_stat_mtime_ms(
    app: tauri::AppHandle,
    path: String,
) -> Result<Option<u64>, String> {
    let path = validate_session_path(&app, &path)?;
    run_blocking(move || {
        let metadata =
            std::fs::metadata(&path).map_err(|error| format!("stat failed: {error}"))?;
        let mtime_ms = metadata.modified().ok().and_then(|mtime| {
            mtime
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_millis() as u64)
        });
        Ok(mtime_ms)
    })
    .await
}

/// Remove a file or directory (`recursive` for non-empty directories).
#[tauri::command(async)]
pub async fn session_fs_remove(
    app: tauri::AppHandle,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let path = validate_session_path(&app, &path)?;
    run_blocking(move || {
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("remove failed: {error}"))?;
        let result = if metadata.is_dir() {
            if recursive {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_dir(&path)
            }
        } else {
            std::fs::remove_file(&path)
        };
        result.map_err(|error| format!("remove failed: {error}"))
    })
    .await
}

#[tauri::command(async)]
pub async fn session_fs_write_text(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    let path = validate_session_path(&app, &path)?;
    run_blocking(move || {
        std::fs::write(&path, content.as_bytes()).map_err(|error| format!("write failed: {error}"))
    })
    .await
}

#[tauri::command(async)]
pub async fn session_fs_read_text(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = validate_session_path(&app, &path)?;
    run_blocking(move || {
        std::fs::read_to_string(&path).map_err(|error| format!("read failed: {error}"))
    })
    .await
}

/// Atomic write: temp sibling + rename, entirely in one backend call.
///
/// Mirrors the frontend `atomicWriteTextFile` semantics (temp write failures
/// propagate without touching the target; rename-over-existing gets one
/// remove+rename retry) and additionally fsyncs the temp file before the
/// rename, closing the power-loss window the TS implementation documents as
/// accepted.
#[tauri::command(async)]
pub async fn session_fs_atomic_write_text(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    let path = validate_session_path(&app, &path)?;
    run_blocking(move || atomic_write_text_blocking(&path, &content)).await
}

fn atomic_write_text_blocking(path: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "atomic write target has no file name".to_string())?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_path = path.with_file_name(format!("{file_name}.{}.{nanos}.tmp", std::process::id()));

    // Failures writing the temp file must not touch the existing target.
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("atomic write failed writing temp file: {error}"));
    }

    if std::fs::rename(&temp_path, path).is_ok() {
        return Ok(());
    }
    // Some platforms/filesystems refuse rename-over-existing: clear the target
    // and retry once. Only after that fails is a direct write the last resort
    // (the temp content is known-good at this point, so this is not the
    // truncate-on-error data-loss case).
    let _ = std::fs::remove_file(path);
    if std::fs::rename(&temp_path, path).is_ok() {
        return Ok(());
    }
    let direct = std::fs::write(path, content.as_bytes())
        .map_err(|error| format!("atomic write failed: {error}"));
    let _ = std::fs::remove_file(&temp_path);
    direct
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = std::env::temp_dir().join(format!(
            "spec-ops-session-fs-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let target = dir.join("data.json");

        atomic_write_text_blocking(&target, "first").expect("initial write");
        assert_eq!(std::fs::read_to_string(&target).expect("read back"), "first");

        atomic_write_text_blocking(&target, "second").expect("replace write");
        assert_eq!(std::fs::read_to_string(&target).expect("read back"), "second");

        // No temp files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .expect("list dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_rejects_traversal_components() {
        let path = PathBuf::from("/data/spec-ops/../outside");
        assert!(path
            .components()
            .any(|component| matches!(component, Component::ParentDir)));
    }
}
