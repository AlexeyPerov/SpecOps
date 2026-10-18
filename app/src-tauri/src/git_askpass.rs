use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const ASKPASS_EVENT: &str = "spec-ops/git/askpass-request";
/// Emitted once a request no longer needs an answer (answered in some window,
/// cancelled, timed out, or the git process ended) so every window can close its
/// copy of the dialog.
const ASKPASS_RESOLVED_EVENT: &str = "spec-ops/git/askpass-resolved";
const DEFAULT_ASKPASS_TIMEOUT_MS: u64 = 120_000;
const PROMPT_FILE: &str = "prompt";
const RESPONSE_FILE: &str = "response";
const RESPONSE_TMP_FILE: &str = "response.tmp";
/// Marker the helper scripts poll for; its presence makes them exit non-zero at once.
const CANCEL_FILE: &str = "cancel";
const ASKPASS_SCRIPT_UNIX: &str = "askpass.sh";
const ASKPASS_SCRIPT_WINDOWS: &str = "askpass.cmd";
/// Helper poll interval (the scripts sleep ~50 ms between checks).
const HELPER_POLL_MS: u64 = 50;
/// Extra time the helper waits beyond the answer timeout before giving up on its
/// own. The watcher normally ends the wait first by writing the cancel marker; this
/// cap only matters if the app died and nobody will ever answer.
const HELPER_GRACE_MS: u64 = 10_000;
const FALLBACK_PROMPT: &str = "Git credential:";

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAskpassRequestEvent {
    pub session_id: String,
    pub request_id: String,
    pub prompt: String,
    pub host_hint: Option<String>,
    pub username_hint: Option<String>,
    pub input_kind: String,
    pub operation: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAskpassResolvedEvent {
    pub session_id: String,
    pub request_id: String,
    /// `answered`, `cancelled`, `timedOut` or `ended`.
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondGitAskpassRequest {
    pub session_id: String,
    pub request_id: String,
    pub value: String,
    #[serde(default)]
    pub cancelled: bool,
}

struct AskpassSession {
    session_id: String,
    dir: PathBuf,
    operation: Option<String>,
    timeout_ms: u64,
    cancelled: AtomicBool,
    active_request_id: Mutex<Option<String>>,
    response_ready: (Mutex<bool>, Condvar),
}

struct AskpassState {
    sessions: Mutex<HashMap<String, Arc<AskpassSession>>>,
    watchers: Mutex<HashMap<String, thread::JoinHandle<()>>>,
    app_handle: Mutex<Option<AppHandle>>,
}

fn askpass_state() -> &'static AskpassState {
    static STATE: OnceLock<AskpassState> = OnceLock::new();
    STATE.get_or_init(|| AskpassState {
        sessions: Mutex::new(HashMap::new()),
        watchers: Mutex::new(HashMap::new()),
        app_handle: Mutex::new(None),
    })
}

/// Lock and recover from poisoning. All guarded state here is plain data that stays
/// consistent across a panic, and refusing to proceed would leave git waiting on a
/// helper that nobody answers or cancels.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

pub fn set_git_askpass_app_handle(app_handle: AppHandle) {
    *lock(&askpass_state().app_handle) = Some(app_handle);
}

fn emit_event<S: Serialize + Clone>(event: &str, payload: S) {
    let handle = lock(&askpass_state().app_handle).clone();
    if let Some(app_handle) = handle {
        let _ = app_handle.emit(event, payload);
    }
}

fn emit_askpass_request(payload: GitAskpassRequestEvent) {
    emit_event(ASKPASS_EVENT, payload);
}

fn emit_askpass_resolved(session_id: &str, request_id: &str, reason: &str) {
    emit_event(
        ASKPASS_RESOLVED_EVENT,
        GitAskpassResolvedEvent {
            session_id: session_id.to_string(),
            request_id: request_id.to_string(),
            reason: reason.to_string(),
        },
    );
}

fn parse_input_kind(prompt: &str) -> &'static str {
    let lower = prompt.to_lowercase();
    if lower.contains("username") || lower.contains("user name") {
        return "username";
    }
    if lower.contains("passphrase") {
        return "passphrase";
    }
    "password"
}

/// Strip `user[:password]@` from an authority.
fn strip_userinfo(authority: &str) -> &str {
    authority.rsplit_once('@').map_or(authority, |(_, host)| host)
}

/// The `scheme://authority` URL inside a prompt, authority only (up to the first
/// quote, slash or whitespace).
fn url_authority(prompt: &str) -> Option<&str> {
    let start = prompt.find("://")? + 3;
    let rest = &prompt[start..];
    let end = rest
        .find(|ch: char| ch == '\'' || ch == '"' || ch == '/' || ch.is_whitespace())
        .unwrap_or(rest.len());
    Some(&rest[..end])
}

/// Leading `user@host's` token of an SSH password prompt (`alice@host's password:`).
fn ssh_login_token(prompt: &str) -> Option<(&str, &str)> {
    let token = prompt.split_whitespace().next()?;
    if token.contains("://") {
        return None;
    }
    let token = token.strip_suffix("'s").unwrap_or(token);
    let (user, host) = token.split_once('@')?;
    if user.is_empty() || host.is_empty() {
        return None;
    }
    Some((user, host))
}

fn parse_host_hint(prompt: &str) -> Option<String> {
    if let Some(authority) = url_authority(prompt) {
        let host = strip_userinfo(authority);
        // Drop a `:port` suffix for display.
        let host = host.split(':').next().unwrap_or(host).trim();
        if !host.is_empty() {
            return Some(host.to_string());
        }
    }
    if let Some((_, host)) = ssh_login_token(prompt) {
        return Some(host.to_string());
    }
    for pattern in ["'git@", "for '", "for \""] {
        if let Some(start) = prompt.find(pattern) {
            let remainder = &prompt[start + pattern.len()..];
            let end = remainder.find(['\'', '"', ':']).unwrap_or(remainder.len());
            let host = remainder[..end].trim();
            if !host.is_empty() {
                return Some(host.to_string());
            }
        }
    }
    None
}

fn parse_username_hint(prompt: &str) -> Option<String> {
    if let Some(authority) = url_authority(prompt) {
        if let Some((userinfo, _)) = authority.rsplit_once('@') {
            let user = userinfo.split(':').next().unwrap_or(userinfo).trim();
            if !user.is_empty() {
                return Some(user.to_string());
            }
        }
        return None;
    }
    ssh_login_token(prompt).map(|(user, _)| user.to_string())
}

fn write_unix_askpass_script(path: &Path) -> Result<(), String> {
    // The prompt is published with an atomic rename so the watcher never reads a
    // partial prompt. The wait loop ends on the response, on the cancel marker, when
    // the session dir disappears, or after the poll cap.
    let script = r#"#!/bin/sh
set -eu
prompt="${1-}"
dir="${SPECOPS_GIT_ASKPASS_DIR:?}"
max="${SPECOPS_GIT_ASKPASS_MAX_POLLS:-2400}"
if [ ! -d "$dir" ] || [ -f "$dir/cancel" ]; then
  exit 1
fi
printf '%s' "$prompt" > "$dir/prompt.tmp"
mv -f "$dir/prompt.tmp" "$dir/prompt"
i=0
while :; do
  if [ -f "$dir/cancel" ] || [ ! -d "$dir" ]; then
    exit 1
  fi
  if [ -f "$dir/response" ]; then
    break
  fi
  sleep 0.05
  i=$((i + 1))
  if [ "$i" -gt "$max" ]; then
    exit 1
  fi
done
cat "$dir/response"
rm -f "$dir/response"
"#;
    // F48: write the helper script with O_EXCL and the final mode set atomically
    // at create time. `create_new` refuses a pre-existing file or symlink; the mode
    // is applied via `OpenOptions::mode` so no chmod step is needed afterwards.
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .open(path)
            .map_err(|error| format!("Failed to create askpass helper script: {error}"))?;
        file.write_all(script.as_bytes())
            .map_err(|error| format!("Failed to write askpass helper script: {error}"))?;
    }
    #[cfg(not(unix))]
    {
        fs::write(path, script.as_bytes())
            .map_err(|error| format!("Failed to write askpass helper script: {error}"))?;
    }
    Ok(())
}

fn write_windows_askpass_script(path: &Path) -> Result<(), String> {
    let script = r#"@echo off
setlocal EnableExtensions
set "SPECOPS_GIT_ASKPASS_PROMPT=%~1"
if not defined SPECOPS_GIT_ASKPASS_DIR exit /b 1
if not defined SPECOPS_GIT_ASKPASS_MAX_POLLS set "SPECOPS_GIT_ASKPASS_MAX_POLLS=2400"
if not exist "%SPECOPS_GIT_ASKPASS_DIR%\" exit /b 1
if exist "%SPECOPS_GIT_ASKPASS_DIR%\cancel" exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d = $env:SPECOPS_GIT_ASKPASS_DIR; $t = Join-Path $d 'prompt.tmp'; [IO.File]::WriteAllText($t, $env:SPECOPS_GIT_ASKPASS_PROMPT); Move-Item -LiteralPath $t -Destination (Join-Path $d 'prompt') -Force" ^
  || exit /b 1
set /a COUNT=0
:wait_loop
if exist "%SPECOPS_GIT_ASKPASS_DIR%\cancel" exit /b 1
if not exist "%SPECOPS_GIT_ASKPASS_DIR%\" exit /b 1
if exist "%SPECOPS_GIT_ASKPASS_DIR%\response" goto respond
ping -n 1 -w 50 127.0.0.1 >nul
set /a COUNT+=1
if %COUNT% GTR %SPECOPS_GIT_ASKPASS_MAX_POLLS% exit /b 1
goto wait_loop
:respond
type "%SPECOPS_GIT_ASKPASS_DIR%\response"
del /f /q "%SPECOPS_GIT_ASKPASS_DIR%\response" >nul 2>&1
endlocal
"#;
    fs::write(path, script.as_bytes()).map_err(|error| error.to_string())
}

fn create_askpass_script(session_dir: &Path) -> Result<PathBuf, String> {
    let script_name = if cfg!(windows) {
        ASKPASS_SCRIPT_WINDOWS
    } else {
        ASKPASS_SCRIPT_UNIX
    };
    let script_path = session_dir.join(script_name);
    if cfg!(windows) {
        write_windows_askpass_script(&script_path)?;
    } else {
        write_unix_askpass_script(&script_path)?;
    }
    Ok(script_path)
}

/// Restrict a directory to owner-only access (`0700`).
///
/// Askpass session dirs live under the process temp dir. On Linux that is often
/// world-writable `/tmp` (mode `1777`), so default `0755` dirs would let any local
/// user read the password/PAT response file and plant a symlink over `askpass.sh`.
#[cfg(unix)]
fn set_owner_only_dir_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)
        .map_err(|error| format!("Failed to read askpass dir metadata: {error}"))?
        .permissions();
    perms.set_mode(0o700);
    fs::set_permissions(path, perms)
        .map_err(|error| format!("Failed to set askpass dir permissions: {error}"))
}

/// Create a directory (and parents) with owner-only mode `0700`, atomically on
/// Unix so there is no default-umask window between creation and the chmod.
fn create_owner_only_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        builder.mode(0o700);
        builder
            .create(path)
            .map_err(|error| format!("Failed to create askpass dir: {error}"))?;
        // Re-assert 0700 on the leaf in case it pre-existed with looser perms.
        set_owner_only_dir_permissions(path)?;
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(path)
            .map_err(|error| format!("Failed to create askpass dir: {error}"))?;
    }
    Ok(())
}

/// Publish the askpass response atomically: write a `0600` temp file created
/// exclusively (a planted symlink cannot redirect the secret), then rename it over
/// the final name. The helper only looks for the final name, so it can never read a
/// half-written secret.
fn write_askpass_response(session_dir: &Path, value: &str) -> Result<(), String> {
    let tmp_path = session_dir.join(RESPONSE_TMP_FILE);
    let response_path = session_dir.join(RESPONSE_FILE);
    // Defeat a pre-planted symlink / leftover file before the exclusive create.
    let _ = fs::remove_file(&tmp_path);

    let write_result = (|| -> std::io::Result<()> {
        #[cfg(unix)]
        let mut file = {
            use std::fs::OpenOptions;
            use std::os::unix::fs::OpenOptionsExt;
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&tmp_path)?
        };
        #[cfg(not(unix))]
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)?;
        file.write_all(value.as_bytes())?;
        file.flush()?;
        drop(file);
        fs::rename(&tmp_path, &response_path)
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Failed to write askpass response: {error}"));
    }
    Ok(())
}

/// Mark the session cancelled and make the helper exit now instead of polling until
/// its own cap (which would keep git hung for minutes after the user cancelled).
fn cancel_session(session: &AskpassSession) {
    session.cancelled.store(true, Ordering::SeqCst);
    let _ = fs::remove_file(session.dir.join(RESPONSE_FILE));
    let _ = fs::remove_file(session.dir.join(RESPONSE_TMP_FILE));
    let _ = fs::write(session.dir.join(CANCEL_FILE), b"");
    let (ready_lock, cvar) = &session.response_ready;
    *lock(ready_lock) = true;
    cvar.notify_all();
}

/// Clear the active request if it is still `request_id`. Returns whether this call
/// claimed it (a concurrent answer may have claimed it first).
fn take_active_request(session: &AskpassSession, request_id: &str) -> bool {
    let mut active = lock(&session.active_request_id);
    if active.as_deref() == Some(request_id) {
        *active = None;
        true
    } else {
        false
    }
}

/// Read and consume the published prompt, if any.
fn take_prompt(prompt_path: &Path) -> Option<String> {
    let bytes = fs::read(prompt_path).ok()?;
    let _ = fs::remove_file(prompt_path);
    let prompt = String::from_utf8_lossy(&bytes).trim().to_string();
    Some(if prompt.is_empty() {
        FALLBACK_PROMPT.to_string()
    } else {
        prompt
    })
}

/// Wait for the next helper prompt, forward it, and wait for the answer.
///
/// Returns `true` once the prompt was answered (the watcher then waits for the next
/// prompt) and `false` when the session is cancelled, ended, or the answer timed out.
/// Waiting for a prompt has no deadline: git may legitimately run for a long time
/// before its next credential prompt (submodules, several remotes). Only the wait
/// for the user's answer is bounded by the session timeout.
fn wait_for_prompt_and_respond(session: &Arc<AskpassSession>, request_counter: &mut u64) -> bool {
    let prompt_path = session.dir.join(PROMPT_FILE);
    let prompt = loop {
        if session.cancelled.load(Ordering::SeqCst) {
            return false;
        }
        if let Some(prompt) = take_prompt(&prompt_path) {
            break prompt;
        }
        thread::sleep(Duration::from_millis(HELPER_POLL_MS));
    };

    *request_counter += 1;
    let request_id = format!("askpass-{request_counter}");
    // The previous helper consumed its response before exiting; anything left over is
    // stale and must not answer this prompt.
    let _ = fs::remove_file(session.dir.join(RESPONSE_FILE));
    let (ready_lock, cvar) = &session.response_ready;
    *lock(ready_lock) = false;
    *lock(&session.active_request_id) = Some(request_id.clone());

    emit_askpass_request(GitAskpassRequestEvent {
        session_id: session.session_id.clone(),
        request_id: request_id.clone(),
        host_hint: parse_host_hint(&prompt),
        username_hint: parse_username_hint(&prompt),
        input_kind: parse_input_kind(&prompt).to_string(),
        prompt,
        operation: session.operation.clone(),
        timeout_ms: session.timeout_ms,
    });

    let deadline = Instant::now() + Duration::from_millis(session.timeout_ms);
    // Set once a responder claimed the request; from then on we wait for its signal
    // without a deadline (it always signals, success or failure).
    let mut answer_claimed = false;
    let mut ready = lock(ready_lock);
    while !*ready && !session.cancelled.load(Ordering::SeqCst) {
        let now = Instant::now();
        if !answer_claimed && now >= deadline {
            drop(ready);
            if take_active_request(session, &request_id) {
                cancel_session(session);
                emit_askpass_resolved(&session.session_id, &request_id, "timedOut");
                return false;
            }
            answer_claimed = true;
            ready = lock(ready_lock);
            continue;
        }
        let wait = if answer_claimed {
            Duration::from_millis(100)
        } else {
            deadline.saturating_duration_since(now).min(Duration::from_millis(100))
        };
        ready = match cvar.wait_timeout(ready, wait) {
            Ok((guard, _)) => guard,
            Err(poison) => poison.into_inner().0,
        };
    }

    // Trust the condvar flag, not `response_path.exists()`: the helper deletes the
    // response file as soon as it reads it.
    let answered = *ready && !session.cancelled.load(Ordering::SeqCst);
    *ready = false;
    answered
}

fn spawn_prompt_watcher(session: Arc<AskpassSession>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut request_counter = 0u64;
        while !session.cancelled.load(Ordering::SeqCst) {
            if !wait_for_prompt_and_respond(&session, &mut request_counter) {
                break;
            }
        }
    })
}

pub struct PreparedAskpassSession {
    pub session_id: String,
    pub env: HashMap<String, String>,
}

fn next_session_id() -> String {
    // The clock alone has only microsecond resolution on some platforms; the counter
    // keeps two sessions prepared at the same instant apart.
    format!(
        "askpass-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0),
        SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn helper_max_polls(timeout_ms: u64) -> u64 {
    timeout_ms.saturating_add(HELPER_GRACE_MS) / HELPER_POLL_MS
}

pub fn prepare_askpass_session(
    operation: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<PreparedAskpassSession, String> {
    let session_id = next_session_id();
    let askpass_root = std::env::temp_dir().join("spec-ops-git-askpass");
    // The root is shared across sessions and may already exist; create with the
    // owner-only mode and re-assert perms.
    create_owner_only_dir(&askpass_root)?;

    let session_dir = askpass_root.join(&session_id);
    create_owner_only_dir(&session_dir)?;

    let script_path = match create_askpass_script(&session_dir) {
        Ok(path) => path,
        Err(error) => {
            let _ = fs::remove_dir_all(&session_dir);
            return Err(error);
        }
    };
    let timeout = timeout_ms.unwrap_or(DEFAULT_ASKPASS_TIMEOUT_MS);

    let session = Arc::new(AskpassSession {
        session_id: session_id.clone(),
        dir: session_dir.clone(),
        operation: operation.map(str::to_string),
        timeout_ms: timeout,
        cancelled: AtomicBool::new(false),
        active_request_id: Mutex::new(None),
        response_ready: (Mutex::new(false), Condvar::new()),
    });

    lock(&askpass_state().sessions).insert(session_id.clone(), session.clone());
    let watcher = spawn_prompt_watcher(session);
    lock(&askpass_state().watchers).insert(session_id.clone(), watcher);

    Ok(PreparedAskpassSession {
        env: askpass_env(&script_path, &session_dir, timeout),
        session_id,
    })
}

fn askpass_env(script_path: &Path, session_dir: &Path, timeout_ms: u64) -> HashMap<String, String> {
    let script = script_path.to_string_lossy().into_owned();
    let mut env = HashMap::new();
    env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
    env.insert("GIT_ASKPASS".to_string(), script.clone());
    env.insert("SSH_ASKPASS".to_string(), script);
    // OpenSSH only consults SSH_ASKPASS without a tty when DISPLAY is set, unless
    // SSH_ASKPASS_REQUIRE says otherwise; a GUI app usually has neither a tty nor
    // DISPLAY, so key passphrase prompts would never reach the helper.
    env.insert("SSH_ASKPASS_REQUIRE".to_string(), "force".to_string());
    env.insert(
        "SPECOPS_GIT_ASKPASS_DIR".to_string(),
        session_dir.to_string_lossy().into_owned(),
    );
    env.insert(
        "SPECOPS_GIT_ASKPASS_MAX_POLLS".to_string(),
        helper_max_polls(timeout_ms).to_string(),
    );
    env.insert(
        "GIT_SSH_COMMAND".to_string(),
        "ssh -o StrictHostKeyChecking=yes".to_string(),
    );
    env
}

pub fn respond_git_askpass(request: RespondGitAskpassRequest) -> Result<(), String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id must not be empty".to_string());
    }

    let session = lock(&askpass_state().sessions)
        .get(session_id)
        .cloned()
        .ok_or_else(|| format!("askpass session not found: {session_id}"))?;

    respond_to_session(&session, request.request_id.trim(), &request.value, request.cancelled)
}

fn respond_to_session(
    session: &AskpassSession,
    request_id: &str,
    value: &str,
    cancelled: bool,
) -> Result<(), String> {
    // Each request accepts exactly one answer: a duplicate (another window, a retry)
    // must not leave a stale response file that would answer the next prompt.
    if !take_active_request(session, request_id) {
        return Err("askpass request id does not match active request".to_string());
    }

    if cancelled {
        cancel_session(session);
        emit_askpass_resolved(&session.session_id, request_id, "cancelled");
        return Ok(());
    }

    if let Err(error) = write_askpass_response(&session.dir, value) {
        // The request is already claimed; fail the helper now rather than leaving git
        // waiting for an answer that can no longer arrive.
        cancel_session(session);
        emit_askpass_resolved(&session.session_id, request_id, "cancelled");
        return Err(error);
    }

    let (ready_lock, cvar) = &session.response_ready;
    *lock(ready_lock) = true;
    cvar.notify_all();
    emit_askpass_resolved(&session.session_id, request_id, "answered");
    Ok(())
}

pub fn end_askpass_session(session_id: &str) {
    // Recover from poison so teardown always runs — the session is ending regardless.
    let session = lock(&askpass_state().sessions).remove(session_id);
    let watcher = lock(&askpass_state().watchers).remove(session_id);

    if let Some(session) = session {
        let pending_request = lock(&session.active_request_id).take();
        cancel_session(&session);
        if let Some(request_id) = pending_request {
            emit_askpass_resolved(&session.session_id, &request_id, "ended");
        }
        let _ = fs::remove_dir_all(&session.dir);
    }

    if let Some(watcher) = watcher {
        let _ = watcher.join();
    }
}

pub fn build_askpass_env_for_operation(
    operation: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<(HashMap<String, String>, String), String> {
    let prepared = prepare_askpass_session(operation, timeout_ms)?;
    Ok((prepared.env, prepared.session_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_session_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "spec-ops-askpass-{tag}-{}-{}",
            std::process::id(),
            next_session_id()
        ));
        fs::create_dir_all(&dir).expect("create session dir");
        dir
    }

    fn test_session(dir: &Path, timeout_ms: u64) -> Arc<AskpassSession> {
        Arc::new(AskpassSession {
            session_id: "test-session".to_string(),
            dir: dir.to_path_buf(),
            operation: Some("push".to_string()),
            timeout_ms,
            cancelled: AtomicBool::new(false),
            active_request_id: Mutex::new(None),
            response_ready: (Mutex::new(false), Condvar::new()),
        })
    }

    fn wait_for_active(session: &AskpassSession) -> Option<String> {
        for _ in 0..200 {
            if let Some(id) = lock(&session.active_request_id).clone() {
                return Some(id);
            }
            thread::sleep(Duration::from_millis(10));
        }
        None
    }

    #[test]
    fn parse_input_kind_detects_username_and_password() {
        assert_eq!(parse_input_kind("Username for 'https://github.com':"), "username");
        assert_eq!(parse_input_kind("Password for 'https://github.com':"), "password");
        assert_eq!(
            parse_input_kind("Enter passphrase for key '/home/id_rsa':"),
            "passphrase"
        );
    }

    #[test]
    fn parse_host_hint_extracts_host_without_userinfo() {
        assert_eq!(
            parse_host_hint("Username for 'https://github.com':"),
            Some("github.com".to_string())
        );
        assert_eq!(
            parse_host_hint("Password for 'https://alice@github.com':"),
            Some("github.com".to_string())
        );
        assert_eq!(
            parse_host_hint("Password for 'https://alice@git.example.com:8443':"),
            Some("git.example.com".to_string())
        );
        assert_eq!(
            parse_host_hint("alice@host.example's password:"),
            Some("host.example".to_string())
        );
    }

    #[test]
    fn parse_username_hint_reads_url_userinfo_and_ssh_login() {
        assert_eq!(
            parse_username_hint("Password for 'https://alice@github.com':"),
            Some("alice".to_string())
        );
        assert_eq!(
            parse_username_hint("Password for 'https://bob:token@github.com':"),
            Some("bob".to_string())
        );
        assert_eq!(parse_username_hint("Username for 'https://github.com':"), None);
        assert_eq!(
            parse_username_hint("git@github.com's password:"),
            Some("git".to_string())
        );
        assert_eq!(
            parse_username_hint("Enter passphrase for key '/home/a/.ssh/id_ed25519':"),
            None
        );
    }

    #[test]
    fn session_ids_are_unique_when_prepared_at_the_same_instant() {
        let ids: std::collections::HashSet<_> = (0..1000).map(|_| next_session_id()).collect();
        assert_eq!(ids.len(), 1000);
    }

    #[test]
    fn askpass_env_forces_ssh_askpass_and_caps_helper_wait() {
        let env = askpass_env(Path::new("/tmp/askpass.sh"), Path::new("/tmp/session"), 120_000);
        assert_eq!(env.get("SSH_ASKPASS_REQUIRE").map(String::as_str), Some("force"));
        assert!(!env.contains_key("GIT_ASKPASS_REQUIRE"));
        assert_eq!(
            env.get("SPECOPS_GIT_ASKPASS_MAX_POLLS").map(String::as_str),
            Some("2600")
        );
    }

    #[cfg(unix)]
    #[test]
    fn response_is_published_atomically_with_owner_only_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_session_dir("write");
        // A leftover temp file (or planted symlink) must not block or redirect the write.
        fs::write(dir.join(RESPONSE_TMP_FILE), b"stale").unwrap();
        write_askpass_response(&dir, "s3cret ").expect("write response");
        assert!(!dir.join(RESPONSE_TMP_FILE).exists());
        let response = dir.join(RESPONSE_FILE);
        assert_eq!(fs::read_to_string(&response).unwrap(), "s3cret ");
        assert_eq!(fs::metadata(&response).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn duplicate_answer_for_the_same_request_is_rejected() {
        let dir = temp_session_dir("duplicate");
        let session = test_session(&dir, 2_000);
        *lock(&session.active_request_id) = Some("askpass-1".to_string());
        respond_to_session(&session, "askpass-1", "alice", false).expect("first answer");
        fs::remove_file(dir.join(RESPONSE_FILE)).expect("helper consumes the answer");
        assert!(respond_to_session(&session, "askpass-1", "again", false).is_err());
        assert!(respond_to_session(&session, "askpass-1", "", true).is_err());
        assert!(!dir.join(RESPONSE_FILE).exists(), "no stale answer for the next prompt");
        assert!(!session.cancelled.load(Ordering::SeqCst));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cancel_writes_marker_and_stops_the_watcher() {
        let dir = temp_session_dir("cancel");
        let session = test_session(&dir, 5_000);
        fs::write(dir.join(PROMPT_FILE), b"Password for 'https://example.com':").unwrap();
        let watcher = spawn_prompt_watcher(Arc::clone(&session));
        let request_id = wait_for_active(&session).expect("prompt forwarded");
        respond_to_session(&session, &request_id, "", true).expect("cancel");
        watcher.join().expect("watcher exits");
        assert!(dir.join(CANCEL_FILE).exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn watcher_waits_for_late_prompts_without_a_deadline() {
        let dir = temp_session_dir("late-prompt");
        // A timeout shorter than the gap before the prompt: the prompt wait must not
        // consume it.
        let session = test_session(&dir, 150);
        let watcher = spawn_prompt_watcher(Arc::clone(&session));
        thread::sleep(Duration::from_millis(400));
        assert!(!watcher.is_finished(), "watcher must keep waiting for a prompt");
        fs::write(dir.join(PROMPT_FILE), b"Password:").unwrap();
        let request_id = wait_for_active(&session).expect("late prompt forwarded");
        respond_to_session(&session, &request_id, "pw", false).expect("answer");
        thread::sleep(Duration::from_millis(100));
        assert!(!watcher.is_finished(), "watcher continues to the next prompt");
        cancel_session(&session);
        watcher.join().expect("watcher exits");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unanswered_prompt_times_out_and_rejects_late_answers() {
        let dir = temp_session_dir("answer-timeout");
        let session = test_session(&dir, 150);
        fs::write(dir.join(PROMPT_FILE), b"Password:").unwrap();
        let mut counter = 0;
        assert!(!wait_for_prompt_and_respond(&session, &mut counter));
        assert!(session.cancelled.load(Ordering::SeqCst));
        assert!(dir.join(CANCEL_FILE).exists(), "helper is told to exit");
        assert!(respond_to_session(&session, "askpass-1", "late", false).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn wait_for_prompt_continues_when_response_file_already_consumed() {
        let dir = temp_session_dir("race");
        let session = test_session(&dir, 2_000);
        fs::write(dir.join(PROMPT_FILE), b"Password for 'https://example.com':").unwrap();

        let responder_session = Arc::clone(&session);
        let responder = thread::spawn(move || {
            wait_for_active(&responder_session);
            // Signal readiness without leaving a response file — simulating the
            // helper script consuming it first.
            let (ready_lock, cvar) = &responder_session.response_ready;
            *lock(ready_lock) = true;
            cvar.notify_all();
        });

        let mut counter = 0u64;
        let continued = wait_for_prompt_and_respond(&session, &mut counter);
        responder.join().expect("responder");
        let _ = fs::remove_dir_all(&dir);
        assert!(continued);
        assert_eq!(counter, 1);
    }

    #[cfg(unix)]
    fn run_helper(dir: &Path, script: &Path) -> std::process::Child {
        std::process::Command::new(script)
            .arg("Password for 'https://example.com':")
            .env("SPECOPS_GIT_ASKPASS_DIR", dir)
            .env("SPECOPS_GIT_ASKPASS_MAX_POLLS", "200")
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("spawn helper")
    }

    #[cfg(unix)]
    fn wait_exit(child: &mut std::process::Child, within: Duration) -> Option<std::process::ExitStatus> {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if let Some(status) = child.try_wait().expect("try_wait") {
                return Some(status);
            }
            thread::sleep(Duration::from_millis(20));
        }
        let _ = child.kill();
        None
    }

    #[cfg(unix)]
    #[test]
    fn unix_helper_prints_answer_and_exits_on_cancel_marker() {
        use std::io::Read;
        let dir = temp_session_dir("helper");
        let script = create_askpass_script(&dir).expect("script");

        let mut answered = run_helper(&dir, &script);
        let prompt_path = dir.join(PROMPT_FILE);
        let deadline = Instant::now() + Duration::from_secs(3);
        while !prompt_path.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(fs::read_to_string(&prompt_path).unwrap(), "Password for 'https://example.com':");
        fs::remove_file(&prompt_path).unwrap();
        write_askpass_response(&dir, "pw").unwrap();
        let status = wait_exit(&mut answered, Duration::from_secs(3)).expect("helper exits");
        assert!(status.success());
        let mut output = String::new();
        answered.stdout.take().unwrap().read_to_string(&mut output).unwrap();
        assert_eq!(output, "pw");
        assert!(!dir.join(RESPONSE_FILE).exists());

        let mut cancelled = run_helper(&dir, &script);
        thread::sleep(Duration::from_millis(150));
        fs::write(dir.join(CANCEL_FILE), b"").unwrap();
        let status = wait_exit(&mut cancelled, Duration::from_secs(2)).expect("exits on cancel");
        assert!(!status.success());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unix_helper_exits_when_session_dir_disappears() {
        let root = temp_session_dir("helper-gone");
        let dir = root.join("session");
        fs::create_dir_all(&dir).unwrap();
        // Keep the script outside the dir that is removed.
        let script = create_askpass_script(&root).expect("script");
        let mut child = run_helper(&dir, &script);
        thread::sleep(Duration::from_millis(150));
        fs::remove_dir_all(&dir).unwrap();
        let status = wait_exit(&mut child, Duration::from_secs(2)).expect("exits when dir is gone");
        assert!(!status.success());
        let _ = fs::remove_dir_all(&root);
    }
}
