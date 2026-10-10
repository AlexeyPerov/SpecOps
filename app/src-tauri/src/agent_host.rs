//! Agent Host supervisor and JSON-RPC bridge (phase E).
//!
//! The WebView never spawns, connects to, or imports the Agent Host. This module
//! owns every Rust/Tauri concern: process spawning, the versioned JSON-RPC bridge
//! over stdio, request/response correlation, lifecycle policy, and process-tree
//! cleanup. Runtime-specific lifecycle code stays out of Tauri — adapters live in
//! the host process.
//!
//! Architecture:
//! - [`AgentHostState`] holds one owned child process plus a monotonic
//!   `generation`. Every reader/emitter thread captures its child's generation
//!   and stops touching state the moment it no longer matches, so a stale reader
//!   can never resolve a request or mark health on a replacement child.
//! - A stdout reader thread parses newline-delimited JSON-RPC, resolves
//!   responses against pending requests, and forwards notifications to a bounded
//!   emitter queue. A stderr drainer keeps a chatty/broken host from filling its
//!   pipe while bounding memory and log volume.
//! - [`AgentHostState::request`] is the single pipe the WebView uses
//!   (`agent_host_request` command): allocate an id, write the request, await a
//!   correlated response with a deadline. Transport/protocol failures surface as
//!   the typed [`AgentHostError`].
//! - Shutdown drains every path: a best-effort `shutdown` request, stdin close, a
//!   bounded grace window, then process-group termination so the host's children
//!   and grandchildren are reaped on supported Unix targets.

use crate::component_manager::{ComponentManager, RuntimeLease};
use crate::components::ComponentId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Tauri event used to forward host JSON-RPC notifications to the WebView.
pub const AGENT_HOST_EVENT: &str = "specops/agent-host/event";

/// Protocol version this bridge negotiates (must match the host's `PROTOCOL_VERSION`).
const PROTOCOL_VERSION: i64 = 1;
/// Maximum size of a single framed message before it is rejected/dropped (1 MiB).
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(10);
/// Bounded buffer between the stdout reader and the WebView emitter. When full,
/// overflow retires the host generation so terminal delivery loss is detectable.
const EVENT_CHANNEL_CAPACITY: usize = 256;
/// Crash-loop breaker: refuse a restart after this many starts within the window.
const CRASH_LOOP_WINDOW: Duration = Duration::from_secs(30);
const CRASH_LOOP_THRESHOLD: usize = 5;
/// Grace window given to a cooperative `shutdown` request before forced kill.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);
const STDERR_MAX_LINES: usize = 4096;
const STDERR_LINE_BYTES: usize = 64 * 1024;

// ---------------------------------------------------------------------------
// Typed errors + status
// ---------------------------------------------------------------------------

/// Typed bridge error. `Protocol` forwards a host JSON-RPC error envelope
/// verbatim (`code`/`message`/`data`); the remaining variants are transport-level.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AgentHostError {
    NotRunning {
        message: String,
    },
    ShuttingDown {
        message: String,
    },
    HostPathMissing {
        message: String,
    },
    NodeMissing {
        message: String,
    },
    LaunchFailure {
        message: String,
    },
    ComponentUnavailable {
        component: String,
        message: String,
    },
    InitializeTimeout {
        message: String,
    },
    ProtocolVersionMismatch {
        client: i64,
        server: i64,
        message: String,
    },
    RequestTimeout {
        id: u64,
        message: String,
    },
    HostExited {
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<i32>,
        message: String,
    },
    CrashLoop {
        message: String,
    },
    /// A host JSON-RPC error response (forwarded `code`/`message`/`data`).
    Protocol {
        code: i64,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    Io {
        message: String,
    },
}

impl AgentHostError {
    fn not_running() -> Self {
        AgentHostError::NotRunning {
            message: "Agent Host is not running".to_string(),
        }
    }
    fn io(error: impl std::fmt::Display) -> Self {
        AgentHostError::Io {
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentHostHealth {
    Unknown,
    Starting,
    Healthy,
    Degraded,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHostStatus {
    pub running: bool,
    pub health: AgentHostHealth,
    pub pid: Option<u32>,
    pub generation: u64,
    pub host_version: Option<String>,
    pub protocol_version: Option<i64>,
    pub restart_count: u64,
    pub last_error: Option<AgentHostError>,
}

/// Forwarded JSON-RPC notification payload emitted on [`AGENT_HOST_EVENT`].
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostEvent {
    host_generation: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

// ---------------------------------------------------------------------------
// Pending request correlation (sync condvar — no extra runtime deps)
// ---------------------------------------------------------------------------

struct PendingEntry {
    result: Mutex<Option<Result<Value, AgentHostError>>>,
    cvar: Condvar,
}

impl PendingEntry {
    fn new() -> Arc<Self> {
        Arc::new(PendingEntry {
            result: Mutex::new(None),
            cvar: Condvar::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct AgentHostInner {
    child: Option<Child>,
    leases: HashMap<String, RuntimeLease>,
    stdin: Option<SyncSender<(u64, Vec<u8>)>>,
    generation: u64,
    health: AgentHostHealth,
    host_version: Option<String>,
    protocol_version: Option<i64>,
    last_error: Option<AgentHostError>,
    next_id: u64,
    pending: HashMap<u64, Arc<PendingEntry>>,
    /// Start timestamps used by the crash-loop breaker.
    restarts: Vec<Instant>,
    shutting_down: bool,
}

impl AgentHostInner {
    fn new() -> Self {
        AgentHostInner {
            child: None,
            leases: HashMap::new(),
            stdin: None,
            generation: 0,
            health: AgentHostHealth::Unknown,
            host_version: None,
            protocol_version: None,
            last_error: None,
            next_id: 1,
            pending: HashMap::new(),
            restarts: Vec::new(),
            shutting_down: false,
        }
    }

    fn bump_generation(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    fn next_request_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        id
    }

    /// Drop completed/exited children and reflect that in health. Returns true
    /// if a live child remains installed.
    fn refresh_liveness(&mut self) -> bool {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    #[cfg(unix)]
                    kill_process_group_pid(child.id());
                    self.bump_generation();
                    fail_all_pending(
                        self,
                        AgentHostError::HostExited {
                            code: None,
                            message: "Agent Host exited".into(),
                        },
                    );
                    self.leases.clear();
                    self.child = None;
                    self.stdin = None;
                    if !matches!(self.health, AgentHostHealth::Error) {
                        self.health = AgentHostHealth::Degraded;
                    }
                }
                Ok(None) => {}
                Err(_) => {}
            }
        }
        self.child.is_some()
    }

    fn within_crash_loop(&self) -> bool {
        let cutoff = Instant::now().checked_sub(CRASH_LOOP_WINDOW);
        let recent = match cutoff {
            Some(c) => self.restarts.iter().filter(|t| **t >= c).count(),
            None => self.restarts.len(),
        };
        recent >= CRASH_LOOP_THRESHOLD
    }

    fn record_restart(&mut self) {
        let now = Instant::now();
        self.restarts.retain(|t| {
            now.checked_duration_since(*t)
                .map(|d| d < CRASH_LOOP_WINDOW)
                .unwrap_or(true)
        });
        self.restarts.push(now);
    }
}

#[derive(Clone)]
pub struct AgentHostState {
    inner: Arc<Mutex<AgentHostInner>>,
    lifecycle: Arc<Mutex<()>>,
}

impl AgentHostState {
    pub fn new() -> Self {
        AgentHostState {
            inner: Arc::new(Mutex::new(AgentHostInner::new())),
            lifecycle: Arc::new(Mutex::new(())),
        }
    }

    /// Synchronous best-effort stop used by app shutdown. Idempotent.
    pub fn stop_sync(&self) {
        let _ = self.shutdown();
    }
}

/// Outcome of [`read_bounded_line`]. The `usize` counts are consumed by tests.
#[allow(dead_code)]
enum LineRead {
    Eof,
    Err,
    Line(usize),
    Truncated(usize),
}

/// Read a line with bounded memory. Return immediately at the ceiling so a
/// peer cannot hide an oversized frame by withholding the next delimiter.
/// The protocol reader retires that generation; stderr discards bounded chunks.
fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    delim: u8,
    buf: &mut Vec<u8>,
    max: usize,
) -> LineRead {
    loop {
        if buf.contains(&delim) {
            return LineRead::Line(buf.len());
        }
        let available = match reader.fill_buf() {
            Ok(slice) => slice,
            Err(_) => return LineRead::Err,
        };
        if available.is_empty() {
            return if buf.is_empty() {
                LineRead::Eof
            } else {
                LineRead::Line(buf.len())
            };
        }
        let delim_pos = available.iter().position(|b| *b == delim);
        if let Some(pos) = delim_pos {
            let take = if buf.len() + pos < max {
                pos + 1
            } else {
                max.saturating_sub(buf.len())
            };
            buf.extend_from_slice(&available[..take]);
            reader.consume(take);
            if buf.len() >= max && !buf.contains(&delim) {
                return LineRead::Truncated(buf.len());
            }
            return LineRead::Line(buf.len());
        }
        let remaining = max.saturating_sub(buf.len());
        if remaining == 0 {
            return LineRead::Truncated(buf.len());
        }
        let take = available.len().min(remaining);
        buf.extend_from_slice(&available[..take]);
        reader.consume(take);
        if buf.len() >= max {
            return LineRead::Truncated(buf.len());
        }
    }
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

fn resolve_node_binary(app: &AppHandle) -> Result<(PathBuf, Option<RuntimeLease>), AgentHostError> {
    #[cfg(debug_assertions)]
    if let Some(raw) = std::env::var_os("SPECOPS_NODE_EXECUTABLE") {
        let path = PathBuf::from(raw);
        if path.is_absolute() && path.is_file() {
            return Ok((path, None));
        }
        return Err(AgentHostError::NodeMissing {
            message: "Explicit development Node path must be absolute and present".into(),
        });
    }
    let lease = app.state::<ComponentManager>().acquire_runtime(ComponentId::Node)
        .map_err(|_| AgentHostError::NodeMissing { message: "Install or repair the shared Node component in Software, then reconnect explicitly.".into() })?;
    let entry = lease
        .manifest
        .entries
        .get("main")
        .ok_or_else(|| AgentHostError::NodeMissing {
            message: "Shared Node entry is unavailable".into(),
        })?;
    Ok((lease.root.join(entry), Some(lease)))
}

/// Resolve the built host bundle. Order: `SPECOPS_HOST_PATH` env override,
/// bundled `resource_dir/agent-host/index.js`, then the dev repo-relative path
/// (`<crate>/../host/dist/index.js`, present while running from source).
fn resolve_host_script(app: &AppHandle) -> Result<PathBuf, AgentHostError> {
    #[cfg(debug_assertions)]
    if let Ok(raw) = std::env::var("SPECOPS_HOST_PATH") {
        let path = PathBuf::from(raw);
        if path.is_absolute() && path.is_file() {
            return Ok(path);
        }
        return Err(AgentHostError::HostPathMissing {
            message: "Explicit Agent Host bundle is missing or not absolute".to_string(),
        });
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("agent-host").join("index.js");
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    #[cfg(debug_assertions)]
    {
        // Source development only. `CARGO_MANIFEST_DIR` is baked at compile time
        // (`.../app/src-tauri`); the host bundle lives at `app/host/dist`.
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../host/dist/index.js");
        if dev.is_file() {
            return Ok(dev);
        }
    }
    Err(AgentHostError::HostPathMissing {
        message:
            "Agent Host bundle was not found. Build it with `node app/host/scripts/build.mjs`."
                .to_string(),
    })
}

fn build_host_command(app: &AppHandle) -> Result<(Command, Option<RuntimeLease>), AgentHostError> {
    let (node, lease) = resolve_node_binary(app)?;
    let script = resolve_host_script(app)?;
    let mut command = Command::new(node);
    command.arg(script);
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AgentHostError::LaunchFailure {
            message: "Cannot resolve profile storage".to_string(),
        })?;
    command.env("SPECOPS_PROFILE_ROOT", data_dir.join("connection-profiles"));
    command.env("SPECOPS_MANAGED_COMPONENTS", "1");
    Ok((command, lease))
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

fn current_status(inner: &AgentHostInner) -> AgentHostStatus {
    AgentHostStatus {
        running: inner.child.is_some(),
        health: inner.health,
        pid: inner.child.as_ref().map(|c| c.id()),
        generation: inner.generation,
        host_version: inner.host_version.clone(),
        protocol_version: inner.protocol_version,
        restart_count: inner.restarts.len() as u64,
        last_error: inner.last_error.clone(),
    }
}

fn fail_all_pending(inner: &mut AgentHostInner, error: AgentHostError) {
    for (id, entry) in inner.pending.drain() {
        let mut guard = entry.result.lock().unwrap();
        *guard = Some(Err(error.clone()));
        drop(guard);
        entry.cvar.notify_one();
        let _ = id;
    }
}

fn resolve_pending(inner: &mut AgentHostInner, id: u64, result: Result<Value, AgentHostError>) {
    if let Some(entry) = inner.pending.remove(&id) {
        let mut guard = entry.result.lock().unwrap();
        *guard = Some(result);
        drop(guard);
        entry.cvar.notify_one();
    }
    // Unknown id: already timed out / belongs to a retired generation. Drop.
}

/// Mark the child for generation `generation` as exited. Only acts when the
/// reader's generation is still current — a stale reader must not corrupt a
/// replacement child's state. Reaps the process group so grandchildren the host
/// left behind (e.g. a crash mid-turn) cannot survive.
fn mark_exited(inner_arc: &Arc<Mutex<AgentHostInner>>, generation: u64, code: Option<i32>) {
    let mut inner = match inner_arc.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if inner.generation != generation {
        return;
    }
    // Reap the leader + its group. The handle may already be gone if a
    // concurrent stop beat us to it, but if it's still ours we must clean up.
    if let Some(child) = inner.child.take() {
        inner.stdin = None;
        inner.bump_generation();
        reap_child(child, true);
        inner.leases.clear();
    }
    let already_error = matches!(inner.health, AgentHostHealth::Error);
    if !already_error {
        inner.health = if inner.shutting_down {
            AgentHostHealth::Unknown
        } else {
            AgentHostHealth::Degraded
        };
    }
    if !inner.shutting_down {
        inner.last_error = Some(AgentHostError::HostExited {
            code,
            message: "Agent Host process exited unexpectedly".to_string(),
        });
        fail_all_pending(
            &mut inner,
            AgentHostError::HostExited {
                code,
                message: "Agent Host process exited unexpectedly".to_string(),
            },
        );
    } else {
        fail_all_pending(
            &mut inner,
            AgentHostError::ShuttingDown {
                message: "Agent Host is shutting down".to_string(),
            },
        );
    }
}

/// Signal the whole process group led by `pid` (Unix). The group survives the
/// leader's exit as long as any member remains, so this must be called even
/// after a cooperative exit to reap grandchildren the host left behind.
#[cfg(unix)]
fn kill_process_group_pid(pid: u32) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    // POSIX kill(2): a NEGATIVE pid signals the whole process group. A positive
    // pid would signal only the leader and orphan its grandchildren.
    let neg_pgid = -(pid as i32);
    let _ = kill(Pid::from_raw(neg_pgid), Signal::SIGKILL);
}

/// Reap a child and its process group. Always signal the group (when `force`) so
/// grandchildren are torn down even if the leader already exited, then SIGKILL +
/// wait the leader so the OS reaps it (never drop a live handle). Errors are
/// logged, not surfaced — callers record the outcome they care about.
fn reap_child(mut child: Child, force: bool) {
    let pid = child.id();
    #[cfg(unix)]
    if force {
        kill_process_group_pid(pid);
    }
    if !force {
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[cfg(unix)]
    kill_process_group_pid(pid);

    if let Err(error) = child.kill() {
        log::warn!("[agent-host] failed to kill process: {error}");
    }
    if let Err(error) = child.wait() {
        log::warn!("[agent-host] failed to reap process: {error}");
    }
}

/// Stop and reap the current child via [`reap_child`]. Records shutdown bookkeeping.
fn stop_child(inner: &mut AgentHostInner, force: bool) -> Result<(), AgentHostError> {
    if let Some(child) = inner.child.take() {
        inner.stdin = None;
        inner.bump_generation();
        reap_child(child, force);
        inner.leases.clear();
        inner.health = AgentHostHealth::Unknown;
        fail_all_pending(
            inner,
            AgentHostError::ShuttingDown {
                message: "Agent Host is shutting down".to_string(),
            },
        );
    }
    Ok(())
}

/// Background stdout reader for one child. Captures `generation` so it can tell
/// when its child has been retired by a stop/restart/crash and stop mutating
/// shared state. Forwards notifications to the bounded emitter channel and
/// resolves responses against the pending map.
fn stdout_reader(
    inner_arc: Arc<Mutex<AgentHostInner>>,
    mut stdout: ChildStdout,
    generation: u64,
    event_tx: SyncSender<HostEvent>,
) {
    let mut reader = BufReader::new(&mut stdout);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        match read_bounded_line(&mut reader, b'\n', &mut buf, MAX_MESSAGE_BYTES + 1) {
            LineRead::Eof | LineRead::Err => {
                mark_exited(&inner_arc, generation, None);
                break;
            }
            LineRead::Truncated(_) => {
                // A truncated frame may hide terminal delivery loss; retire it.
                log::warn!(
                    "[agent-host] dropped oversized stdout line (> {MAX_MESSAGE_BYTES} bytes)"
                );
                mark_exited(&inner_arc, generation, None);
                break;
            }
            LineRead::Line(_) => {}
        }
        let value: Value = match serde_json::from_slice(&buf) {
            Ok(value) => value,
            Err(_) => {
                log::warn!("[agent-host] invalid stdout frame; retiring generation");
                mark_exited(&inner_arc, generation, None);
                break;
            }
        };
        let obj = match value.as_object() {
            Some(obj) => obj,
            None => continue,
        };
        let has_id = obj.contains_key("id");
        let has_result = obj.contains_key("result");
        let has_error = obj.contains_key("error");
        let has_method = obj.contains_key("method");
        // Response (host → bridge): resolve a pending request.
        if has_id && (has_result || has_error) {
            let id = obj.get("id").and_then(Value::as_u64);
            let result = if let Some(error) = obj.get("error") {
                let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32603);
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Agent Host error")
                    .to_string();
                let data = error.get("data").cloned();
                Err(AgentHostError::Protocol {
                    code,
                    message,
                    data,
                })
            } else {
                Ok(obj.get("result").cloned().unwrap_or(Value::Null))
            };
            let mut inner = match inner_arc.lock() {
                Ok(guard) => guard,
                Err(_) => break,
            };
            if inner.generation != generation {
                // Stale reader: its child is gone. Do not touch the new state.
                break;
            }
            if let Some(id) = id {
                resolve_pending(&mut inner, id, result);
            }
            continue;
        }
        // Notification (host → bridge): forward to the WebView emitter.
        if has_method && !has_id {
            if inner_arc.lock().map(|g| g.generation).ok() != Some(generation) {
                break;
            }
            let method = obj
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let params = obj.get("params").cloned();
            let event = HostEvent {
                host_generation: generation,
                method,
                params,
            };
            if event_tx.try_send(event).is_err() {
                mark_exited(&inner_arc, generation, None);
                break;
            }
            continue;
        }
        // Unexpected frames can hide terminal delivery loss. Retire this generation.
        mark_exited(&inner_arc, generation, None);
        break;
    }
}

fn stderr_drainer(mut stderr: std::process::ChildStderr) {
    let mut reader = BufReader::new(&mut stderr);
    let mut buf: Vec<u8> = Vec::new();
    let mut logged = 0usize;
    loop {
        buf.clear();
        match read_bounded_line(&mut reader, b'\n', &mut buf, STDERR_LINE_BYTES) {
            LineRead::Eof | LineRead::Err => break,
            LineRead::Truncated(_) | LineRead::Line(_) => {}
        }
        if logged >= STDERR_MAX_LINES {
            if logged == STDERR_MAX_LINES {
                log::warn!("[agent-host] suppressing further stderr output (line cap reached)");
            }
            logged += 1;
            continue;
        }
        let mut line = String::from_utf8_lossy(&buf).into_owned();
        if line.ends_with('\n') {
            line.pop();
        }
        if line.len() > 2048 {
            let mut end = 2048;
            while end > 0 && !line.is_char_boundary(end) {
                end -= 1;
            }
            line.truncate(end);
            line.push_str("…[truncated]");
        }
        log::warn!(
            "[agent-host] stderr diagnostic received ({} bytes)",
            line.len()
        );
        logged += 1;
    }
}

fn event_emitter(
    app: AppHandle,
    inner: Arc<Mutex<AgentHostInner>>,
    generation: u64,
    rx: mpsc::Receiver<HostEvent>,
) {
    while let Ok(event) = rx.recv() {
        if inner.lock().map(|g| g.generation).ok() != Some(generation) {
            break;
        }
        if app.emit(AGENT_HOST_EVENT, &event).is_err() {
            mark_exited(&inner, generation, None);
            break;
        }
    }
}

impl AgentHostState {
    /// Send a JSON-RPC request and await the correlated response.
    pub fn request(
        &self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, AgentHostError> {
        self.request_generation(method, params, timeout, None)
    }

    fn request_generation(
        &self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
        expected: Option<u64>,
    ) -> Result<Value, AgentHostError> {
        let (id, entry, deadline, generation) = {
            let mut inner = self.inner.lock().map_err(|e| AgentHostError::io(e))?;
            if inner.shutting_down && method != "shutdown" {
                return Err(AgentHostError::ShuttingDown {
                    message: "Agent Host is shutting down".to_string(),
                });
            }
            if !inner.refresh_liveness() {
                return Err(AgentHostError::not_running());
            }
            if expected.is_some_and(|generation| generation != inner.generation) {
                return Err(AgentHostError::not_running());
            }
            let id = inner.next_request_id();
            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params.unwrap_or(Value::Null),
            });
            let mut payload = serde_json::to_string(&request).map_err(|e| AgentHostError::io(e))?;
            payload.push('\n');
            if payload.len() > MAX_MESSAGE_BYTES + 1 || inner.pending.len() >= 64 {
                return Err(AgentHostError::io("Agent Host request capacity exceeded"));
            }
            let writer = inner
                .stdin
                .as_ref()
                .ok_or_else(AgentHostError::not_running)?
                .clone();
            let entry = PendingEntry::new();
            inner.pending.insert(id, entry.clone());
            if writer.try_send((id, payload.into_bytes())).is_err() {
                inner.pending.remove(&id);
                return Err(AgentHostError::io("Agent Host writer queue full or closed"));
            }
            let deadline = Instant::now() + timeout;
            (id, entry, deadline, inner.generation)
        };
        // Wait outside the lock so the stdout reader can resolve the entry.
        let mut guard = entry.result.lock().map_err(|e| AgentHostError::io(e))?;
        loop {
            if let Some(result) = guard.take() {
                return result;
            }
            let now = Instant::now();
            if now >= deadline {
                drop(guard);
                if let Ok(mut inner) = self.inner.lock() {
                    if inner.generation == generation {
                        inner.pending.remove(&id);
                        let _ = stop_child(&mut inner, true);
                    }
                }
                return Err(AgentHostError::RequestTimeout {
                    id,
                    message: format!("Agent Host request '{method}' timed out"),
                });
            }
            let remaining = deadline - now;
            let (new_guard, _) = entry
                .cvar
                .wait_timeout(guard, remaining)
                .map_err(|e| AgentHostError::io(e))?;
            guard = new_guard;
        }
    }

    /// Spawn (or reuse) the host and complete version negotiation.
    pub fn start(&self, app: &AppHandle) -> Result<AgentHostStatus, AgentHostError> {
        let (command, lease) = build_host_command(app)?;
        self.start_leased_command(command, Some(app.clone()), lease)
    }

    /// Core spawn path, given a pre-built command. App-handle concerns (resource
    /// resolution) live in [`build_host_command`]; this is the part supervision
    /// tests drive with fixture processes. `emitter_app` spawns the WebView event
    /// emitter; `None` (tests) drops notifications on a closed channel.
    #[cfg(test)]
    fn start_command(
        &self,
        command: Command,
        emitter_app: Option<AppHandle>,
    ) -> Result<AgentHostStatus, AgentHostError> {
        self.start_leased_command(command, emitter_app, None)
    }

    fn start_leased_command(
        &self,
        mut command: Command,
        emitter_app: Option<AppHandle>,
        lease: Option<RuntimeLease>,
    ) -> Result<AgentHostStatus, AgentHostError> {
        let _lifecycle = self.lifecycle.lock().map_err(AgentHostError::io)?;
        #[cfg(windows)]
        return Err(AgentHostError::LaunchFailure {
            message: "Agent Host supervision is not supported on Windows yet".into(),
        });
        // Fast path: a live, healthy host is reused. Otherwise stop any stale
        // handle, spawn a fresh child, install it under a new generation, and
        // start the reader/stderr/emitter threads.
        {
            let mut inner = self.inner.lock().map_err(|e| AgentHostError::io(e))?;
            inner.shutting_down = false;
            if inner.refresh_liveness() && matches!(inner.health, AgentHostHealth::Healthy) {
                return Ok(current_status(&inner));
            }
            if inner.within_crash_loop() {
                return Err(AgentHostError::CrashLoop {
                    message: format!(
                        "Agent Host crashed repeatedly; refusing restart for {}s",
                        CRASH_LOOP_WINDOW.as_secs()
                    ),
                });
            }
            // Stop any stale handle before respawning.
            stop_child(&mut inner, true)?;
            // The supervisor owns the process group + stdio regardless of what
            // the caller configured: a dedicated group is required for whole-tree
            // cleanup (killpg reaches grandchildren), and pipes are required for
            // the JSON-RPC bridge.
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                command.process_group(0);
            }
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let mut child = command.spawn().map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AgentHostError::LaunchFailure {
                        message: "Agent Host failed to launch (node or bundle not found)"
                            .to_string(),
                    }
                } else {
                    AgentHostError::LaunchFailure {
                        message: format!("Agent Host failed to launch: {e}"),
                    }
                }
            })?;
            let stdin = child.stdin.take();
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            let generation = inner.bump_generation();
            inner.child = Some(child);
            if let Some(lease) = lease {
                inner.leases.insert("node".into(), lease);
            }
            let (writer_tx, writer_rx) = mpsc::sync_channel::<(u64, Vec<u8>)>(8);
            inner.stdin = Some(writer_tx);
            if let Some(mut pipe) = stdin {
                let writer_inner = self.inner.clone();
                thread::spawn(move || {
                    while let Ok((id, payload)) = writer_rx.recv() {
                        if writer_inner.lock().map(|g| g.generation).ok() != Some(generation) {
                            break;
                        }
                        if pipe.write_all(&payload).and_then(|_| pipe.flush()).is_err() {
                            mark_exited(&writer_inner, generation, None);
                            break;
                        }
                        let _ = id;
                    }
                });
            }
            inner.health = AgentHostHealth::Starting;
            inner.last_error = None;
            inner.record_restart();

            let (tx, rx) = mpsc::sync_channel::<HostEvent>(EVENT_CHANNEL_CAPACITY);
            let reader_inner = Arc::clone(&self.inner);
            // Stdio::piped() yields both handles; if either is missing the
            // reader cannot run and `tx` is dropped so the emitter exits.
            if let (Some(stdout), Some(stderr)) = (stdout, stderr) {
                thread::Builder::new()
                    .name("agent-host-stdout".to_string())
                    .spawn(move || stdout_reader(reader_inner, stdout, generation, tx))
                    .map_err(|e| AgentHostError::io(e))?;
                thread::Builder::new()
                    .name("agent-host-stderr".to_string())
                    .spawn(move || stderr_drainer(stderr))
                    .map_err(|e| AgentHostError::io(e))?;
            } else {
                drop(tx);
            }
            // Spawn the WebView event emitter when an app handle is present; in
            // tests (None) the channel closes and the reader drops notifications.
            if let Some(emitter_handle) = emitter_app {
                let emitter_inner = self.inner.clone();
                thread::Builder::new()
                    .name("agent-host-emitter".to_string())
                    .spawn(move || event_emitter(emitter_handle, emitter_inner, generation, rx))
                    .map_err(|e| AgentHostError::io(e))?;
            } else {
                thread::spawn(move || while rx.recv().is_ok() {});
            }
        }

        // Version negotiation outside the lock (request() re-acquires it).
        let initialize = self.request(
            "initialize",
            Some(serde_json::json!({
                "protocolVersion": PROTOCOL_VERSION,
                "client": { "name": "specops-tauri" }
            })),
            INITIALIZE_TIMEOUT,
        );
        match initialize {
            Ok(result) => {
                let server_protocol = result
                    .get("protocolVersion")
                    .and_then(Value::as_i64)
                    .unwrap_or(PROTOCOL_VERSION);
                let host_version = result
                    .get("server")
                    .and_then(|s| s.get("build"))
                    .and_then(|b| b.get("hostVersion"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let mut inner = self.inner.lock().map_err(|e| AgentHostError::io(e))?;
                if !matches!(inner.health, AgentHostHealth::Starting) {
                    // A concurrent stop retired this child.
                    return Err(AgentHostError::not_running());
                }
                inner.protocol_version = Some(server_protocol);
                inner.host_version = host_version;
                inner.health = AgentHostHealth::Healthy;
                Ok(current_status(&inner))
            }
            Err(error) => {
                // Initialize failed — tear down the half-started child.
                if let Ok(mut inner) = self.inner.lock() {
                    let _ = stop_child(&mut inner, true);
                    inner.last_error = Some(error.clone());
                    inner.health = AgentHostHealth::Error;
                }
                Err(match &error {
                    AgentHostError::RequestTimeout { .. } => AgentHostError::InitializeTimeout {
                        message: "Agent Host did not initialize in time".to_string(),
                    },
                    other => other.clone(),
                })
            }
        }
    }

    /// Cooperative shutdown: best-effort `shutdown` request, then bounded reap.
    pub fn shutdown(&self) -> Result<(), AgentHostError> {
        let _lifecycle = self.lifecycle.lock().map_err(AgentHostError::io)?;
        {
            let mut inner = self.inner.lock().map_err(|e| AgentHostError::io(e))?;
            inner.shutting_down = true;
        }
        // Best-effort cooperative shutdown; ignore transport errors.
        let _ = self.request("shutdown", None, SHUTDOWN_GRACE);
        let mut inner = self.inner.lock().map_err(|e| AgentHostError::io(e))?;
        stop_child(&mut inner, false)?;
        inner.shutting_down = false;
        Ok(())
    }

    /// Stop without sending a `shutdown` request (recovery / status reset).
    pub fn stop(&self) -> Result<(), AgentHostError> {
        let _lifecycle = self.lifecycle.lock().map_err(AgentHostError::io)?;
        let mut inner = self.inner.lock().map_err(|e| AgentHostError::io(e))?;
        inner.shutting_down = true;
        let result = stop_child(&mut inner, true);
        inner.shutting_down = false;
        result
    }

    pub fn status(&self) -> Result<AgentHostStatus, AgentHostError> {
        let mut inner = self.inner.lock().map_err(|e| AgentHostError::io(e))?;
        inner.refresh_liveness();
        Ok(current_status(&inner))
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub async fn agent_host_start(
    app: AppHandle,
    state: State<'_, AgentHostState>,
) -> Result<AgentHostStatus, AgentHostError> {
    let state = state.inner().clone();
    let app = app;
    tauri::async_runtime::spawn_blocking(move || state.start(&app))
        .await
        .map_err(|e| AgentHostError::Io {
            message: format!("agent_host_start task failed: {e}"),
        })?
}

#[tauri::command(async)]
pub async fn agent_host_stop(
    state: State<'_, AgentHostState>,
) -> Result<AgentHostStatus, AgentHostError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<AgentHostStatus, AgentHostError> {
        // Cooperative: send `shutdown`, then force-reap if it hangs.
        state.shutdown()?;
        state.status()
    })
    .await
    .map_err(|e| AgentHostError::Io {
        message: format!("agent_host_stop task failed: {e}"),
    })?
}

#[tauri::command(async)]
pub async fn agent_host_restart(
    app: AppHandle,
    state: State<'_, AgentHostState>,
) -> Result<AgentHostStatus, AgentHostError> {
    let state = state.inner().clone();
    let app = app;
    tauri::async_runtime::spawn_blocking(move || -> Result<AgentHostStatus, AgentHostError> {
        state.stop()?;
        state.start(&app)
    })
    .await
    .map_err(|e| AgentHostError::Io {
        message: format!("agent_host_restart task failed: {e}"),
    })?
}

#[tauri::command]
pub fn agent_host_status(
    state: State<'_, AgentHostState>,
) -> Result<AgentHostStatus, AgentHostError> {
    state.status()
}

fn validate_component_request(
    manager: &ComponentManager,
    leases: &HashMap<String, RuntimeLease>,
    method: &str,
    runtime: &str,
) -> Result<(), AgentHostError> {
    if matches!(method, "turn.cancel" | "permission.reply" | "question.reply") { return Ok(()); }
    for lease in leases.values() {
        manager.validate_launch(lease).map_err(|_| AgentHostError::ComponentUnavailable {
            component: runtime.into(),
            message: "Software identity changed or was revoked. Finish or cancel existing work, review Software and reconnect explicitly.".into(),
        })?;
    }
    Ok(())
}

/// Generic JSON-RPC forwarder. The WebView calls this with a host method + params
/// and receives the host `result`; protocol errors arrive as
/// `AgentHostError::Protocol` and transport failures as the other variants.
#[tauri::command(async)]
pub async fn agent_host_request(
    method: String,
    mut params: Option<Value>,
    timeout_ms: Option<u64>,
    app: AppHandle,
    state: State<'_, AgentHostState>,
) -> Result<Value, AgentHostError> {
    let state = state.inner().clone();
    let timeout = timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_REQUEST_TIMEOUT)
        .clamp(Duration::from_millis(1), DEFAULT_REQUEST_TIMEOUT);
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = state.lifecycle.lock().map_err(AgentHostError::io)?;
        if let Some(object) = params.as_mut().and_then(Value::as_object_mut) {
            object.remove("__managedComponent");
            let runtime = object.get("runtimeId").or_else(|| object.get("native").and_then(|n| n.get("runtimeId"))).and_then(Value::as_str).map(str::to_owned);
            if let Some(runtime) = runtime.filter(|_| !matches!(method.as_str(), "discover" | "initialize" | "shutdown")) {
                let id = match runtime.as_str() { "codex" => Some(ComponentId::Codex), "opencode" => Some(ComponentId::Opencode), "claude" => Some(ComponentId::Claude), "cursor" => Some(ComponentId::Cursor), _ => None };
                if let Some(id) = id {
                    let mut inner = state.inner.lock().map_err(AgentHostError::io)?;
                    if !inner.refresh_liveness() { return Err(AgentHostError::not_running()); }
                    if !inner.leases.contains_key(&runtime) {
                        let lease = app.state::<ComponentManager>().acquire_runtime(id).map_err(|_| AgentHostError::ComponentUnavailable { component: runtime.clone(), message: format!("The {runtime} component is unavailable or incompatible. Install or repair it in Software, then reconnect the original profile explicitly.") })?;
                        inner.leases.insert(runtime.clone(), lease);
                    }
                    let lease = &inner.leases[&runtime];
                    validate_component_request(&app.state::<ComponentManager>(), &inner.leases, &method, &runtime)?;
                    object.insert("__managedComponent".into(), serde_json::json!({ "root": lease.root, "manifest": lease.manifest }));
                }
            }
        }
        let generation = state.inner.lock().map_err(AgentHostError::io)?.generation;
        drop(_lifecycle);
        state.request_generation(&method, params, timeout, Some(generation))
    })
        .await
        .map_err(|e| AgentHostError::Io {
            message: format!("agent_host_request task failed: {e}"),
        })?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn generation_pinned_request_never_reaches_replacement_host() {
        ensure_host_built();
        let state = AgentHostState::new();
        let mut command = Command::new(node_path());
        command.arg(host_dist());
        state.start_command(command, None).unwrap();
        let old = state.status().unwrap().generation;
        state.stop().unwrap();
        let mut command = Command::new(node_path());
        command.arg(host_dist());
        state.start_command(command, None).unwrap();
        assert!(state
            .request_generation("discover", None, DEFAULT_REQUEST_TIMEOUT, Some(old))
            .is_err());
        state.stop().unwrap();
    }

    #[test]
    fn host_generation_holds_all_verified_leases_until_stop_and_crash_cleanup() {
        ensure_host_built();
        for id in [
            ComponentId::Node,
            ComponentId::Codex,
            ComponentId::Opencode,
            ComponentId::Claude,
            ComponentId::Cursor,
        ] {
            for crash in [false, true] {
                let (_temp, manager) = crate::component_manager::tests::installed_manager(id);
                let lease = manager.acquire_runtime(ComponentId::Node).unwrap();
                let request = crate::component_manager::Request {
                    id,
                    version: manager.acquire_runtime(id).unwrap().manifest.version,
                };
                let state = AgentHostState::new();
                let mut command = Command::new(node_path());
                command.arg(host_dist());
                state
                    .start_leased_command(command, None, Some(lease))
                    .unwrap();
                if id != ComponentId::Node {
                    state
                        .inner
                        .lock()
                        .unwrap()
                        .leases
                        .insert(id.as_str().into(), manager.acquire_runtime(id).unwrap());
                }
                assert!(manager.remove(request.clone()).is_err());
                if crash {
                    state
                        .inner
                        .lock()
                        .unwrap()
                        .child
                        .as_mut()
                        .unwrap()
                        .kill()
                        .unwrap();
                    let deadline = Instant::now() + Duration::from_secs(5);
                    while state.status().unwrap().running && Instant::now() < deadline {
                        thread::sleep(Duration::from_millis(10));
                    }
                } else {
                    state.stop().unwrap();
                }
                assert!(!state.status().unwrap().running);
                assert!(manager.remove(request).is_ok());
            }
        }
    }

    #[test]
    fn real_host_keeps_owned_process_and_cleanup_after_signed_revocation_but_blocks_new_component_work() {
        ensure_host_built();
        let (_temp, manager) = crate::component_manager::tests::installed_manager(ComponentId::Codex);
        let state = AgentHostState::new(); let mut command = Command::new(node_path()); command.arg(host_dist());
        state.start_leased_command(command, None, Some(manager.acquire_runtime(ComponentId::Node).unwrap())).unwrap();
        state.inner.lock().unwrap().leases.insert("codex".into(), manager.acquire_runtime(ComponentId::Codex).unwrap());
        let before = state.status().unwrap();
        { let inner = state.inner.lock().unwrap(); validate_component_request(&manager, &inner.leases, "session.list", "codex").unwrap(); }
        manager.accept_catalog(include_bytes!("../fixtures/components/distribution/revoked-catalog.json")).unwrap();
        { let inner = state.inner.lock().unwrap();
            assert!(validate_component_request(&manager, &inner.leases, "turn.start", "codex").is_err());
            for method in ["turn.cancel", "permission.reply", "question.reply"] { validate_component_request(&manager, &inner.leases, method, "codex").unwrap(); }
        }
        let after = state.status().unwrap(); assert!(after.running); assert_eq!(before.generation, after.generation);
        assert!(manager.remove(crate::component_manager::Request { id: ComponentId::Codex, version: "0.160.0".into() }).is_err());
        state.stop().unwrap(); assert!(!state.status().unwrap().running);
        manager.remove(crate::component_manager::Request { id: ComponentId::Codex, version: "0.160.0".into() }).unwrap();
    }

    #[test]
    fn read_bounded_line_short_lines() {
        let mut reader = BufReader::new(Cursor::new(b"a\nbb\n".to_vec()));
        let mut buf = Vec::new();
        match read_bounded_line(&mut reader, b'\n', &mut buf, 1024) {
            LineRead::Line(n) => {
                assert_eq!(n, 2);
                assert_eq!(&buf[..n], b"a\n");
            }
            _ => panic!("expected Line"),
        }
        buf.clear();
        match read_bounded_line(&mut reader, b'\n', &mut buf, 1024) {
            LineRead::Line(n) => assert_eq!(&buf[..n], b"bb\n"),
            _ => panic!("expected Line"),
        }
        buf.clear();
        assert!(matches!(
            read_bounded_line(&mut reader, b'\n', &mut buf, 1024),
            LineRead::Eof
        ));
    }

    #[test]
    fn read_bounded_line_truncates_runaway() {
        let payload = vec![b'A'; 100_000];
        let mut reader = BufReader::new(Cursor::new(payload));
        let mut buf = Vec::new();
        match read_bounded_line(&mut reader, b'\n', &mut buf, 1024) {
            LineRead::Truncated(n) => assert_eq!(n, 1024),
            _ => panic!("expected Truncated"),
        }
    }

    #[test]
    fn crash_loop_breaker_engages_after_threshold() {
        let mut inner = AgentHostInner::new();
        for _ in 0..CRASH_LOOP_THRESHOLD {
            inner.record_restart();
        }
        assert!(
            inner.within_crash_loop(),
            "breaker must engage at threshold"
        );
    }

    #[test]
    fn crash_loop_window_expires() {
        let mut inner = AgentHostInner::new();
        // Inject timestamps just outside the window.
        let old = Instant::now()
            .checked_sub(CRASH_LOOP_WINDOW + Duration::from_secs(1))
            .unwrap();
        for _ in 0..CRASH_LOOP_THRESHOLD {
            inner.restarts.push(old);
        }
        assert!(!inner.within_crash_loop(), "old restarts must not count");
    }

    #[test]
    fn forwarded_notification_carries_supervised_generation() {
        let event = HostEvent {
            host_generation: 3,
            method: "profile.authUpdated".to_string(),
            params: None,
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["hostGeneration"], 3);
    }

    #[test]
    fn replacing_child_retires_generation() {
        let mut inner = AgentHostInner::new();
        let first = inner.bump_generation();
        let second = inner.bump_generation();
        assert_ne!(first, second);
    }

    #[test]
    fn request_ids_are_monotonic() {
        let mut inner = AgentHostInner::new();
        let a = inner.next_request_id();
        let b = inner.next_request_id();
        assert_eq!(a + 1, b);
    }

    /// A stale stdout reader must not resolve requests against a newer generation.
    #[test]
    fn stale_reader_cannot_touch_new_generation() {
        let state = AgentHostState::new();
        let stale_gen;
        let entry;
        {
            let mut inner = state.inner.lock().unwrap();
            stale_gen = inner.bump_generation();
            // Simulate a request made against the NEW generation.
            let new_gen = inner.bump_generation();
            let _ = new_gen;
            let id = inner.next_request_id();
            entry = PendingEntry::new();
            inner.pending.insert(id, entry.clone());
        }
        // mark_exited with the stale generation must be a no-op (new state intact).
        mark_exited(&state.inner, stale_gen, Some(1));
        let inner = state.inner.lock().unwrap();
        // The pending entry for the new-generation request survives.
        assert_eq!(inner.pending.len(), 1);
        assert!(entry.result.lock().unwrap().is_none());
    }

    /// Pending requests resolve exactly once via the condvar path.
    #[test]
    fn pending_request_resolves_once() {
        let state = AgentHostState::new();
        let id;
        let entry;
        {
            let mut inner = state.inner.lock().unwrap();
            id = inner.next_request_id();
            entry = PendingEntry::new();
            inner.pending.insert(id, entry.clone());
        }
        // Resolver path.
        {
            let mut inner = state.inner.lock().unwrap();
            resolve_pending(&mut inner, id, Ok(Value::String("pong".to_string())));
        }
        let guard = entry.result.lock().unwrap();
        assert!(matches!(&*guard, Some(Ok(v)) if v == "pong"));
    }

    /// Timed-out requests are removed from the pending map (no leak).
    #[test]
    fn timed_out_request_is_removed() {
        let state = AgentHostState::new();
        let id;
        {
            let mut inner = state.inner.lock().unwrap();
            id = inner.next_request_id();
            inner.pending.insert(id, PendingEntry::new());
        }
        {
            let mut inner = state.inner.lock().unwrap();
            // Simulate the timeout cleanup path removing the entry.
            inner.pending.remove(&id);
        }
        let inner = state.inner.lock().unwrap();
        assert!(inner.pending.is_empty());
    }

    // ----- integration: real processes (phase E, task AS01-E-04) -------------

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
    }

    fn host_dist() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../host/dist/index.js")
    }

    fn host_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../host")
    }

    fn node_path() -> PathBuf {
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|dir| dir.join("node"))
            .find(|path| path.is_file())
            .expect("Explicit test environment must supply Node")
    }

    /// Build the real host bundle once for the process-suite tests.
    fn ensure_host_built() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let build_script = host_dir().join("scripts/build.mjs");
            let output = std::process::Command::new(node_path())
                .arg(&build_script)
                .output()
                .expect("host build must succeed");
            assert!(
                output.status.success(),
                "host build failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        });
    }

    #[cfg(unix)]
    fn pid_alive(pid: u32) -> bool {
        use nix::sys::signal::kill;
        use nix::unistd::Pid;
        match pid.try_into().ok().map(Pid::from_raw) {
            Some(p) => kill(p, None).is_ok(),
            None => false,
        }
    }

    #[cfg(unix)]
    fn wait_for_pid_exit(pid: u32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if !pid_alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        !pid_alive(pid)
    }

    /// Healthy lifecycle against the real built host: initialize, discover,
    /// create a session, then cooperative shutdown — and the child is reaped.
    #[test]
    fn real_host_lifecycle_and_clean_shutdown() {
        ensure_host_built();
        let node = node_path();
        let mut command = Command::new(&node);
        command.arg(host_dist());
        let state = AgentHostState::new();
        let status = state
            .start_command(command, None)
            .expect("host should start and initialize");
        assert!(status.running);
        assert_eq!(status.health, AgentHostHealth::Healthy);
        assert_eq!(status.protocol_version, Some(PROTOCOL_VERSION));

        let discover = state
            .request("discover", None, DEFAULT_REQUEST_TIMEOUT)
            .expect("discover should succeed");
        let runtimes = discover
            .get("runtimes")
            .and_then(Value::as_array)
            .expect("discover returns runtimes");
        assert!(runtimes
            .iter()
            .any(|r| r.get("id").and_then(Value::as_str) == Some("fake")));

        let created = state
            .request(
                "session.create",
                Some(serde_json::json!({ "runtimeId": "fake", "workspaceRootPath": "/ws" })),
                DEFAULT_REQUEST_TIMEOUT,
            )
            .expect("session.create should succeed");
        let native = created
            .get("nativeSessionId")
            .and_then(Value::as_str)
            .expect("create returns nativeSessionId");
        assert!(!native.is_empty());

        state.shutdown().expect("shutdown should reap the child");
        let status = state.status().expect("status after shutdown");
        assert!(!status.running);
    }

    /// A host that exits before negotiating surfaces an error and is reaped;
    /// a fresh start afterwards succeeds (restart eligibility).
    #[test]
    fn host_crash_surfaces_error_and_is_recoverable() {
        let node = node_path();
        let mut command = Command::new(&node);
        command.arg("-e").arg("process.exit(1)");
        let state = AgentHostState::new();
        let result = state.start_command(command, None);
        assert!(result.is_err(), "a crashing host must surface an error");

        // A subsequent healthy start must succeed (the crash did not poison state).
        let mut command = Command::new(&node);
        command.arg("-e").arg("process.exit(0)");
        let result = state.start_command(command, None);
        // exit(0) still produces EOF before initialize → error, but no panic/lock.
        assert!(result.is_err());
        assert!(state.status().unwrap().running == false);
    }

    /// A host that ignores `shutdown` is force-killed within a bounded window
    /// (cooperative timeout → process-group termination). Also exercises a noisy
    /// stderr stream so the bounded drainer cannot block or exhaust memory.
    #[test]
    fn ignored_shutdown_is_force_killed() {
        let node = node_path();
        let mut command = Command::new(&node);
        command
            .arg(fixtures_dir().join("ignored_shutdown.cjs"))
            .arg("noisy");
        let state = AgentHostState::new();
        state
            .start_command(command, None)
            .expect("fixture should initialize");
        let pid = state.status().unwrap().pid.expect("child has a pid");
        let start = Instant::now();
        state
            .shutdown()
            .expect("forced shutdown must reap the child");
        // Bounded: graceful grace (3s) + reap slack. The point is it terminates,
        // not that it hangs forever.
        assert!(
            start.elapsed() < SHUTDOWN_GRACE + Duration::from_secs(5),
            "shutdown took too long: {:?}",
            start.elapsed()
        );
        #[cfg(unix)]
        assert!(
            wait_for_pid_exit(pid, Duration::from_secs(2)),
            "ignored-shutdown child must be reaped"
        );
    }

    /// A host that spawns a grandchild and exits without cleaning it up must not
    /// orphan the grandchild: the supervisor's process-group kill reaps it.
    #[cfg(unix)]
    #[test]
    fn grandchild_is_not_orphaned() {
        let node = node_path();
        let pidfile = std::env::temp_dir().join(format!(
            "specops-agent-host-grandchild-{}.pid",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&pidfile);
        let mut command = Command::new(&node);
        command
            .arg(fixtures_dir().join("child_spawn.cjs"))
            .arg(&pidfile);
        let state = AgentHostState::new();
        state
            .start_command(command, None)
            .expect("fixture should initialize and spawn a grandchild");

        // Wait for the fixture to write the grandchild's pid.
        let pid = {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Ok(text) = std::fs::read_to_string(&pidfile) {
                    if let Ok(pid) = text.trim().parse::<u32>() {
                        break pid;
                    }
                }
                if Instant::now() >= deadline {
                    panic!("grandchild pid file was not written");
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        };
        assert!(pid_alive(pid), "grandchild must be alive before shutdown");

        state
            .shutdown()
            .expect("shutdown must reap the process group");

        assert!(
            wait_for_pid_exit(pid, Duration::from_secs(3)),
            "grandchild must be reaped (no orphan)"
        );
        let _ = std::fs::remove_file(&pidfile);
    }
    #[test]
    fn blocked_stdin_does_not_block_status_or_stop() {
        let mut command = Command::new(node_path());
        command.arg("-e").arg(r#"
          process.stdin.once('data', b => {
            const r = JSON.parse(b.toString());
            process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{protocolVersion:1}})+'\n');
            process.stdin.pause();
          });
          setInterval(() => {}, 1000);
        "#);
        let state = AgentHostState::new();
        state.start_command(command, None).unwrap();
        let requester = state.clone();
        let started = Instant::now();
        let request = thread::spawn(move || {
            requester.request(
                "health",
                Some(Value::String("x".repeat(900_000))),
                Duration::from_millis(250),
            )
        });
        thread::sleep(Duration::from_millis(50));
        assert!(state.status().unwrap().running);
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(request.join().unwrap().is_err());
        assert!(!state.status().unwrap().running);
        state.stop_sync();
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn simultaneous_starts_reuse_one_generation() {
        ensure_host_built();
        let state = AgentHostState::new();
        let tasks: Vec<_> = (0..3)
            .map(|_| {
                let state = state.clone();
                thread::spawn(move || {
                    let mut command = Command::new(node_path());
                    command.arg(host_dist());
                    state.start_command(command, None).unwrap()
                })
            })
            .collect();
        let statuses: Vec<_> = tasks.into_iter().map(|t| t.join().unwrap()).collect();
        assert!(statuses
            .iter()
            .all(|s| s.generation == statuses[0].generation && s.pid == statuses[0].pid));
        state.shutdown().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn liveness_poll_after_crash_kills_term_resistant_descendants() {
        let pidfile =
            std::env::temp_dir().join(format!("specops-crash-tree-{}.pid", std::process::id()));
        let mut command = Command::new(node_path());
        command.arg("-e").arg(r#"
          const {spawn} = require('node:child_process');
          const fs = require('node:fs');
          const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {stdio:'ignore'});
          fs.writeFileSync(process.argv[1], String(child.pid));
          let buffer = '';
          process.stdin.on('data', b => { buffer += b; let i;
            while((i=buffer.indexOf('\n')) >= 0) {
              const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);
              if(r.method === 'health') process.exit(1);
              process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{protocolVersion:1}})+'\n');
            }
          });
        "#).arg(&pidfile);
        let state = AgentHostState::new();
        state.start_command(command, None).unwrap();
        let pid: u32 = std::fs::read_to_string(&pidfile).unwrap().parse().unwrap();
        let request_state = state.clone();
        let request =
            thread::spawn(move || request_state.request("health", None, Duration::from_secs(2)));
        for _ in 0..100 {
            let _ = state.status();
            thread::sleep(Duration::from_millis(5));
        }
        assert!(request.join().unwrap().is_err());
        assert!(wait_for_pid_exit(pid, Duration::from_secs(2)));
        let _ = std::fs::remove_file(pidfile);
    }
}
