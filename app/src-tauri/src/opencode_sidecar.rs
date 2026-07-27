use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

pub const DEFAULT_SIDECAR_PORT: u16 = 4096;
pub const DEFAULT_SIDECAR_HOSTNAME: &str = "127.0.0.1";
const HEALTH_PATH: &str = "/global/health";
const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_secs(7);
// M13.5 — non-blocking attach: spawn the sidecar process and return
// immediately with `health: checking` so the Tauri IPC thread doesn't block
// for up to 10s. A background poller resolves health on a dedicated thread.
const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(15);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);

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
    inner: Arc<Mutex<OpencodeSidecarInner>>,
}

impl Clone for OpencodeSidecarState {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

struct OpencodeSidecarInner {
    child: Option<Child>,
    directory: Option<String>,
    port: u16,
    hostname: String,
    health: SidecarHealthStatus,
    last_error: Option<OpencodeSidecarError>,
    /// Identity of the child this state currently owns; see [`next_child_generation`].
    generation: u64,
}

/// Bump the id that identifies "the child process this state currently owns".
///
/// A health poller captures the value when its child is spawned and stops touching
/// state the moment it no longer matches. Without that, the poller operated on whatever
/// `inner.child` happened to be: after a port change the old poller kept probing the old
/// port, failed, and at its 15s deadline killed the *replacement* child and reported a
/// bogus "did not become healthy" — the sidecar dying ~15s after changing the port.
fn next_child_generation(inner: &mut OpencodeSidecarInner) -> u64 {
    inner.generation = inner.generation.wrapping_add(1);
    inner.generation
}

/// Install `child` as the current sidecar process and return its generation.
fn install_child(inner: &mut OpencodeSidecarInner, child: Child) -> u64 {
    inner.child = Some(child);
    next_child_generation(inner)
}

impl OpencodeSidecarState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(OpencodeSidecarInner {
                child: None,
                directory: None,
                port: DEFAULT_SIDECAR_PORT,
                hostname: DEFAULT_SIDECAR_HOSTNAME.to_string(),
                health: SidecarHealthStatus::Unknown,
                last_error: None,
                generation: 0,
            })),
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

fn build_probe_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(HEALTH_PROBE_TIMEOUT)
        .build()
}

fn probe_health(base_url: &str) -> bool {
    let health_url = format!("{base_url}{HEALTH_PATH}");
    let agent = build_probe_agent();
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
    let agent = build_probe_agent();
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

fn spawn_sidecar_process(
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

    Ok(child)
}

/// Background poller: runs after a non-blocking spawn to resolve `health` on a
/// dedicated thread. Stops the child and records an error when health doesn't
/// arrive in time, when the process exits, or when port-in-use is detected.
fn poll_health_in_background(
    state: OpencodeSidecarState,
    port: u16,
    hostname: String,
    generation: u64,
) {
    let base_url = build_base_url(&hostname, port);
    let started = Instant::now();

    while started.elapsed() < HEALTH_POLL_TIMEOUT {
        // Snapshot under the lock, then release before the HTTP probe so
        // concurrent `_stop` / `_status` / exit-path `stop_sync` are not blocked
        // for up to HEALTH_PROBE_TIMEOUT (7s) on a hung health endpoint.
        let child_still_ours = {
            let mut inner = match state.inner.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            // A restart (or stop) replaced the child we were spawned for. `port` and
            // `base_url` describe that old child, so nothing we could conclude here
            // applies to the current one.
            if inner.generation != generation {
                return;
            }
            // If a stop request landed before we ever reached healthy, bail.
            let Some(child) = inner.child.as_mut() else {
                return;
            };
            if !child_is_running(child) {
                let exit_code = child.wait().ok().and_then(|status| status.code());
                inner.child = None;
                next_child_generation(&mut inner);
                inner.directory = None;
                inner.health = SidecarHealthStatus::Unhealthy;
                inner.last_error = Some(OpencodeSidecarError::LaunchFailure {
                    message: "OpenCode sidecar process exited before health check succeeded"
                        .to_string(),
                    exit_code,
                });
                return;
            }
            true
        };

        if !child_still_ours {
            return;
        }

        if probe_health(&base_url) {
            if let Ok(mut inner) = state.inner.lock() {
                if inner.generation != generation {
                    return;
                }
                inner.health = SidecarHealthStatus::Healthy;
                inner.last_error = None;
            }
            return;
        }

        thread::sleep(HEALTH_POLL_INTERVAL);
    }

    // Timed out waiting for health. Mark unhealthy and stop the child so it
    // doesn't linger as a zombie.
    let timeout_error = OpencodeSidecarError::HealthTimeout {
        port,
        attempts: 0,
        message: format!(
            "OpenCode sidecar did not become healthy within {}s",
            HEALTH_POLL_TIMEOUT.as_secs()
        ),
    };

    if let Ok(mut inner) = state.inner.lock() {
        // The generation check matters most here: this branch kills a process, and
        // without it a poller left behind by a port change would kill the sidecar that
        // replaced its own child.
        if inner.generation != generation {
            return;
        }
        if let Some(child) = inner.child.as_mut() {
            if child_is_running(child) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        inner.child = None;
        next_child_generation(&mut inner);
        inner.directory = None;
        inner.health = SidecarHealthStatus::Error;
        inner.last_error = Some(timeout_error);
    }
}

fn stop_child(inner: &mut OpencodeSidecarInner) -> Result<(), OpencodeSidecarError> {
    if let Some(mut child) = inner.child.take() {
        // Retire this child's generation so any poller still watching it stops before
        // it can act on the state a replacement will occupy.
        next_child_generation(inner);
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
            next_child_generation(inner);
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

/// M14-T3 — port override. When `Some(p)`, the inner state adopts the new
/// port before any reuse/spawn decision. A port change while a child is
/// running forces a stop + respawn (the existing `opencode serve` instance
/// is bound to the old port and would shadow the new one). When `None`,
/// the existing `inner.port` is kept.
fn apply_port_override(inner: &mut OpencodeSidecarInner, port_override: Option<u16>) {
    if let Some(port) = port_override {
        inner.port = port;
    }
}

fn start_or_attach_nonblocking(
    app: &AppHandle,
    state: &OpencodeSidecarState,
    directory: String,
    port_override: Option<u16>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    // Phase 1 — under the lock, refresh state and decide whether a probe is needed.
    // The HTTP probe itself runs *outside* the lock (see below).
    let probe_base_url = {
        let mut inner = state.inner.lock().map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;

        apply_port_override(&mut inner, port_override);
        refresh_child_state(&mut inner);

        let child_alive = inner.child.as_mut().map(child_is_running).unwrap_or(false);
        if !child_alive {
            stop_child(&mut inner)?;
            None
        } else if matches!(
            inner.health,
            SidecarHealthStatus::Checking | SidecarHealthStatus::Unknown
        ) {
            // Still booting — return checking without a blocking probe so we do not
            // hold the IPC thread (or the mutex) for up to HEALTH_PROBE_TIMEOUT.
            inner.directory = Some(directory.clone());
            inner.health = SidecarHealthStatus::Checking;
            inner.last_error = None;
            return Ok(current_status(&inner));
        } else {
            Some(build_base_url(&inner.hostname, inner.port))
        }
    };

    // Probe outside the lock when we have a live child that claims to be past boot.
    let health_ok = probe_base_url
        .as_deref()
        .is_some_and(probe_health);

    let should_spawn = {
        let mut inner = state.inner.lock().map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;

        // Re-check liveness after the unlocked probe — a stop/restart may have landed.
        refresh_child_state(&mut inner);
        let child_alive = inner.child.as_mut().map(child_is_running).unwrap_or(false);

        if should_reuse_sidecar(child_alive, health_ok) {
            inner.directory = Some(directory);
            inner.health = SidecarHealthStatus::Healthy;
            inner.last_error = None;
            return Ok(current_status(&inner));
        }

        if child_alive {
            inner.directory = Some(directory);
            inner.health = SidecarHealthStatus::Checking;
            inner.last_error = None;
            return Ok(current_status(&inner));
        }

        stop_child(&mut inner)?;
        true
    };

    if !should_spawn {
        // Defensive guard: every branch above either returned or fell
        // through to spawn. Unreachable under current control flow.
        return Err(OpencodeSidecarError::Internal {
            message: "OpenCode sidecar start reached unexpected state".to_string(),
        });
    }

    // Phase 2 — spawn the process under the lock (the spawn itself is fast;
    // it includes port availability check + process start).
    let (port, hostname, generation) = {
        let mut inner = state.inner.lock().map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;
        let port = inner.port;
        let hostname = inner.hostname.clone();
        let child = spawn_sidecar_process(app, port, &hostname)?;
        let generation = install_child(&mut inner, child);
        inner.directory = Some(directory);
        inner.health = SidecarHealthStatus::Checking;
        inner.last_error = None;
        (port, hostname, generation)
    };

    // Phase 3 — kick off a background poller; clone the Arc-shared state. Port,
    // hostname and generation are all captured from the same locked section as the
    // spawn, so the poller can tell whether the child it is polling is still current.
    let poll_state = state.clone();
    thread::spawn(move || {
        poll_health_in_background(poll_state, port, hostname, generation);
    });

    let inner = state.inner.lock().map_err(|error| OpencodeSidecarError::Internal {
        message: format!("OpenCode sidecar state lock poisoned: {error}"),
    })?;
    Ok(current_status(&inner))
}

#[tauri::command]
pub fn opencode_sidecar_attach_workspace(
    directory: String,
    app: AppHandle,
    state: State<'_, OpencodeSidecarState>,
    // M14-T3 — optional port override. When `Some(p)`, the sidecar is
    // (re)started on port `p` before attaching to `directory`. When `None`,
    // the existing port (default `4096`) is kept.
    port: Option<u16>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    let directory = normalize_directory(&directory)?;
    start_or_attach_nonblocking(&app, state.inner(), directory, port)
}

#[tauri::command]
pub fn opencode_sidecar_start(
    directory: String,
    app: AppHandle,
    state: State<'_, OpencodeSidecarState>,
    // M14-T3 — see `opencode_sidecar_attach_workspace`.
    port: Option<u16>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    opencode_sidecar_attach_workspace(directory, app, state, port)
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
    // M14-T3 — see `opencode_sidecar_attach_workspace`. A non-`None` value
    // here is what a settings-driven restart on port change uses.
    port: Option<u16>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    let directory = normalize_directory(&directory)?;
    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|error| OpencodeSidecarError::Internal {
                message: format!("OpenCode sidecar state lock poisoned: {error}"),
            })?;
        stop_child(&mut inner)?;
    }
    // Use the non-blocking path so health probing never holds the sidecar mutex
    // (and so restart returns immediately with `checking` like attach/start).
    start_or_attach_nonblocking(&app, state.inner(), directory, port)
}

#[tauri::command]
pub fn opencode_sidecar_status(
    state: State<'_, OpencodeSidecarState>,
) -> Result<OpencodeSidecarStatus, OpencodeSidecarError> {
    let base_url = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|error| OpencodeSidecarError::Internal {
                message: format!("OpenCode sidecar state lock poisoned: {error}"),
            })?;

        refresh_child_state(&mut inner);

        if inner.child.is_some() {
            Some(build_base_url(&inner.hostname, inner.port))
        } else {
            None
        }
    };

    // Probe outside the lock so a hung health endpoint cannot block stop/exit.
    let probed_health = base_url.as_deref().map(|url| {
        if probe_health(url) {
            SidecarHealthStatus::Healthy
        } else {
            SidecarHealthStatus::Unhealthy
        }
    });

    let mut inner = state
        .inner
        .lock()
        .map_err(|error| OpencodeSidecarError::Internal {
            message: format!("OpenCode sidecar state lock poisoned: {error}"),
        })?;

    refresh_child_state(&mut inner);
    if let Some(health) = probed_health {
        if inner.child.is_some() {
            inner.health = health;
        }
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
            generation: 0,
        }
    }

    /// Regression: the health poller used to operate on whatever `inner.child` was, so
    /// after a port change the stale poller killed the replacement child. The generation
    /// is what lets it recognise that its own child is gone.
    #[test]
    fn replacing_the_child_retires_the_previous_generation() {
        let mut inner = test_inner();

        let first = next_child_generation(&mut inner);
        let second = next_child_generation(&mut inner);

        assert_ne!(first, second, "each child gets a distinct generation");
    }

    #[test]
    fn stopping_a_running_child_retires_its_generation() {
        let mut inner = test_inner();
        // A child that has already exited still counts as "installed" for bookkeeping.
        let child = std::process::Command::new("true")
            .spawn()
            .expect("spawn placeholder child");
        let installed = install_child(&mut inner, child);

        stop_child(&mut inner).expect("stop should succeed");

        assert_ne!(
            inner.generation, installed,
            "a poller holding the old generation must no longer match"
        );
        assert!(inner.child.is_none());
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

    #[test]
    fn apply_port_override_updates_inner_port() {
        let mut inner = test_inner();
        inner.port = DEFAULT_SIDECAR_PORT;

        apply_port_override(&mut inner, Some(54321));
        assert_eq!(inner.port, 54321);

        apply_port_override(&mut inner, None);
        assert_eq!(inner.port, 54321);
    }

    #[test]
    fn current_status_reports_configured_port() {
        let mut inner = test_inner();
        // No child → no port in status even when configured.
        let status = current_status(&inner);
        assert!(status.port.is_none());

        inner.port = 54321;
        // Even without a child, the configured port isn't surfaced (status
        // is "running: false"). This matches the existing semantics where
        // `port` reflects the actually-bound port, not the configured one.
        let status = current_status(&inner);
        assert!(status.port.is_none());
    }

    #[test]
    fn health_timeout_error_reports_actual_port() {
        let error = OpencodeSidecarError::HealthTimeout {
            port: 54321,
            attempts: 3,
            message: "OpenCode sidecar did not become healthy within 10s".to_string(),
        };
        match error {
            OpencodeSidecarError::HealthTimeout { port, attempts, .. } => {
                assert_eq!(port, 54321);
                assert_eq!(attempts, 3);
            }
            _ => panic!("expected HealthTimeout"),
        }
    }
}
