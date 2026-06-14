use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

pub const DEFAULT_SIDECAR_PORT: u16 = 4096;
pub const DEFAULT_SIDECAR_HOSTNAME: &str = "127.0.0.1";
const HEALTH_PATH: &str = "/global/health";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(10);
const HEALTH_RETRY_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeSidecarStatus {
    pub running: bool,
    pub base_url: Option<String>,
    pub health: SidecarHealthStatus,
    pub directory: Option<String>,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub last_error: Option<OpencodeSidecarError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SidecarHealthStatus {
    Unknown,
    Checking,
    Healthy,
    Unhealthy,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OpencodeSidecarError {
    PortInUse {
        port: u16,
        message: String,
    },
    MissingBinary {
        message: String,
    },
    LaunchFailure {
        message: String,
        exit_code: Option<i32>,
    },
    HealthTimeout {
        port: u16,
        attempts: u32,
        message: String,
    },
    StaleProcess {
        message: String,
    },
    NotRunning {
        message: String,
    },
    Internal {
        message: String,
    },
}

pub struct OpencodeSidecarState {
    inner: Mutex<OpencodeSidecarInner>,
}

struct OpencodeSidecarInner {
    child: Option<Child>,
    directory: Option<String>,
    port: u16,
    hostname: String,
    health: SidecarHealthStatus,
    last_error: Option<OpencodeSidecarError>,
}

impl OpencodeSidecarState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(OpencodeSidecarInner {
                child: None,
                directory: None,
                port: DEFAULT_SIDECAR_PORT,
                hostname: DEFAULT_SIDECAR_HOSTNAME.to_string(),
                health: SidecarHealthStatus::Unknown,
                last_error: None,
            }),
        }
    }

    pub fn stop_sync(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            let _ = stop_child(&mut inner);
        }
    }
}

fn build_base_url(hostname: &str, port: u16) -> String {
    format!("http://{hostname}:{port}")
}

fn normalize_directory(directory: &str) -> Result<String, OpencodeSidecarError> {
    let trimmed = directory.trim();
    if trimmed.is_empty() {
        return Err(OpencodeSidecarError::Internal {
            message: "Workspace directory must not be empty".to_string(),
        });
    }

    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(OpencodeSidecarError::Internal {
            message: format!("Workspace directory must be absolute: {trimmed}"),
        });
    }

    Ok(trimmed.to_string())
}

fn should_reuse_sidecar(child_alive: bool, health_ok: bool) -> bool {
    child_alive && health_ok
}

fn is_port_available(port: u16) -> bool {
    TcpListener::bind((DEFAULT_SIDECAR_HOSTNAME, port)).is_ok()
}

fn child_is_running(child: &mut Child) -> bool {
    match child.try_wait() {
        Ok(Some(_)) => false,
        Ok(None) => true,
        Err(_) => false,
    }
}

fn resolve_opencode_binary(app: &AppHandle) -> Result<PathBuf, OpencodeSidecarError> {
    if let Some(path) = resolve_bundled_opencode_binary(app) {
        return Ok(path);
    }

    if let Some(path) = find_on_path("opencode") {
        return Ok(path);
    }

    Err(OpencodeSidecarError::MissingBinary {
        message: "OpenCode binary not found. Install `opencode` on PATH or bundle it as a Tauri sidecar.".to_string(),
    })
}

fn resolve_bundled_opencode_binary(app: &AppHandle) -> Option<PathBuf> {
    let resource_candidates = app
        .path()
        .resource_dir()
        .ok()
        .into_iter()
        .flat_map(|dir| [dir.join("opencode"), dir.join("binaries").join("opencode")]);

    let exe_candidates = std::env::current_exe().ok().into_iter().flat_map(|exe| {
        let parent = exe.parent()?.to_path_buf();
        let mut candidates = vec![parent.join("opencode")];
        if let Ok(entries) = std::fs::read_dir(&parent) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let name = file_name.to_string_lossy();
                if name.starts_with("opencode") && entry.path().is_file() {
                    candidates.push(entry.path());
                }
            }
        }
        Some(candidates)
    }).flatten();

    resource_candidates
        .chain(exe_candidates)
        .find(|path| path.is_file())
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            let exe_candidate = dir.join(format!("{name}.exe"));
            if exe_candidate.is_file() {
                return Some(exe_candidate);
            }
        }
    }
    None
}

fn probe_health(base_url: &str) -> bool {
    let health_url = format!("{base_url}{HEALTH_PATH}");
    let agent = ureq::agent();
    match agent.get(&health_url).call() {
        Ok(response) => {
            if response.status() != 200 {
                return false;
            }
            response.into_json::<serde_json::Value>().ok().and_then(|body| {
                body.get("healthy")
                    .and_then(|value| value.as_bool())
                    .or(Some(true))
            }).unwrap_or(false)
        }
        Err(_) => false,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PortProbeResult {
    Healthy,
    AuthRequired,
    NotResponsive,
}

fn probe_health_detailed(base_url: &str) -> PortProbeResult {
    let health_url = format!("{base_url}{HEALTH_PATH}");
    let agent = ureq::agent();
    match agent.get(&health_url).call() {
        Ok(response) => {
            if response.status() == 200 {
                PortProbeResult::Healthy
            } else {
                PortProbeResult::NotResponsive
            }
        }
        Err(ureq::Error::Status(code, _)) => {
            if code == 401 || code == 403 {
                PortProbeResult::AuthRequired
            } else {
                PortProbeResult::NotResponsive
            }
        }
        Err(_) => PortProbeResult::NotResponsive,
    }
}

fn wait_for_health(base_url: &str) -> Result<u32, OpencodeSidecarError> {
    let started = Instant::now();
    let mut attempts = 0u32;

    while started.elapsed() < HEALTH_TIMEOUT {
        attempts += 1;
        if probe_health(base_url) {
            return Ok(attempts);
        }
        thread::sleep(HEALTH_RETRY_INTERVAL);
    }

    Err(OpencodeSidecarError::HealthTimeout {
        port: DEFAULT_SIDECAR_PORT,
        attempts,
        message: format!(
            "OpenCode sidecar did not become healthy within {}s",
            HEALTH_TIMEOUT.as_secs()
        ),
    })
}

fn read_launch_failure(child: &mut Child) -> OpencodeSidecarError {
    let exit_code = child.wait().ok().and_then(|status| status.code());
    OpencodeSidecarError::LaunchFailure {
        message: "OpenCode sidecar process exited before health check succeeded".to_string(),
        exit_code,
    }
}

fn spawn_sidecar(
    app: &AppHandle,
    port: u16,
    hostname: &str,
) -> Result<Child, OpencodeSidecarError> {
    let binary = resolve_opencode_binary(app)?;

    if !is_port_available(port) {
        let base_url = build_base_url(hostname, port);
        match probe_health_detailed(&base_url) {
            PortProbeResult::Healthy => {
                return Err(OpencodeSidecarError::PortInUse {
                    port,
                    message: format!(
                        "Port {port} is already in use by a healthy OpenCode server. Switch to URL mode in Settings \u{2192} Workspaces \u{2192} OpenCode with {base_url}."
                    ),
                });
            }
            PortProbeResult::AuthRequired => {
                return Err(OpencodeSidecarError::PortInUse {
                    port,
                    message: format!(
                        "Port {port} is already in use by an OpenCode server that requires a password. Switch to URL mode and configure Server password."
                    ),
                });
            }
            PortProbeResult::NotResponsive => {
                return Err(OpencodeSidecarError::PortInUse {
                    port,
                    message: format!("Port {port} is already in use by another process"),
                });
            }
        }
    }

    let mut command = Command::new(&binary);
    command
        .arg("serve")
        .arg("--hostname")
        .arg(hostname)
        .arg("--port")
        .arg(port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            OpencodeSidecarError::MissingBinary {
                message: format!("Failed to execute OpenCode binary at {}", binary.display()),
            }
        } else {
            OpencodeSidecarError::LaunchFailure {
                message: format!("Failed to launch OpenCode sidecar: {error}"),
                exit_code: None,
            }
        }
    })?;

    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                log::warn!("[opencode-sidecar] {line}");
            }
        });
    }

    let base_url = build_base_url(hostname, port);
    match wait_for_health(&base_url) {
        Ok(_) => Ok(child),
        Err(error) => {
            if !child_is_running(&mut child) {
                return Err(read_launch_failure(&mut child));
            }
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
}

fn stop_child(inner: &mut OpencodeSidecarInner) -> Result<(), OpencodeSidecarError> {
    if let Some(mut child) = inner.child.take() {
        if child_is_running(&mut child) {
            child.kill().map_err(|error| OpencodeSidecarError::Internal {
                message: format!("Failed to stop OpenCode sidecar: {error}"),
            })?;
            child.wait().map_err(|error| OpencodeSidecarError::Internal {
                message: format!("Failed to reap OpenCode sidecar process: {error}"),
            })?;
        } else {
            let _ = child.wait();
        }
    }

    inner.directory = None;
    inner.health = SidecarHealthStatus::Unknown;
    Ok(())
}

fn refresh_child_state(inner: &mut OpencodeSidecarInner) {
    if let Some(child) = inner.child.as_mut() {
        if !child_is_running(child) {
            inner.child = None;
            inner.directory = None;
            inner.health = SidecarHealthStatus::Unhealthy;
            inner.last_error = Some(OpencodeSidecarError::StaleProcess {
                message: "OpenCode sidecar process is no longer running".to_string(),
            });
        }
    }
}

fn current_status(inner: &OpencodeSidecarInner) -> OpencodeSidecarStatus {
    let running = inner.child.is_some();
    let base_url = running.then(|| build_base_url(&inner.hostname, inner.port));

    OpencodeSidecarStatus {
        running,
        base_url,
        health: inner.health,
        directory: inner.directory.clone(),
        port: running.then_some(inner.port),
        pid: inner.child.as_ref().map(|child| child.id()),
        last_error: inner.last_error.clone(),
    }
}

fn start_or_attach(
    app: &AppHandle,
    inner: &mut OpencodeSidecarInner,
    directory: String,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    refresh_child_state(inner);

    let base_url = build_base_url(&inner.hostname, inner.port);
    let child_alive = inner.child.as_mut().map(child_is_running).unwrap_or(false);
    let health_ok = child_alive && probe_health(&base_url);

    if should_reuse_sidecar(child_alive, health_ok) {
        inner.directory = Some(directory);
        inner.health = SidecarHealthStatus::Healthy;
        inner.last_error = None;
        return Ok(current_status(inner));
    }

    stop_child(inner)?;

    inner.health = SidecarHealthStatus::Checking;
    inner.last_error = None;

    let child = spawn_sidecar(app, inner.port, &inner.hostname)?;
    inner.child = Some(child);
    inner.directory = Some(directory);
    inner.health = SidecarHealthStatus::Healthy;
    inner.last_error = None;

    Ok(current_status(inner))
}

#[tauri::command]
pub fn opencode_sidecar_attach_workspace(
    directory: String,
    app: AppHandle,
    state: State<'_, OpencodeSidecarState>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    let directory = normalize_directory(&directory)?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;

    start_or_attach(&app, &mut inner, directory)
}

#[tauri::command]
pub fn opencode_sidecar_start(
    directory: String,
    app: AppHandle,
    state: State<'_, OpencodeSidecarState>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    opencode_sidecar_attach_workspace(directory, app, state)
}

#[tauri::command]
pub fn opencode_sidecar_stop(
    state: State<'_, OpencodeSidecarState>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;

    stop_child(&mut inner)?;
    Ok(current_status(&inner))
}

#[tauri::command]
pub fn opencode_sidecar_restart(
    directory: String,
    app: AppHandle,
    state: State<'_, OpencodeSidecarState>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    let directory = normalize_directory(&directory)?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;

    stop_child(&mut inner)?;
    start_or_attach(&app, &mut inner, directory)
}

#[tauri::command]
pub fn opencode_sidecar_status(
    state: State<'_, OpencodeSidecarState>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;

    refresh_child_state(&mut inner);

    if inner.child.is_some() {
        let base_url = build_base_url(&inner.hostname, inner.port);
        inner.health = if probe_health(&base_url) {
            SidecarHealthStatus::Healthy
        } else {
            SidecarHealthStatus::Unhealthy
        };
    }

    Ok(current_status(&inner))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_base_url_formats_localhost() {
        assert_eq!(
            build_base_url("127.0.0.1", 4096),
            "http://127.0.0.1:4096"
        );
    }

    #[test]
    fn should_reuse_when_directory_matches_and_healthy() {
        assert!(should_reuse_sidecar(true, true));
    }

    #[test]
    fn should_reuse_when_directory_differs_but_healthy() {
        assert!(should_reuse_sidecar(true, true));
    }

    #[test]
    fn should_not_reuse_when_unhealthy() {
        assert!(!should_reuse_sidecar(true, false));
    }

    #[test]
    fn should_not_reuse_when_child_dead() {
        assert!(!should_reuse_sidecar(false, true));
    }

    #[test]
    fn normalize_directory_rejects_empty() {
        let error = normalize_directory("  ").unwrap_err();
        assert!(matches!(error, OpencodeSidecarError::Internal { .. }));
    }

    #[test]
    fn normalize_directory_rejects_relative_paths() {
        let error = normalize_directory("relative/path").unwrap_err();
        assert!(matches!(error, OpencodeSidecarError::Internal { .. }));
    }

    fn test_inner() -> OpencodeSidecarInner {
        OpencodeSidecarInner {
            child: None,
            directory: Some("/tmp/ws".to_string()),
            port: DEFAULT_SIDECAR_PORT,
            hostname: DEFAULT_SIDECAR_HOSTNAME.to_string(),
            health: SidecarHealthStatus::Healthy,
            last_error: None,
        }
    }

    #[test]
    fn stop_child_clears_directory_and_health_when_not_running() {
        let mut inner = test_inner();

        stop_child(&mut inner).expect("stop should succeed");

        assert!(inner.child.is_none());
        assert!(inner.directory.is_none());
        assert_eq!(inner.health, SidecarHealthStatus::Unknown);
    }

    #[test]
    fn stop_child_is_idempotent() {
        let mut inner = test_inner();

        stop_child(&mut inner).expect("first stop should succeed");
        stop_child(&mut inner).expect("second stop should succeed");

        let status = current_status(&inner);
        assert!(!status.running);
        assert!(status.directory.is_none());
        assert!(status.pid.is_none());
    }

    #[test]
    fn current_status_reports_not_running_after_stop() {
        let mut inner = test_inner();
        stop_child(&mut inner).expect("stop should succeed");

        let status = current_status(&inner);
        assert!(!status.running);
        assert!(status.base_url.is_none());
        assert!(status.port.is_none());
    }

    #[test]
    fn probe_health_detailed_returns_not_responsive_for_dead_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let base_url = format!("http://127.0.0.1:{port}");
        let result = probe_health_detailed(&base_url);
        assert_eq!(result, PortProbeResult::NotResponsive);
    }

    #[test]
    fn port_in_use_error_messages_mention_url_mode_when_healthy() {
        let error = OpencodeSidecarError::PortInUse {
            port: 4096,
            message: "Port 4096 is already in use by a healthy OpenCode server. Switch to URL mode in Settings \u{2192} Workspaces \u{2192} OpenCode with http://127.0.0.1:4096.".to_string(),
        };
        match error {
            OpencodeSidecarError::PortInUse { port, message } => {
                assert_eq!(port, 4096);
                assert!(message.contains("URL mode"));
            }
            _ => panic!("expected PortInUse"),
        }
    }
}
