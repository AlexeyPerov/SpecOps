use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const ASKPASS_EVENT: &str = "spec-ops/git/askpass-request";
const DEFAULT_ASKPASS_TIMEOUT_MS: u64 = 120_000;
const PROMPT_FILE: &str = "prompt";
const RESPONSE_FILE: &str = "response";
const ASKPASS_SCRIPT_UNIX: &str = "askpass.sh";
const ASKPASS_SCRIPT_WINDOWS: &str = "askpass.cmd";

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

pub fn set_git_askpass_app_handle(app_handle: AppHandle) {
    if let Ok(mut handle) = askpass_state().app_handle.lock() {
        *handle = Some(app_handle);
    }
}

fn emit_askpass_request(payload: GitAskpassRequestEvent) {
    let Ok(handle_guard) = askpass_state().app_handle.lock() else {
        return;
    };
    let Some(app_handle) = handle_guard.as_ref() else {
        return;
    };
    let _ = app_handle.emit(ASKPASS_EVENT, payload);
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

fn parse_host_hint(prompt: &str) -> Option<String> {
    for pattern in ["'https://", "'http://", "'git@", "for '", "for \""] {
        if let Some(start) = prompt.find(pattern) {
            let value_start = start + pattern.len();
            let remainder = &prompt[value_start..];
            let end = remainder
                .find(['\'', '"', ':'])
                .unwrap_or(remainder.len());
            let host = remainder[..end].trim();
            if !host.is_empty() {
                return Some(host.to_string());
            }
        }
    }
    None
}

fn parse_username_hint(prompt: &str) -> Option<String> {
    if let Some(at_index) = prompt.find('@') {
        let prefix = &prompt[..at_index];
        if let Some(start) = prefix.rfind([' ', '\t']) {
            let candidate = prefix[start..].trim();
            if !candidate.is_empty() && !candidate.to_lowercase().contains("username") {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn write_unix_askpass_script(path: &Path) -> Result<(), String> {
    let script = r#"#!/bin/sh
set -eu
prompt="$1"
dir="${SPECOPS_GIT_ASKPASS_DIR:?}"
printf '%s' "$prompt" > "$dir/prompt"
i=0
while [ ! -f "$dir/response" ]; do
  sleep 0.05
  i=$((i + 1))
  if [ "$i" -gt 2400 ]; then
    exit 1
  fi
done
cat "$dir/response"
rm -f "$dir/response"
"#;
    fs::write(path, script.as_bytes()).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)
            .map_err(|error| error.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_windows_askpass_script(path: &Path) -> Result<(), String> {
    let script = r#"@echo off
setlocal
set "PROMPT_TEXT=%~1"
if not defined SPECOPS_GIT_ASKPASS_DIR exit /b 1
> "%SPECOPS_GIT_ASKPASS_DIR%\prompt" echo %PROMPT_TEXT%
set /a COUNT=0
:wait_loop
if exist "%SPECOPS_GIT_ASKPASS_DIR%\response" goto respond
ping -n 1 -w 50 127.0.0.1 >nul
set /a COUNT+=1
if %COUNT% GTR 2400 exit /b 1
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

fn wait_for_prompt_and_respond(session: &Arc<AskpassSession>, request_counter: &mut u64) -> bool {
    let prompt_path = session.dir.join(PROMPT_FILE);
    let response_path = session.dir.join(RESPONSE_FILE);
    let started = Instant::now();
    let timeout = Duration::from_millis(session.timeout_ms);

    loop {
        if session.cancelled.load(Ordering::SeqCst) {
            return false;
        }
        if started.elapsed() > timeout {
            return false;
        }

        if prompt_path.exists() {
            let prompt = fs::read_to_string(&prompt_path).unwrap_or_default();
            let trimmed = prompt.trim();
            if !trimmed.is_empty() {
                *request_counter += 1;
                let request_id = format!("askpass-{request_counter}");
                if let Ok(mut active) = session.active_request_id.lock() {
                    *active = Some(request_id.clone());
                }
                let _ = fs::remove_file(&prompt_path);

                emit_askpass_request(GitAskpassRequestEvent {
                    session_id: session.session_id.clone(),
                    request_id: request_id.clone(),
                    prompt: trimmed.to_string(),
                    host_hint: parse_host_hint(trimmed),
                    username_hint: parse_username_hint(trimmed),
                    input_kind: parse_input_kind(trimmed).to_string(),
                    operation: session.operation.clone(),
                    timeout_ms: session.timeout_ms,
                });

                let (lock, cvar) = &session.response_ready;
                let mut ready = lock.lock().expect("askpass response lock");
                while !*ready && !session.cancelled.load(Ordering::SeqCst) {
                    let remaining = timeout.saturating_sub(started.elapsed());
                    if remaining.is_zero() {
                        return false;
                    }
                    ready = cvar
                        .wait_timeout(ready, Duration::from_millis(100))
                        .expect("askpass response wait")
                        .0;
                }

                if session.cancelled.load(Ordering::SeqCst) {
                    return false;
                }

                if response_path.exists() {
                    *ready = false;
                    return true;
                }
                return false;
            }
        }

        thread::sleep(Duration::from_millis(50));
    }
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

pub fn prepare_askpass_session(
    operation: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<PreparedAskpassSession, String> {
    let session_id = format!(
        "askpass-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    );
    let session_dir = std::env::temp_dir()
        .join("spec-ops-git-askpass")
        .join(&session_id);
    fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create askpass session dir: {error}"))?;

    let script_path = create_askpass_script(&session_dir)?;
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

    let watcher = spawn_prompt_watcher(session.clone());
    {
        let Ok(mut sessions) = askpass_state().sessions.lock() else {
            return Err("askpass session registry lock poisoned".to_string());
        };
        sessions.insert(session_id.clone(), session);
    }
    {
        let Ok(mut watchers) = askpass_state().watchers.lock() else {
            return Err("askpass watcher registry lock poisoned".to_string());
        };
        watchers.insert(session_id.clone(), watcher);
    }

    let mut env = HashMap::new();
    env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
    env.insert(
        "GIT_ASKPASS".to_string(),
        script_path.to_string_lossy().into_owned(),
    );
    env.insert(
        "SSH_ASKPASS".to_string(),
        script_path.to_string_lossy().into_owned(),
    );
    env.insert("GIT_ASKPASS_REQUIRE".to_string(), "force".to_string());
    env.insert(
        "SPECOPS_GIT_ASKPASS_DIR".to_string(),
        session_dir.to_string_lossy().into_owned(),
    );
    env.insert(
        "GIT_SSH_COMMAND".to_string(),
        "ssh -o StrictHostKeyChecking=yes".to_string(),
    );

    Ok(PreparedAskpassSession { session_id, env })
}

pub fn respond_git_askpass(request: RespondGitAskpassRequest) -> Result<(), String> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return Err("session_id must not be empty".to_string());
    }

    let session = {
        let Ok(sessions) = askpass_state().sessions.lock() else {
            return Err("askpass session registry lock poisoned".to_string());
        };
        sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("askpass session not found: {session_id}"))?
    };

    let active_request_id = session
        .active_request_id
        .lock()
        .map_err(|_| "askpass active request lock poisoned".to_string())?
        .clone();
    if active_request_id.as_deref() != Some(request.request_id.trim()) {
        return Err("askpass request id does not match active request".to_string());
    }

    let response_path = session.dir.join(RESPONSE_FILE);
    if request.cancelled {
        session.cancelled.store(true, Ordering::SeqCst);
        let _ = fs::remove_file(&response_path);
    } else {
        let mut file = fs::File::create(&response_path).map_err(|error| error.to_string())?;
        file.write_all(request.value.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let (lock, cvar) = &session.response_ready;
    if let Ok(mut ready) = lock.lock() {
        *ready = true;
        cvar.notify_all();
    }

    Ok(())
}

pub fn end_askpass_session(session_id: &str) {
    let session = {
        let Ok(mut sessions) = askpass_state().sessions.lock() else {
            return;
        };
        sessions.remove(session_id)
    };

    let watcher = {
        let Ok(mut watchers) = askpass_state().watchers.lock() else {
            return;
        };
        watchers.remove(session_id)
    };

    if let Some(session) = session {
        session.cancelled.store(true, Ordering::SeqCst);
        let (lock, cvar) = &session.response_ready;
        if let Ok(mut ready) = lock.lock() {
            *ready = true;
            cvar.notify_all();
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

    #[test]
    fn parse_input_kind_detects_username_and_password() {
        assert_eq!(
            parse_input_kind("Username for 'https://github.com':"),
            "username"
        );
        assert_eq!(
            parse_input_kind("Password for 'https://github.com':"),
            "password"
        );
        assert_eq!(
            parse_input_kind("Enter passphrase for key '/home/id_rsa':"),
            "passphrase"
        );
    }

    #[test]
    fn parse_host_hint_extracts_https_host() {
        assert_eq!(
            parse_host_hint("Username for 'https://github.com':"),
            Some("github.com".to_string())
        );
    }
}
