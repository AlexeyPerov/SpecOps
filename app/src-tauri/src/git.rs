use crate::git_askpass;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
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
    /// When set, the command is registered for user-initiated cancellation.
    #[serde(default)]
    pub command_id: Option<String>,
    /// When true, wire in-app GIT_ASKPASS for credential prompts during this command.
    #[serde(default)]
    pub askpass_enabled: bool,
    /// Operation context for askpass prompts (`fetch`, `pull`, `push`, etc.).
    #[serde(default)]
    pub askpass_operation: Option<String>,
    /// Optional askpass request timeout in milliseconds.
    #[serde(default)]
    pub askpass_timeout_ms: Option<u64>,
}

/// Result of a `git` subprocess invocation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunGitResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    #[serde(default)]
    pub cancelled: bool,
}

/// Outcome of a `cancel_git_command` request.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelGitCommandResponse {
    pub outcome: CancelGitCommandOutcome,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CancelGitCommandOutcome {
    Cancelled,
    NotFound,
    AlreadyFinished,
}

struct ActiveGitCommand {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}

struct GitCommandRegistry {
    commands: Mutex<HashMap<String, ActiveGitCommand>>,
}

fn git_command_registry() -> &'static GitCommandRegistry {
    static REGISTRY: OnceLock<GitCommandRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| GitCommandRegistry {
        commands: Mutex::new(HashMap::new()),
    })
}

fn normalize_command_id(command_id: &str) -> Option<String> {
    let trimmed = command_id.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn terminate_child_process(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn register_active_git_command(command_id: &str, child: Child) -> Result<(), String> {
    let registry = git_command_registry();
    let mut commands = registry
        .commands
        .lock()
        .map_err(|_| "git command registry lock poisoned".to_string())?;

    if commands.contains_key(command_id) {
        return Err(format!("git command id already in use: {command_id}"));
    }

    commands.insert(
        command_id.to_string(),
        ActiveGitCommand {
            child: Mutex::new(Some(child)),
            cancelled: AtomicBool::new(false),
        },
    );
    Ok(())
}

fn unregister_active_git_command(command_id: &str) {
    if let Ok(mut commands) = git_command_registry().commands.lock() {
        commands.remove(command_id);
    }
}

fn wait_for_registered_git_command(command_id: &str) -> Result<std::process::Output, String> {
    let registry = git_command_registry();
    let commands = registry
        .commands
        .lock()
        .map_err(|_| "git command registry lock poisoned".to_string())?;

    let entry = commands
        .get(command_id)
        .ok_or_else(|| format!("git command id not registered: {command_id}"))?;

    let mut child_guard = entry
        .child
        .lock()
        .map_err(|_| "git command child lock poisoned".to_string())?;

    let child = child_guard
        .as_mut()
        .ok_or_else(|| format!("git command child already finished: {command_id}"))?;

    child
        .wait_with_output()
        .map_err(|error| format!("Failed to wait for git command: {error}"))
}

fn active_git_command_was_cancelled(command_id: &str) -> bool {
    let Ok(commands) = git_command_registry().commands.lock() else {
        return false;
    };
    commands
        .get(command_id)
        .is_some_and(|entry| entry.cancelled.load(Ordering::SeqCst))
}

pub fn cancel_git_command_by_id(command_id: &str) -> CancelGitCommandResponse {
    let Some(normalized_id) = normalize_command_id(command_id) else {
        return CancelGitCommandResponse {
            outcome: CancelGitCommandOutcome::NotFound,
        };
    };

    let registry = git_command_registry();
    let Ok(commands) = registry.commands.lock() else {
        return CancelGitCommandResponse {
            outcome: CancelGitCommandOutcome::NotFound,
        };
    };

    let Some(entry) = commands.get(&normalized_id) else {
        return CancelGitCommandResponse {
            outcome: CancelGitCommandOutcome::NotFound,
        };
    };

    entry.cancelled.store(true, Ordering::SeqCst);

    let Ok(mut child_guard) = entry.child.lock() else {
        return CancelGitCommandResponse {
            outcome: CancelGitCommandOutcome::AlreadyFinished,
        };
    };

    let Some(child) = child_guard.as_mut() else {
        return CancelGitCommandResponse {
            outcome: CancelGitCommandOutcome::AlreadyFinished,
        };
    };

    terminate_child_process(child);
    *child_guard = None;

    CancelGitCommandResponse {
        outcome: CancelGitCommandOutcome::Cancelled,
    }
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

fn merge_env_maps(
    base: Option<&HashMap<String, String>>,
    extra: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut merged = base.cloned().unwrap_or_default();
    merged.extend(extra.iter().map(|(key, value)| (key.clone(), value.clone())));
    merged
}

struct AskpassSessionGuard(Option<String>);

impl Drop for AskpassSessionGuard {
    fn drop(&mut self) {
        if let Some(session_id) = self.0.take() {
            git_askpass::end_askpass_session(&session_id);
        }
    }
}

fn build_git_command(
    repo_root: &Path,
    args: &[String],
    env: Option<&HashMap<String, String>>,
) -> Command {
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

    command
}

/// Run `git` in `repo_root` with argv passed directly (no shell interpolation).
pub fn execute_git(
    repo_root: &Path,
    args: &[String],
    env: Option<&HashMap<String, String>>,
) -> RunGitResponse {
    execute_git_with_options(repo_root, args, env, None)
}

/// Run `git` with optional cancellation registration.
pub struct ExecuteGitOptions<'a> {
    pub env: Option<&'a HashMap<String, String>>,
    pub command_id: Option<&'a str>,
    pub askpass_enabled: bool,
    pub askpass_operation: Option<&'a str>,
    pub askpass_timeout_ms: Option<u64>,
}

pub fn execute_git_with_options(
    repo_root: &Path,
    args: &[String],
    env: Option<&HashMap<String, String>>,
    command_id: Option<&str>,
) -> RunGitResponse {
    execute_git_with_full_options(
        repo_root,
        args,
        ExecuteGitOptions {
            env,
            command_id,
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
        },
    )
}

pub fn execute_git_with_full_options(
    repo_root: &Path,
    args: &[String],
    options: ExecuteGitOptions<'_>,
) -> RunGitResponse {
    let start = Instant::now();
    let normalized_command_id = options.command_id.and_then(normalize_command_id);

    let askpass_session_id = if options.askpass_enabled {
        match git_askpass::build_askpass_env_for_operation(
            options.askpass_operation,
            options.askpass_timeout_ms,
        ) {
            Ok((askpass_env, session_id)) => {
                let merged_env = merge_env_maps(options.env, &askpass_env);
                Some((session_id, merged_env))
            }
            Err(error) => {
                return RunGitResponse {
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: error,
                    duration_ms: start.elapsed().as_millis() as u64,
                    cancelled: false,
                };
            }
        }
    } else {
        None
    };
    let _askpass_guard = AskpassSessionGuard(askpass_session_id.as_ref().map(|(id, _)| id.clone()));

    let effective_env = askpass_session_id
        .as_ref()
        .map(|(_, env)| env as &HashMap<String, String>)
        .or(options.env);

    let response = if let Some(id) = normalized_command_id.as_deref() {
        let mut command = build_git_command(repo_root, args, effective_env);
        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                return RunGitResponse {
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: error.to_string(),
                    duration_ms: start.elapsed().as_millis() as u64,
                    cancelled: false,
                };
            }
        };

        if let Err(error) = register_active_git_command(id, child) {
            unregister_active_git_command(id);
            return RunGitResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: error,
                duration_ms: start.elapsed().as_millis() as u64,
                cancelled: false,
            };
        }

        let output = match wait_for_registered_git_command(id) {
            Ok(output) => output,
            Err(error) => {
                let cancelled = active_git_command_was_cancelled(id);
                unregister_active_git_command(id);
                return RunGitResponse {
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: error,
                    duration_ms: start.elapsed().as_millis() as u64,
                    cancelled,
                };
            }
        };

        let cancelled = active_git_command_was_cancelled(id);
        unregister_active_git_command(id);

        RunGitResponse {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: decode_utf8(&output.stdout),
            stderr: decode_utf8(&output.stderr),
            duration_ms: start.elapsed().as_millis() as u64,
            cancelled,
        }
    } else {
        match build_git_command(repo_root, args, effective_env).output() {
            Ok(output) => RunGitResponse {
                exit_code: output.status.code().unwrap_or(-1),
                stdout: decode_utf8(&output.stdout),
                stderr: decode_utf8(&output.stderr),
                duration_ms: start.elapsed().as_millis() as u64,
                cancelled: false,
            },
            Err(error) => RunGitResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: error.to_string(),
                duration_ms: start.elapsed().as_millis() as u64,
                cancelled: false,
            },
        }
    };

    response
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
    Ok(execute_git_with_full_options(
        &repo_root,
        &request.args,
        ExecuteGitOptions {
            env: request.env.as_ref(),
            command_id: request.command_id.as_deref(),
            askpass_enabled: request.askpass_enabled,
            askpass_operation: request.askpass_operation.as_deref(),
            askpass_timeout_ms: request.askpass_timeout_ms,
        },
    ))
}

/// Write a credential response for an in-flight askpass session.
#[tauri::command]
pub fn respond_git_askpass(request: git_askpass::RespondGitAskpassRequest) -> Result<(), String> {
    git_askpass::respond_git_askpass(request)
}

/// Terminate an in-flight cancellable git command by id.
#[tauri::command]
pub fn cancel_git_command(command_id: String) -> CancelGitCommandResponse {
    cancel_git_command_by_id(&command_id)
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
            command_id: None,
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
            command_id: None,
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
    fn run_git_add_paths_with_spaces_and_non_ascii_as_single_argv() {
        if skip_if_git_unavailable() {
            return;
        }
        let repo_root = create_temp_git_repo();
        let spaces_path = repo_root.join("spaces file.txt");
        let unicode_path = repo_root.join("nested").join("café.txt");
        fs::create_dir_all(unicode_path.parent().expect("unicode parent dir"))
            .expect("create nested dir");
        fs::write(&spaces_path, "space").expect("write spaces file");
        fs::write(&unicode_path, "unicode").expect("write unicode file");

        let add = execute_git(
            &repo_root,
            &[
                "add".to_string(),
                "--".to_string(),
                "spaces file.txt".to_string(),
                "nested/café.txt".to_string(),
            ],
            None,
        );
        assert_eq!(add.exit_code, 0, "git add failed: {}", add.stderr);

        let status = execute_git(
            &repo_root,
            &["status".to_string(), "--porcelain".to_string()],
            None,
        );
        assert_eq!(status.exit_code, 0);
        assert!(status.stdout.contains("spaces file.txt"));
        assert!(status.stdout.contains("nested/café.txt"));

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

    #[test]
    fn cancel_git_command_returns_not_found_for_unknown_id() {
        let response = cancel_git_command_by_id("missing-command-id");
        assert_eq!(response.outcome, CancelGitCommandOutcome::NotFound);
    }

    #[test]
    fn cancel_git_command_returns_not_found_for_blank_id() {
        let response = cancel_git_command_by_id("   ");
        assert_eq!(response.outcome, CancelGitCommandOutcome::NotFound);
    }

    #[test]
    fn cancel_git_command_after_completion_returns_not_found() {
        if skip_if_git_unavailable() {
            return;
        }
        let repo_root = create_temp_git_repo();
        let command_id = format!(
            "completed-command-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let response = execute_git_with_options(
            &repo_root,
            &["status".to_string()],
            None,
            Some(&command_id),
        );
        assert_eq!(response.exit_code, 0);
        assert!(!response.cancelled);

        let cancel = cancel_git_command_by_id(&command_id);
        assert_eq!(cancel.outcome, CancelGitCommandOutcome::NotFound);
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn cancel_git_command_terminates_in_flight_process() {
        let command_id = format!(
            "in-flight-command-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");

        register_active_git_command(&command_id, child).expect("register command");

        let wait_id = command_id.clone();
        let wait_handle = std::thread::spawn(move || wait_for_registered_git_command(&wait_id));

        std::thread::sleep(std::time::Duration::from_millis(50));

        let first_cancel = cancel_git_command_by_id(&command_id);
        assert_eq!(first_cancel.outcome, CancelGitCommandOutcome::Cancelled);

        let second_cancel = cancel_git_command_by_id(&command_id);
        assert_eq!(
            second_cancel.outcome,
            CancelGitCommandOutcome::AlreadyFinished
        );

        let output = wait_handle.join().expect("join wait thread");
        assert!(output.is_ok());
        unregister_active_git_command(&command_id);

        let third_cancel = cancel_git_command_by_id(&command_id);
        assert_eq!(third_cancel.outcome, CancelGitCommandOutcome::NotFound);
    }

    #[test]
    fn run_git_rejects_duplicate_command_ids() {
        if skip_if_git_unavailable() {
            return;
        }
        let repo_root = create_temp_git_repo();
        let command_id = format!(
            "duplicate-command-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");

        register_active_git_command(&command_id, child).expect("register command");

        let response = run_git(RunGitRequest {
            repo_root: repo_root.to_string_lossy().into_owned(),
            args: vec!["status".to_string()],
            env: None,
            command_id: Some(command_id.clone()),
        })
        .expect("run_git should return response");

        assert_eq!(response.exit_code, -1);
        assert!(response.stderr.contains("already in use"));
        cancel_git_command_by_id(&command_id);
        unregister_active_git_command(&command_id);
        let _ = fs::remove_dir_all(repo_root);
    }
}
