use crate::git_askpass;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const GIT_BINARY: &str = "git";

/// Maximum combined stdout/stderr size returned from a git subprocess (16 MiB).
const MAX_GIT_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

/// Git subcommands the app may invoke via `run_git` (argv allowlist).
const ALLOWED_GIT_SUBCOMMANDS: &[&str] = &[
    "add",
    "branch",
    "checkout",
    "config",
    "diff",
    "fetch",
    "init",
    "log",
    "ls-remote",
    "pull",
    "push",
    "remote",
    "restore",
    "rev-list",
    "rev-parse",
    "show",
    "stash",
    "status",
    "tag",
];

/// Environment variables that must not be overridden by IPC callers.
const BLOCKED_GIT_ENV_VARS: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_GRAFT_FILE",
    "GIT_QUARANTINE_PATH",
];

static GIT_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();

fn git_executable() -> &'static Path {
    GIT_EXECUTABLE.get_or_init(resolve_git_binary)
}

/// Resolve the `git` executable: PATH first, then common Windows install locations.
fn resolve_git_binary() -> PathBuf {
    if git_version_probe(PathBuf::from(GIT_BINARY)).is_some() {
        return PathBuf::from(GIT_BINARY);
    }

    #[cfg(windows)]
    {
        for candidate in windows_git_install_candidates() {
            if git_version_probe(candidate.clone()).is_some() {
                return candidate;
            }
        }
    }

    PathBuf::from(GIT_BINARY)
}

fn git_version_probe(binary: PathBuf) -> Option<String> {
    match Command::new(&binary).arg("--version").output() {
        Ok(output) if output.status.success() => {
            Some(decode_utf8(&output.stdout).trim().to_string())
        }
        _ => None,
    }
}

#[cfg(windows)]
fn windows_git_install_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("Git").join("cmd").join("git.exe"));
    }
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        candidates.push(
            PathBuf::from(program_files_x86)
                .join("Git")
                .join("cmd")
                .join("git.exe"),
        );
    }
    if let Ok(local_app_data) = std::env::var("LocalAppData") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Git")
                .join("cmd")
                .join("git.exe"),
        );
    }

    candidates
}

fn git_not_found_error_message() -> String {
    #[cfg(windows)]
    {
        "git executable not found on PATH or in common Git for Windows install locations".to_string()
    }
    #[cfg(not(windows))]
    {
        "git executable not found on PATH".to_string()
    }
}

fn git_resolved_path_for_response(binary: &Path) -> Option<String> {
    if binary.as_os_str() == std::ffi::OsStr::new(GIT_BINARY) {
        None
    } else {
        Some(binary.display().to_string())
    }
}

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
    /// Optional subprocess timeout in milliseconds (cancellable commands only).
    #[serde(default)]
    pub timeout_ms: Option<u64>,
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
    #[serde(default)]
    pub timed_out: bool,
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
    /// Repo root this command runs in, so a terminated subprocess can clean up its
    /// stale `.git/index.lock` once the process is confirmed dead.
    repo_root: PathBuf,
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

/// Grace period given to a git subprocess to shut down on SIGTERM before we escalate
/// to SIGKILL. Git uses this window to release `.git/index.lock` and roll back partial
/// state (e.g. `MERGE_HEAD` from a cancelled pull). SIGKILL alone leaves both behind.
const GIT_GRACEFUL_SHUTDOWN_TIMEOUT_MS: u64 = 1500;

/// Send SIGTERM to a process (Unix). On Windows there is no equivalent of "ask the
/// process to clean up"; we fall back to `Child::kill` (TerminateProcess) there.
#[cfg(unix)]
fn send_terminate_signal(child: &Child) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    if let Some(pid) = child.id().try_into().ok().map(Pid::from_raw) {
        // Ignore errors: the process may already have exited between the caller's
        // last `try_wait()` and here. The caller always reaps afterwards.
        let _ = kill(pid, Signal::SIGTERM);
    }
}

/// Terminate a git subprocess, giving it a chance to release `.git/index.lock`.
///
/// On Unix this sends SIGTERM and waits up to
/// [`GIT_GRACEFUL_SHUTDOWN_TIMEOUT_MS`] for the process to exit, escalating to
/// SIGKILL only if it is still alive. On Windows SIGTERM is unavailable, so it goes
/// straight to `Child::kill` (TerminateProcess).
///
/// After the process is reaped, any stale `.git/index.lock` for `repo_root` is
/// removed. The removal is best-effort and ignored if the file is still held by a
/// live process (e.g. another git the app did not spawn), so it is safe to call
/// even when other writers may be active in the same repo.
fn terminate_child_process_gracefully(child: &mut Child, repo_root: &Path) {
    #[cfg(unix)]
    {
        send_terminate_signal(child);
        let deadline = Instant::now() + Duration::from_millis(GIT_GRACEFUL_SHUTDOWN_TIMEOUT_MS);
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
    }

    // Either we're on Windows, the grace window expired, or the process exited on
    // SIGTERM — ensure it is fully gone and reaped either way.
    let _ = child.kill();
    let _ = child.wait();

    cleanup_stale_index_lock_if_unowned(repo_root);
}

/// Best-effort removal of `<repo_root>/.git/index.lock`.
///
/// Only called after the app has confirmed one of *its own* git subprocesses has
/// been reaped. If the lock is still held by a live process belonging to something
/// else (the OpenCode sidecar, an external git tool), the `remove_file` fails and we
/// leave it alone — we never want to clobber a lock a running process depends on.
fn cleanup_stale_index_lock_if_unowned(repo_root: &Path) {
    let lock_path = repo_root.join(".git").join("index.lock");
    match std::fs::remove_file(&lock_path) {
        Ok(()) => log::info!(
            "Removed stale git index lock at {}",
            lock_path.display()
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Nothing to clean up — the process released the lock cleanly. Expected.
        }
        Err(error) => {
            // Likely still held by a live process; do not treat as fatal.
            log::debug!(
                "Did not remove git index lock at {}: {}",
                lock_path.display(),
                error
            );
        }
    }
}

fn register_active_git_command(
    command_id: &str,
    repo_root: PathBuf,
    mut child: Child,
) -> Result<(), String> {
    let registry = git_command_registry();
    let mut commands = registry
        .commands
        .lock()
        .map_err(|_| "git command registry lock poisoned".to_string())?;

    if commands.contains_key(command_id) {
        terminate_child_process_gracefully(&mut child, &repo_root);
        return Err(format!("git command id already in use: {command_id}"));
    }

    commands.insert(
        command_id.to_string(),
        ActiveGitCommand {
            child: Mutex::new(Some(child)),
            cancelled: AtomicBool::new(false),
            repo_root,
        },
    );
    Ok(())
}

fn unregister_active_git_command(command_id: &str) {
    if let Ok(mut commands) = git_command_registry().commands.lock() {
        commands.remove(command_id);
    }
}

fn wait_for_registered_git_command(
    command_id: &str,
    timeout_ms: Option<u64>,
) -> Result<RegisteredCommandOutput, String> {
    let poll_start = Instant::now();

    loop {
        if active_git_command_was_cancelled(command_id) {
            terminate_registered_git_command_child(command_id);
            return Ok(RegisteredCommandOutput {
                exit_code: -1,
                stdout: String::new(),
                stderr: String::new(),
                timed_out: false,
            });
        }

        if let Some(timeout) = timeout_ms {
            if poll_start.elapsed().as_millis() as u64 >= timeout {
                terminate_registered_git_command_child(command_id);
                return Ok(RegisteredCommandOutput {
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: "Git command timed out.".to_string(),
                    timed_out: true,
                });
            }
        }

        let wait_status = {
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

            let Some(child) = child_guard.as_mut() else {
                return Err(format!("git command child already finished: {command_id}"));
            };

            child
                .try_wait()
                .map_err(|error| format!("Failed to wait for git command: {error}"))
        };

        match wait_status {
            Ok(Some(status)) => {
                let child = take_registered_git_command_child(command_id)
                    .ok_or_else(|| format!("git command child already finished: {command_id}"))?;
                let mut child = child.0;
                let exit_code = status.code().unwrap_or(-1);
                let mut stdout_text = String::new();
                let mut stderr_text = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    stdout_text = read_limited_stream(&mut stdout, MAX_GIT_OUTPUT_BYTES)?;
                }
                if let Some(mut stderr) = child.stderr.take() {
                    stderr_text = read_limited_stream(&mut stderr, MAX_GIT_OUTPUT_BYTES)?;
                }
                let _ = child.wait();

                return Ok(RegisteredCommandOutput {
                    exit_code,
                    stdout: stdout_text,
                    stderr: stderr_text,
                    timed_out: false,
                });
            }
            Ok(None) => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(error),
        }
    }
}

struct RegisteredCommandOutput {
    exit_code: i32,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

fn take_registered_git_command_child(command_id: &str) -> Option<(Child, PathBuf)> {
    let Ok(commands) = git_command_registry().commands.lock() else {
        return None;
    };
    let entry = commands.get(command_id)?;
    let Ok(mut child_guard) = entry.child.lock() else {
        return None;
    };
    Some((child_guard.take()?, entry.repo_root.clone()))
}

fn terminate_registered_git_command_child(command_id: &str) {
    if let Some((mut child, repo_root)) = take_registered_git_command_child(command_id) {
        terminate_child_process_gracefully(&mut child, &repo_root);
    }
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
    let repo_root = entry.repo_root.clone();

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

    terminate_child_process_gracefully(child, &repo_root);
    *child_guard = None;

    CancelGitCommandResponse {
        outcome: CancelGitCommandOutcome::Cancelled,
    }
}

/// Terminate every in-flight registered git command and clean up their index locks.
///
/// Called on app exit so a git write that was mid-flight when the user quit the app
/// does not orphan its `.git/index.lock`. Each command is cancelled and reaped via
/// the graceful SIGTERM-first path; the registry is cleared afterwards.
pub fn drain_all_active_git_commands() {
    let command_ids: Vec<String> = {
        let Ok(commands) = git_command_registry().commands.lock() else {
            return;
        };
        commands.keys().cloned().collect()
    };

    for command_id in command_ids {
        // Reuse the public cancel path: marks cancelled, terminates the child
        // gracefully, and removes the repo's index.lock once the child is reaped.
        let _ = cancel_git_command_by_id(&command_id);
        unregister_active_git_command(&command_id);
    }
}

/// Result of probing whether `git` is available on PATH.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitAvailableResponse {
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
    /// Absolute path when git was resolved outside PATH (e.g. Windows default install).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
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

    if !path.exists() {
        return Err(format!("repo_root path does not exist: {trimmed}"));
    }

    path.canonicalize()
        .map_err(|error| format!("Failed to resolve repo_root path: {error}"))
}

fn is_blocked_git_env_var(key: &str) -> bool {
    BLOCKED_GIT_ENV_VARS
        .iter()
        .any(|blocked| key.eq_ignore_ascii_case(blocked))
}

fn sanitize_git_env(env: Option<&HashMap<String, String>>) -> HashMap<String, String> {
    let Some(env_map) = env else {
        return HashMap::new();
    };

    env_map
        .iter()
        .filter(|(key, _)| !is_blocked_git_env_var(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn validate_git_args(args: &[String]) -> Result<(), String> {
    let Some(subcommand) = args.first() else {
        return Err("git args must include a subcommand".to_string());
    };

    if !ALLOWED_GIT_SUBCOMMANDS
        .iter()
        .any(|allowed| allowed == subcommand)
    {
        return Err(format!("git subcommand not allowed: {subcommand}"));
    }

    Ok(())
}

fn string_exceeds_output_limit(value: &str) -> bool {
    value.len() > MAX_GIT_OUTPUT_BYTES
}

fn apply_output_limit(response: &mut RunGitResponse) -> Result<(), String> {
    if string_exceeds_output_limit(&response.stdout) || string_exceeds_output_limit(&response.stderr)
    {
        return Err(format!(
            "git output exceeded limit of {MAX_GIT_OUTPUT_BYTES} bytes"
        ));
    }
    Ok(())
}

fn read_limited_stream(reader: &mut impl Read, max_bytes: usize) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];

    loop {
        let read = reader
            .read(&mut chunk)
            .map_err(|error| format!("Failed to read git output: {error}"))?;
        if read == 0 {
            break;
        }
        if buf.len() + read > max_bytes {
            return Err(format!("git output exceeded limit of {max_bytes} bytes"));
        }
        buf.extend_from_slice(&chunk[..read]);
    }

    Ok(decode_utf8(&buf))
}

/// Probe whether `git` is installed and readable from PATH (with Windows fallbacks).
pub fn probe_git_available() -> GitAvailableResponse {
    let binary = git_executable();
    match Command::new(binary).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = decode_utf8(&output.stdout).trim().to_string();
            GitAvailableResponse {
                available: true,
                version: Some(version),
                error: None,
                resolved_path: git_resolved_path_for_response(binary),
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
                resolved_path: None,
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => GitAvailableResponse {
            available: false,
            version: None,
            error: Some(git_not_found_error_message()),
            resolved_path: None,
        },
        Err(error) => GitAvailableResponse {
            available: false,
            version: None,
            error: Some(format!("Failed to run git --version: {error}")),
            resolved_path: None,
        },
    }
}

/// Request payload for the `git_commit_with_message` Tauri command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    pub repo_root: String,
    pub message: String,
    /// When set, the commit subprocess is registered for user-initiated cancellation.
    #[serde(default)]
    pub command_id: Option<String>,
}

fn merge_env_maps(
    base: Option<&HashMap<String, String>>,
    extra: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut merged = sanitize_git_env(base);
    for (key, value) in extra {
        if !is_blocked_git_env_var(key) {
            merged.insert(key.clone(), value.clone());
        }
    }
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
    let mut command = Command::new(git_executable());
    command
        .current_dir(repo_root)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in sanitize_git_env(env) {
        command.env(key, value);
    }

    command
}

/// Run `git` in `repo_root` with argv passed directly (no shell interpolation).
#[cfg(test)]
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
    pub timeout_ms: Option<u64>,
}

#[cfg(test)]
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
            timeout_ms: None,
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
                    timed_out: false,
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

    if let Some(id) = normalized_command_id.as_deref() {
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
                    timed_out: false,
                };
            }
        };

        if let Err(error) = register_active_git_command(id, repo_root.to_path_buf(), child) {
            return RunGitResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: error,
                duration_ms: start.elapsed().as_millis() as u64,
                cancelled: false,
                timed_out: false,
            };
        }

        let output = match wait_for_registered_git_command(id, options.timeout_ms) {
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
                    timed_out: false,
                };
            }
        };

        let cancelled = active_git_command_was_cancelled(id) && !output.timed_out;
        unregister_active_git_command(id);

        let mut response = RunGitResponse {
            exit_code: output.exit_code,
            stdout: output.stdout,
            stderr: output.stderr,
            duration_ms: start.elapsed().as_millis() as u64,
            cancelled,
            timed_out: output.timed_out,
        };
        if let Err(error) = apply_output_limit(&mut response) {
            return RunGitResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: error,
                duration_ms: start.elapsed().as_millis() as u64,
                cancelled: false,
                timed_out: false,
            };
        }
        response
    } else {
        match build_git_command(repo_root, args, effective_env).output() {
            Ok(output) => {
                let mut response = RunGitResponse {
                    exit_code: output.status.code().unwrap_or(-1),
                    stdout: decode_utf8(&output.stdout),
                    stderr: decode_utf8(&output.stderr),
                    duration_ms: start.elapsed().as_millis() as u64,
                    cancelled: false,
                    timed_out: false,
                };
                if let Err(error) = apply_output_limit(&mut response) {
                    return RunGitResponse {
                        exit_code: -1,
                        stdout: String::new(),
                        stderr: error,
                        duration_ms: start.elapsed().as_millis() as u64,
                        cancelled: false,
                        timed_out: false,
                    };
                }
                response
            }
            Err(error) => RunGitResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: error.to_string(),
                duration_ms: start.elapsed().as_millis() as u64,
                cancelled: false,
                timed_out: false,
            },
        }
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
    let response = execute_git_with_full_options(
        &repo_root,
        &[
            "commit".to_string(),
            "-F".to_string(),
            temp_arg,
        ],
        ExecuteGitOptions {
            env: None,
            command_id: request.command_id.as_deref(),
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: None,
        },
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
///
/// ## Environment and argv policy
///
/// Caller-supplied `env` is merged into the subprocess after stripping dangerous git
/// variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, etc.). Only subcommands in
/// `ALLOWED_GIT_SUBCOMMANDS` are permitted via this IPC entry point.
#[tauri::command]
pub fn run_git(request: RunGitRequest) -> Result<RunGitResponse, String> {
    validate_git_args(&request.args)?;
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
            timeout_ms: request.timeout_ms,
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

    /// Serializes tests that touch the process-wide `GitCommandRegistry`.
    ///
    /// Rust runs unit tests in parallel by default; these tests register/terminate
    /// commands in a shared global registry, so two such tests running concurrently
    /// (or one draining the registry while another relies on an entry surviving)
    /// would observe each other's state. Lock this at the start of each
    /// registry-mutating test.
    fn registry_test_mutex() -> &'static std::sync::Mutex<()> {
        static MUTEX: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        MUTEX.get_or_init(|| std::sync::Mutex::new(()))
    }

    fn next_test_dir(name: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("spec-ops-git-{name}-{id}-{}", std::process::id()))
    }

    fn create_temp_git_repo() -> PathBuf {
        let dir = next_test_dir("repo");
        fs::create_dir_all(&dir).expect("create temp repo dir");
        let init = StdCommand::new(git_executable())
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
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: None,
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
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: None,
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
            command_id: None,
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
            command_id: None,
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
        let _guard = registry_test_mutex().lock().expect("registry test lock");
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

        register_active_git_command(&command_id, PathBuf::from("/tmp/spec-ops-test"), child)
            .expect("register command");

        let wait_id = command_id.clone();
        let wait_handle = std::thread::spawn(move || wait_for_registered_git_command(&wait_id, None));

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
        let _guard = registry_test_mutex().lock().expect("registry test lock");
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

        register_active_git_command(&command_id, PathBuf::from("/tmp/spec-ops-test"), child)
            .expect("register command");

        let response = run_git(RunGitRequest {
            repo_root: repo_root.to_string_lossy().into_owned(),
            args: vec!["status".to_string()],
            env: None,
            command_id: Some(command_id.clone()),
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: None,
        })
        .expect("run_git should return response");

        assert_eq!(response.exit_code, -1);
        assert!(response.stderr.contains("already in use"));
        cancel_git_command_by_id(&command_id);
        unregister_active_git_command(&command_id);
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_timeout_terminates_in_flight_process() {
        let _guard = registry_test_mutex().lock().expect("registry test lock");
        let command_id = format!(
            "timeout-command-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sleep");

        register_active_git_command(&command_id, PathBuf::from("/tmp/spec-ops-test"), child)
            .expect("register command");

        let response =
            wait_for_registered_git_command(&command_id, Some(150)).expect("wait should return");

        assert!(response.timed_out);
        assert_eq!(response.exit_code, -1);
        assert!(response.stderr.contains("timed out"));

        unregister_active_git_command(&command_id);
    }

    #[test]
    fn run_git_rejects_nonexistent_repo_root() {
        let error = run_git(RunGitRequest {
            repo_root: "/tmp/spec-ops-git-missing-repo-path".to_string(),
            args: vec!["status".to_string()],
            env: None,
            command_id: None,
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: None,
        })
        .expect_err("missing repo_root should fail");

        assert!(error.contains("repo_root path does not exist"));
    }

    #[test]
    fn run_git_rejects_disallowed_subcommand() {
        if skip_if_git_unavailable() {
            return;
        }
        let repo_root = create_temp_git_repo();
        let error = run_git(RunGitRequest {
            repo_root: repo_root.to_string_lossy().into_owned(),
            args: vec!["clean".to_string(), "-fdx".to_string()],
            env: None,
            command_id: None,
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: None,
        })
        .expect_err("disallowed subcommand should fail");

        assert!(error.contains("git subcommand not allowed"));
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn run_git_strips_blocked_env_vars() {
        if skip_if_git_unavailable() {
            return;
        }
        let repo_root = create_temp_git_repo();
        let mut env = HashMap::new();
        env.insert("GIT_DIR".to_string(), "/tmp/evil".to_string());
        env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());

        let response = run_git(RunGitRequest {
            repo_root: repo_root.to_string_lossy().into_owned(),
            args: vec!["status".to_string()],
            env: Some(env),
            command_id: None,
            askpass_enabled: false,
            askpass_operation: None,
            askpass_timeout_ms: None,
            timeout_ms: None,
        })
        .expect("status should succeed when blocked env is stripped");

        assert_eq!(response.exit_code, 0);
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn duplicate_command_id_does_not_unregister_in_flight_command() {
        let _guard = registry_test_mutex().lock().expect("registry test lock");
        let first_id = format!(
            "duplicate-first-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let first_child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");
        register_active_git_command(&first_id, PathBuf::from("/tmp/spec-ops-test"), first_child)
            .expect("register first command");

        let duplicate_child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn duplicate sleep");
        let duplicate_error = register_active_git_command(
            &first_id,
            PathBuf::from("/tmp/spec-ops-test"),
            duplicate_child,
        )
        .expect_err("duplicate id");
        assert!(duplicate_error.contains("already in use"));

        assert!(git_command_registry()
            .commands
            .lock()
            .expect("registry lock")
            .contains_key(&first_id));

        cancel_git_command_by_id(&first_id);
        unregister_active_git_command(&first_id);
    }

    #[test]
    fn resolve_git_binary_uses_path_git_when_available() {
        if skip_if_git_unavailable() {
            return;
        }
        let resolved = resolve_git_binary();
        assert_eq!(resolved, PathBuf::from(GIT_BINARY));
        assert_eq!(git_executable(), Path::new(GIT_BINARY));
    }

    #[cfg(windows)]
    #[test]
    fn windows_git_install_candidates_follow_expected_order() {
        let candidates = windows_git_install_candidates();
        assert!(!candidates.is_empty());

        if let Ok(program_files) = std::env::var("ProgramFiles") {
            assert_eq!(
                candidates[0],
                PathBuf::from(program_files).join("Git").join("cmd").join("git.exe")
            );
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            let expected = PathBuf::from(program_files_x86)
                .join("Git")
                .join("cmd")
                .join("git.exe");
            assert!(candidates.contains(&expected));
        }
        if let Ok(local_app_data) = std::env::var("LocalAppData") {
            let expected = PathBuf::from(local_app_data)
                .join("Programs")
                .join("Git")
                .join("cmd")
                .join("git.exe");
            assert!(candidates.contains(&expected));
        }
    }

    #[test]
    fn cancel_git_command_removes_stale_index_lock_for_its_repo() {
        let _guard = registry_test_mutex().lock().expect("registry test lock");
        // Cancellation reaps the child and must clear the stale `.git/index.lock`
        // for the repo the command was registered with.
        let repo_root = create_temp_git_repo();
        let lock_path = repo_root.join(".git").join("index.lock");
        std::fs::write(&lock_path, b"stale").expect("write index.lock");
        assert!(lock_path.exists(), "lock should exist before cancel");

        let command_id = format!(
            "lock-cleanup-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");
        register_active_git_command(&command_id, repo_root.clone(), child)
            .expect("register command");

        let outcome = cancel_git_command_by_id(&command_id);
        assert_eq!(outcome.outcome, CancelGitCommandOutcome::Cancelled);

        assert!(
            !lock_path.exists(),
            "stale index.lock should be removed after the child is reaped"
        );

        unregister_active_git_command(&command_id);
        let _ = fs::remove_dir_all(repo_root);
    }

    #[test]
    fn drain_all_active_git_commands_terminates_children_and_clears_registry() {
        let _guard = registry_test_mutex().lock().expect("registry test lock");
        let command_id = format!(
            "drain-command-{}",
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");
        register_active_git_command(&command_id, PathBuf::from("/tmp/spec-ops-test"), child)
            .expect("register command");
        assert!(git_command_registry()
            .commands
            .lock()
            .expect("registry lock")
            .contains_key(&command_id));

        drain_all_active_git_commands();

        assert!(
            !git_command_registry()
                .commands
                .lock()
                .expect("registry lock")
                .contains_key(&command_id),
            "registry should be empty after drain"
        );
    }
}
