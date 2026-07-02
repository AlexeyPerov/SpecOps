use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Request payload for the `run_git` Tauri command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct RunGitRequest {
    pub repo_root: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
}

/// Result of a `git` subprocess invocation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunGitResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

fn stub_response() -> RunGitResponse {
    RunGitResponse {
        exit_code: 0,
        stdout: String::new(),
        stderr: String::new(),
        duration_ms: 0,
    }
}

/// Run `git` in `repo_root` with the given argv (no shell interpolation).
///
/// Task 0.1 stub: returns an empty success response until Task 0.3 wires subprocess execution.
///
/// ## Capabilities / permissions
///
/// Git is spawned from Rust via `std::process::Command` inside this command handler (same
/// pattern as the OpenCode sidecar), not via `@tauri-apps/plugin-shell`. Backend process spawn
/// does not require `shell:allow-execute` or `shell:allow-spawn` entries in
/// `capabilities/default.json`.
///
/// The webview calls this command through Tauri IPC (`invoke("run_git", …)`). Registered
/// commands are allowed for the main window by default under Tauri v2's command ACL; no extra
/// capability entry is required beyond `core:default`.
///
/// If future work moved git spawn to the shell plugin, add a scoped `shell:allow-execute`
/// permission for the resolved `git` binary path and argv patterns.
#[tauri::command]
pub fn run_git(_request: RunGitRequest) -> RunGitResponse {
    stub_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_git_stub_returns_empty_success() {
        let response = run_git(RunGitRequest {
            repo_root: "/tmp/example".to_string(),
            args: vec![],
            env: None,
        });

        assert_eq!(
            response,
            RunGitResponse {
                exit_code: 0,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: 0,
            }
        );
    }
}
