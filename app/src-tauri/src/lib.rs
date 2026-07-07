mod file_watcher;
mod git;
mod git_askpass;
mod opencode_sidecar;

#[cfg(target_os = "macos")]
mod dock_menu;

use file_watcher::FileWatcherState;
use opencode_sidecar::OpencodeSidecarState;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_log::log::LevelFilter;
use tauri_plugin_log::{Target, TargetKind};

const APP_EVENT_OPENED_PATHS: &str = "spec-ops/app/opened-paths";

#[derive(Clone, Serialize)]
struct OpenedPathsPayload {
    paths: Vec<String>,
}

fn pending_opened_paths() -> &'static Mutex<Vec<String>> {
    static PENDING: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

fn enqueue_opened_paths(paths: &[String]) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = pending_opened_paths().lock() {
        pending.extend(paths.iter().cloned());
    }
}

#[tauri::command]
fn take_pending_opened_paths() -> Vec<String> {
    if let Ok(mut pending) = pending_opened_paths().lock() {
        return std::mem::take(&mut *pending);
    }
    Vec::new()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(FileWatcherState::new())
        .manage(OpencodeSidecarState::new())
        .setup(|app| {
            git_askpass::set_git_askpass_app_handle(app.handle().clone());
            if let Some(watcher_state) = app.try_state::<FileWatcherState>() {
                watcher_state.set_app_handle(app.handle().clone());
            }
            #[cfg(target_os = "macos")]
            dock_menu::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_opened_paths,
            git::git_available,
            git::run_git,
            git::respond_git_askpass,
            git::cancel_git_command,
            git::git_commit_with_message,
            git::remove_stale_index_lock,
            file_watcher::sync_file_watcher_paths,
            file_watcher::sync_project_tree_watcher,
            opencode_sidecar::opencode_sidecar_attach_workspace,
            opencode_sidecar::opencode_sidecar_start,
            opencode_sidecar::opencode_sidecar_stop,
            opencode_sidecar::opencode_sidecar_restart,
            opencode_sidecar::opencode_sidecar_status,
            #[cfg(target_os = "macos")]
            dock_menu::refresh_dock_menu,
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                // Keep app diagnostics at info+ and silence noisy tao/wry internals.
                .level(LevelFilter::Info)
                .level_for("tao", LevelFilter::Warn)
                .level_for("wry", LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = &event {
            if let Some(sidecar_state) = app_handle.try_state::<OpencodeSidecarState>() {
                sidecar_state.stop_sync();
            }
            // Terminate any in-flight git subprocesses so a mid-flight write does not
            // orphan a `.git/index.lock`. Each child is reaped and its index lock
            // cleaned up before the process exits.
            git::drain_all_active_git_commands();
        }

        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();

            if paths.is_empty() {
                return;
            }

            enqueue_opened_paths(&paths);
            let _ = app_handle.emit_to(
                "main",
                APP_EVENT_OPENED_PATHS,
                OpenedPathsPayload { paths },
            );
        }
    });
}
