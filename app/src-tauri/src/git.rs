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

/// Format a filesystem path for `git commit -F` argv on all platforms.
///
/// Git accepts forward slashes on Windows; normalizing avoids mixed-slash paths
/// when the temp file lives under `%TEMP%` with backslashes.
fn git_message_file_arg(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
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

/// Request payload for the `git_commit_with_message` Tauri command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    pub repo_root: String,
    pub message: String,
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

/// Create a commit using a temporary message file (`git commit -F`).
#[tauri::command]
pub fn git_commit_with_message(request: GitCommitRequest) -> Result<RunGitResponse, String> {
    let trimmed = request.message.trim();
    if trimmed.is_empty() {
        return Err("commit message must not be empty".to_string());
    }

    let repo_root = normalize_repo_root(&request.repo_root)?;
    let temp_path = std::env::temp_dir().join(format!(
        "spec-ops-git-commit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));

    std::fs::write(&temp_path, request.message.as_bytes())
        .map_err(|error| format!("Failed to write commit message file: {error}"))?;

    let temp_arg = git_message_file_arg(&temp_path);
    let response = execute_git(
        &repo_root,
        &[
            "commit".to_string(),
            "-F".to_string(),
            temp_arg,
        ],
        None,
    );

    let _ = std::fs::remove_file(&temp_path);
    Ok(response)
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

    fn skip_if_git_unavailable() -> bool {
        let available = probe_git_available().available;
        if !available {
            eprintln!("skipping: git not installed on PATH");
        }
        !available
    }

    #[test]
    fn git_available_response_has_expected_shape_when_git_installed() {
        if skip_if_git_unavailable() {
            return;
        }
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
        if skip_if_git_unavailable() {
            return;
        }
        let response = git_available();
        assert_eq!(response.available, true);
        assert!(response.version.is_some());
        assert_eq!(response.error, None);
    }

    #[test]
    fn run_git_status_succeeds_in_temp_repo() {
        if skip_if_git_unavailable() {
            return;
        }
        let repo_root = create_temp_git_repo();
        let response = execute_git(&repo_root, &["status".to_string()], None);

        assert_eq!(response.exit_code, 0);
        assert!(response.stdout.contains("On branch") || response.stdout.contains("No commits yet"));
        assert!(response.stderr.is_empty());
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_preserves_args_with_spaces_as_single_argv() {
        if skip_if_git_unavailable() {
            return;
        }
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
        if skip_if_git_unavailable() {
            return;
        }
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
        if skip_if_git_unavailable() {
            return;
        }
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
    fn git_message_file_arg_uses_forward_slashes_on_windows_style_paths() {
        let path = PathBuf::from(r"C:\Users\test\AppData\Local\Temp\spec-ops-git-commit-123");
        assert_eq!(
            git_message_file_arg(&path),
            "C:/Users/test/AppData/Local/Temp/spec-ops-git-commit-123"
        );
    }

    #[test]
    fn git_commit_with_message_rejects_empty_message() {
        let error = git_commit_with_message(GitCommitRequest {
            repo_root: "/tmp/repo".to_string(),
            message: "   ".to_string(),
        })
        .expect_err("empty message should fail");

        assert!(error.contains("commit message must not be empty"));
    }

    #[test]
    fn git_commit_with_message_creates_commit_in_temp_repo() {
        if skip_if_git_unavailable() {
            return;
        }
        let repo_root = create_temp_git_repo();
        let _ = execute_git(
            &repo_root,
            &[
                "config".to_string(),
                "user.email".to_string(),
                "test@example.com".to_string(),
            ],
            None,
        );
        let _ = execute_git(
            &repo_root,
            &["config".to_string(), "user.name".to_string(), "Test".to_string()],
            None,
        );

        let file_path = repo_root.join("file.txt");
        fs::write(&file_path, "content").expect("write file");
        let add = execute_git(
            &repo_root,
            &["add".to_string(), "file.txt".to_string()],
            None,
        );
        assert_eq!(add.exit_code, 0);

        let response = git_commit_with_message(GitCommitRequest {
            repo_root: repo_root.to_string_lossy().into_owned(),
            message: "Initial commit\n\nBody paragraph.".to_string(),
        })
        .expect("commit should succeed");

        assert_eq!(response.exit_code, 0);
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_not_a_repository_returns_exit_code_128() {
        if skip_if_git_unavailable() {
            return;
        }
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
