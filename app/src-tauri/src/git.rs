use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

const GIT_BINARY: &str = "git";

/// Request payload for the `run_git` Tauri command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// Result of probing whether `git` is available on PATH.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitAvailableResponse {
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

fn decode_utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn normalize_repo_root(repo_root: &str) -> Result<PathBuf, String> {
    let trimmed = repo_root.trim();
    if trimmed.is_empty() {
        return Err("repo_root must not be empty".to_string());
    }

    let path = PathBuf::from(trimmed);
    if path.is_relative() {
        return Err("repo_root must be an absolute path".to_string());
    }

    if path.exists() {
        path.canonicalize()
            .map_err(|error| format!("Failed to resolve repo_root path: {error}"))
    } else {
        Ok(path)
    }
}

/// Probe whether `git` is installed and readable from PATH.
///
/// On Windows, this relies on PATH resolution first. Common install locations
/// (e.g. `C:\Program Files\Git\cmd\git.exe`) can be added as a fallback later
/// if PATH-only lookup proves insufficient in the field.
pub fn probe_git_available() -> GitAvailableResponse {
    match Command::new(GIT_BINARY).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = decode_utf8(&output.stdout).trim().to_string();
            GitAvailableResponse {
                available: true,
                version: Some(version),
                error: None,
            }
        }
        Ok(output) => {
            let stderr = decode_utf8(&output.stderr).trim().to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            GitAvailableResponse {
                available: false,
                version: None,
                error: Some(if stderr.is_empty() {
                    format!("git --version exited with code {exit_code}")
                } else {
                    stderr
                }),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => GitAvailableResponse {
            available: false,
            version: None,
            error: Some("git executable not found on PATH".to_string()),
        },
        Err(error) => GitAvailableResponse {
            available: false,
            version: None,
            error: Some(format!("Failed to run git --version: {error}")),
        },
    }
}

/// Run `git` in `repo_root` with argv passed directly (no shell interpolation).
pub fn execute_git(
    repo_root: &Path,
    args: &[String],
    env: Option<&HashMap<String, String>>,
) -> RunGitResponse {
    let start = Instant::now();

    let mut command = Command::new(GIT_BINARY);
    command
        .current_dir(repo_root)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(env_map) = env {
        for (key, value) in env_map {
            command.env(key, value);
        }
    }

    match command.output() {
        Ok(output) => RunGitResponse {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: decode_utf8(&output.stdout),
            stderr: decode_utf8(&output.stderr),
            duration_ms: start.elapsed().as_millis() as u64,
        },
        Err(error) => RunGitResponse {
            exit_code: -1,
            stdout: String::new(),
            stderr: error.to_string(),
            duration_ms: start.elapsed().as_millis() as u64,
        },
    }
}

/// Probe whether system `git` is available.
#[tauri::command]
pub fn git_available() -> GitAvailableResponse {
    probe_git_available()
}

/// Run `git` in `repo_root` with the given argv (no shell interpolation).
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
pub fn run_git(request: RunGitRequest) -> Result<RunGitResponse, String> {
    let repo_root = normalize_repo_root(&request.repo_root)?;
    Ok(execute_git(
        &repo_root,
        &request.args,
        request.env.as_ref(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command as StdCommand;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn next_test_dir(name: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("spec-ops-git-{name}-{id}-{}", std::process::id()))
    }

    fn create_temp_git_repo() -> PathBuf {
        let dir = next_test_dir("repo");
        fs::create_dir_all(&dir).expect("create temp repo dir");
        let init = StdCommand::new(GIT_BINARY)
            .args(["init"])
            .current_dir(&dir)
            .output()
            .expect("git init");
        assert!(
            init.status.success(),
            "git init failed: {}",
            decode_utf8(&init.stderr)
        );
        dir.canonicalize().unwrap_or(dir)
    }

    #[test]
    fn git_available_response_has_expected_shape_when_git_installed() {
        let response = probe_git_available();

        assert_eq!(response.available, true);
        assert!(response.version.is_some());
        assert!(response
            .version
            .as_ref()
            .expect("version")
            .starts_with("git version"));
        assert_eq!(response.error, None);
    }

    #[test]
    fn git_available_tauri_command_matches_probe() {
        let response = git_available();
        assert_eq!(response.available, true);
        assert!(response.version.is_some());
        assert_eq!(response.error, None);
    }

    #[test]
    fn run_git_status_succeeds_in_temp_repo() {
        let repo_root = create_temp_git_repo();
        let response = execute_git(&repo_root, &["status".to_string()], None);

        assert_eq!(response.exit_code, 0);
        assert!(response.stdout.contains("On branch") || response.stdout.contains("No commits yet"));
        assert!(response.stderr.is_empty());
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_preserves_args_with_spaces_as_single_argv() {
        let repo_root = create_temp_git_repo();
        let set_name = execute_git(
            &repo_root,
            &[
                "config".to_string(),
                "user.name".to_string(),
                "Test User".to_string(),
            ],
            None,
        );
        assert_eq!(set_name.exit_code, 0);

        let read_name = execute_git(
            &repo_root,
            &["config".to_string(), "user.name".to_string()],
            None,
        );

        assert_eq!(read_name.exit_code, 0);
        assert_eq!(read_name.stdout.trim(), "Test User");
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_non_zero_exit_returns_stderr_without_panicking() {
        let repo_root = create_temp_git_repo();
        let response = execute_git(
            &repo_root,
            &["rev-parse".to_string(), "--verify".to_string(), "missing-ref".to_string()],
            None,
        );

        assert_ne!(response.exit_code, 0);
        assert!(!response.stderr.is_empty());
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_rejects_empty_repo_root() {
        let error = run_git(RunGitRequest {
            repo_root: "   ".to_string(),
            args: vec!["status".to_string()],
            env: None,
        })
        .expect_err("empty repo_root should fail");

        assert!(error.contains("repo_root must not be empty"));
    }

    #[test]
    fn run_git_rejects_relative_repo_root() {
        let error = run_git(RunGitRequest {
            repo_root: "relative/path".to_string(),
            args: vec!["status".to_string()],
            env: None,
        })
        .expect_err("relative repo_root should fail");

        assert!(error.contains("absolute path"));
    }

    #[test]
    fn run_git_rev_parse_nested_subdirectory_resolves_repo_root() {
        let repo_root = create_temp_git_repo();
        let nested = repo_root.join("packages").join("nested");
        fs::create_dir_all(&nested).expect("create nested dir");

        let response = execute_git(
            &nested,
            &["rev-parse".to_string(), "--show-toplevel".to_string()],
            None,
        );

        assert_eq!(response.exit_code, 0);
        assert_eq!(response.stdout.trim(), repo_root.to_string_lossy());
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_not_a_repository_returns_exit_code_128() {
        let dir = next_test_dir("not-repo");
        fs::create_dir_all(&dir).expect("create non-repo dir");
        let dir = dir.canonicalize().unwrap_or(dir);

        let response = execute_git(
            &dir,
            &["rev-parse".to_string(), "--show-toplevel".to_string()],
            None,
        );

        assert_eq!(response.exit_code, 128);
        assert!(response.stderr.contains("not a git repository"));
        let _ = fs::remove_dir_all(dir);
    }
}
