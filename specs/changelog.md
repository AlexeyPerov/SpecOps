# Changelog

## 2026-08-15 23:25 MSK — Fix drag-and-drop file opening: reads limited to $HOME, silent cross-window no-ops, 1 MiB confirm stubs, invisible errors

Drag-and-drop almost never opened files because four independent gates sat in
the drop path (`onDragDropEvent` → `openDroppedPath` → `openActivePath`), and
every failure surfaced only as easy-to-miss status-bar text, so each one looked
like a silent no-op:

- **fs scope rejected any path outside `$HOME`/`$APPDATA`** — `stat` (the very
  first call on the drop path) failed for `/tmp`, `/Volumes`, `/var/folders`
  (browser/mail temp files) etc. Read-type permissions (`fs:allow-stat`,
  `fs:allow-read-file`, `fs:allow-read-text-file`, `fs:allow-read-dir`) now
  allow `**`: reads follow explicit user gestures (picker, drop, app-icon
  open) that can target any path the OS allows, while the credential deny
  lists (ssh keys, keychains, cloud tokens) and the write-under-$HOME policy
  are unchanged.
- **Stale cross-window claims swallowed opens silently** — if
  `open-files.json` credited a closed/crashed window with the path, the drop
  "redirected" into the void: `emitTo` went nowhere and the owner-side
  `SELECT_TAB_FOR_PATH` handler ignored a missing tab. Now the dropping window
  verifies the owner is live, prunes dead-window claims and takes the claim
  locally; the owner-side handler falls back to opening the file itself on
  registry desync.
- **Large-file confirm gate (default 1 MiB) turned most real drops into
  "pending confirm" stubs.** Drops now bypass the user's confirm threshold —
  the drop itself is the explicit gesture — with a hard ceiling
  (`DROP_OPEN_HARD_MAX_BYTES`, 512 MiB) still landing oversized files as
  confirm stubs. Pickers/tree/recent keep the old threshold.
- **Failures were invisible.** New minimal toast bus (`toastBus.ts` +
  `ToastOverlay.svelte`): failed/missing dropped files and inaccessible
  dropped workspaces now raise a visible error toast; the status bar keeps its
  informational line.
- **Drop feedback:** `onDragDropEvent` now handles `enter`/`over`/`leave`
  (previously only `drop`), driving a `FileDropOverlay.svelte` full-window
  highlight ("Drop to open files") via a `fileDragActive` store.
- Robustness/cleanup: the drag-drop listener registers **first** in the
  runtime startup chain (a failure in any later listener used to leave the
  window without drop handling for the whole session); removed the dead
  duplicate `openDroppedPath` loop in the page handlers; `openAndActivatePath`
  now threads `OpenPathActivationOptions` and returns its
  `OpenActivePathResult` so the drop path can react to failures. Fixed
  pre-existing broken relative imports in `appShellHostTypes.ts` (its
  `../../domain`/`../../services` paths never resolved).
- Tests: dropped-file gate bypass + hard ceiling, dead-owner claim takeover,
  error toasts for failed/missing/vanished drops and blocked workspaces,
  toast bus stack behaviour.

## 2026-08-15 23:12 MSK — Fix Find-in-Project: results wiped/cancelled, picker insta-close, stuck Searching; add project-panel search button

The workspace-switch effect in `+page.svelte` called
`closeAllOnWorkspaceSwitch()` on **every** re-run, but it re-runs far more
often than workspace switches: the `workspaces` array identity changes on
every active-context snapshot update (every tab open/close/activate), and the
`getState()` reads inside the close call made all ten overlay flags effect
dependencies too. Consequences: in-flight and finished project-search results
were cancelled/wiped moments after landing (search "never finds anything"),
and freshly opened modal pickers (quick open etc.) closed themselves
instantly.

- **Root fix:** the close/cancel half now fires only when `activeWorkspaceRoot`
  actually changed, and runs untracked so overlay-flag reads never widen the
  effect's dependency set. `closeAllOnWorkspaceSwitch` also patches only
  flags that are actually open.
- **Search cancellation hardening:** the generation is bumped *before*
  awaiting the file catalog (a close/switch during the wait now aborts instead
  of leaking a full scan for a closed panel), and `waitForReady()` waiters are
  released when a catalog is disposed (previously they hung forever with the
  panel stuck at "Searching…" and the Search button disabled).
- **Search observability:** the scan reports live progress ("Searching… N
  files" every 200 files) and the status line now includes scanned/unreadable
  file counts (`stat`/`readTextFile` failures are counted instead of silently
  skipped), so "No results" is distinguishable from "read everything failed".
- **Project panel:** new search (magnifier) button in the panel header that
  opens Find-in-Project for the active workspace — same as Cmd+Shift+F.
- Tests: overlay coordinator (no-op patch when nothing is open),
  `runProjectSearch` (wait-window cancellation, count/progress status), and
  `searchInProject` (scanned/unreadable counters).

## 2026-08-15 — Milestone 01 code review: findings recorded (review round 1)

Full-milestone review of the phase A–F implementation (session domain, adapter
contract + fake runtime, Agent Host package, Tauri supervision, frontend
Sessions integration) recorded in
[`specs/ops/01-foundation-agent-host/review-issues-1.md`](ops/01-foundation-agent-host/review-issues-1.md).
All targeted suites are green, but the review found 3 Critical and ~29 Major
issues concentrated in shutdown/recovery paths, binding persistence, and the
shared contract suite; several phase acceptance criteria are only partially met.
The issue list includes a recommended fix ordering — a stabilization backlog
that should land before/with phase 02, since the phase-02 exit gates depend
directly on the affected paths. No code changed in this commit.

## 2026-08-15 10:05 MSK — Phase F: Sessions UX through the Agent Host; foundation milestone 01 complete

Workspace Sessions is now fully runtime-neutral: the UI, state, and send
pipeline drive the supervised Agent Host through the phase-E Tauri bridge, and
every provider-prefixed session field is gone from common code. **Breaking
sessions-state reset** — persisted session indexes and thread files with the
old provider-prefixed fields no longer decode; per repo policy there is no
migration (the store starts clean).

- **Neutral session binding (F-01):** `SessionIndexEntry` /
  `ChatThreadMetadata` / the `chatStore` link API / the persistence codec use
  `runtimeId` + `nativeSessionId` + `modelId` + `shareUrl` + `parentSessionId`
  (+ `selectedModeId`, `runtimeId` on thread metadata). The runtime binding is
  immutable: re-linking a bound session to another runtime or native session is
  rejected — create a new session instead.
- **Host-backed send pipeline (F-03):** `chatSendPipeline` no longer constructs
  a workspace backend or the legacy sidecar. It lazily starts the supervised
  host (one cached start), creates or resumes the native binding, streams
  `turn.send` events through `foldSessionEvent` into the live transcript,
  replies to permission/question prompts through the host, cancels via
  `turn.cancel`, and maps typed host errors to user-facing copy. Retry logic,
  queue/steer, attachments, and prompt history are unchanged.
- **Neutral Sessions UI (F-02/F-03):** the composer gains a runtime label +
  neutral model/mode pickers fed by host catalogs (with explanatory
  loading/empty/error states); the panel header shows the session runtime and
  Agent Host health, plus a host-restart recovery action. Lifecycle actions
  without a host protocol method (fork / revert / share / summarize / export /
  external session browsing) are hidden; rename stays local-store. Sidecar-fed
  UI glue is deleted (todo/diff panels, slash-command and mention pickers,
  agent/provider catalog picker, `session.messages` hydration) and the
  session-list "Import" entry point is hidden.
- **Regression + docs gate (F-04):** new tests cover store binding
  immutability, the host send pipeline against a mocked client (create /
  resume / stream / permission / cancel), the neutral persistence round-trip,
  and a phase-F absence guard (no provider-prefixed session field and no
  vendor SDK import in common code). Architecture + user docs now describe
  Sessions only; the OpenCode integration guides moved to
  `specs/archive/ops-postponed/docs/`.
- **Milestone 01 → Done** in the milestone README, execution-plan index, phase
  F plan, and roadmap; phase 02 (Claude adapter) is unblocked against the
  stable host/adapter contract.

Deferred cleanup (documented in the phase F plan): the Sessions dev gate still
lives under `settings.opencode` / the OpenCode settings surface; renaming it to
a neutral sessions gate lands with the settings-surface cleanup. The legacy
workspace backend + sidecar remain untouched as the phase-04 adapter candidate.


## 2026-08-12 10:45 MSK — Phase E: Tauri supervision and process-tree cleanup

The Agent Host is now a resilient, observable, fully reaped application child.
The WebView never spawns, connects to, or imports the host or any vendor runtime;
every UI request flows through Tauri to the host JSON-RPC bridge, and every host
notification is forwarded as a typed Tauri event.

- **Reusable host supervisor (`app/src-tauri/src/agent_host.rs`):**
  - Monotonic process generation: at most one generation owns requests; a stale
    stdout reader cannot resolve a request or mark health on a replacement child.
  - Bounded stdout/stderr drainers (per-line byte ceiling + line-count cap) so a
    chatty/broken host cannot exhaust memory or block its pipes.
  - Pending-request correlation over a sync condvar with per-request deadlines;
    initialize has its own shorter window.
  - Crash-loop breaker: after repeated starts within a window, restarts are
    refused with a typed `CrashLoop` error.
- **Bridge commands + events:** `agent_host_start`/`stop`/`restart`/`status`/
  `request`; the generic `agent_host_request(method, params)` is the single pipe
  the WebView uses. Notifications are forwarded on `specops/agent-host/event`.
  Protocol errors arrive as typed `AgentHostError::Protocol`; transport failures
  use the remaining typed variants.
- **Shutdown + recovery policy:** cooperative `shutdown` request → stdin close →
  bounded grace → process-group termination (negative-pgid `kill`) → SIGKILL →
  reap, on every path (normal quit, explicit stop, host crash, hung shutdown).
  The group is signalled even after a cooperative leader exit so grandchildren
  the host left behind are reaped. Wired into app `run_shutdown_cleanup`.
- **Supervision tests (13):** real-host lifecycle + clean shutdown; crash
  recovery; ignored/hung shutdown force-killed within a bounded window (with a
  noisy stderr stream); grandchild process-group reaping (no orphan remains on
  supported platforms); stale-generation isolation; bounded-line reader.

## 2026-08-12 09:00 MSK — Phases C + D: adapter contract, fake runtime, and bundled Agent Host

Foundation milestone 01 can now drive a deterministic fake runtime end to end
through a secret-safe local host. No vendor SDK type appears in any common
payload; the WebView imports no host code.

- **Phase C — adapter contract + deterministic fake runtime (`app/src/lib/session/adapter/`):**
  - **Mandatory core (C-01):** `AgentRuntimeAdapter` (describe / authenticate /
    createSession / resumeSession / send `AsyncIterable<SessionEvent>` / cancel /
    health + optional describeCatalog) with typed `AdapterError` codes, and
    documented terminal-state semantics: `turn.started` first, exactly one
    terminal event, monotonic `seq`, idempotent `cancel()`.
  - **Capabilities + extensions (C-02):** optional `Catalog`/`Permission`/
    `Question`/`Lifecycle`/`Checkpoint`/`Share`/`Configuration`/`Mcp`/`Skills`/
    `Commands`/`Todos`/`Diffs`/`Diagnostics` extension interfaces with type
    guards and a capability→extension honesty map (`inferCapabilities`); runtime
    settings extend the UI via configuration instead of widening the core.
  - **Deterministic fake runtime (C-03):** declarative `FakeRuntimeConfig`
    drives scripted create/resume/stream/cancel, tools, permission/question
    gating, error injection, unknown/malformed → redacted diagnostic coercion,
    hang/interruption, and restart behavior — no network, clock drift, or
    vendor binary.
  - **Shared contract suite (C-04):** `runAdapterContractSuite(factory)` asserts
    the universal invariants (lifecycle order, monotonic seq, terminal
    exclusivity, cancellation, restart, capability honesty); the fake passes and
    phases 02–05 plug real adapters in unchanged. 27 adapter tests (12 contract
    + 15 fake-specific).
- **Phase D — bundled Agent Host (`app/host/`):**
  - **Host package + build (D-01):** self-contained Node package; esbuild bundles
    to a single `dist/index.js` with injected deterministic version metadata;
    registers the fake adapter (dev prompts `ping` / `long-running`); reports
    `protocolVersion:1`, `name:"specops.agent-host"`, `hostVersion:"0.1.0"`.
  - **Versioned JSON-RPC protocol (D-02):** newline-delimited JSON-RPC 2.0;
    initialize/version negotiation (incompatible versions fail at init), discover,
    auth, catalogs, sessions, turns, replies, cancel, events, health, shutdown;
    message limits, timeouts, and explicit protocol error codes.
  - **Framing, dispatch, backpressure (D-03):** eager newline framing with
    oversized/malformed rejection and high-water reset; correlation (one response
    per request); turn streams as `session.event` notifications with ack-first
    ordering and pull-based backpressure; cancellation forwards `turn.cancelled`;
    mid-stream rejection synthesizes `turn.failed`; graceful shutdown cancels and
    awaits every active turn. stderr is never parsed as protocol.
  - **Redaction + golden fixtures (D-04):** recursive secret redaction on all
    stderr/error output (secret canaries never cross the diagnostic boundary);
    golden fixtures for valid/malformed/oversized/unknown/timed-out. 48 host
    tests (protocol, framing, dispatch, redaction, real-stdio E2E).
- **Domain notes:** the deterministic `fake` runtime id was added to
  `AgentRuntimeId` as dev infrastructure; the four product runtimes stay
  first-class via `PRODUCT_RUNTIME_IDS` / `productRuntimeDescriptors()`. Two
  unused declarations surfaced by the host's stricter `noUnusedLocals` were
  removed from the phase B session domain.
- Implementation notes: `implementation-notes-phase-c.md`,
  `implementation-notes-phase-d.md`. Phases C and D marked Done in their plan
  docs and the milestone README.
- Out of scope (later phases): Tauri process supervision + process-tree cleanup
  (E), Sessions UI integration + foundation exit (F), real vendor adapters
  (02–05). No persisted data is migrated.

## 2026-08-12 02:20 MSK — Phase B: runtime-neutral session domain and persistence

- Added `app/src/lib/session/`, the runtime-neutral session domain that Phase C
  adapters produce/consume, Phase D/E hosts transport, and Phase F integrates.
  No vendor SDK types appear in any public payload.
- **Ids + binding + lifecycle (B-01):** branded `SpecOpsSessionId` /
  `SpecOpsTurnId` / `NativeSessionId` (unique-symbol brands make SpecOps vs
  native ids un-confusable at the API surface); `AgentRuntimeId`
  (`claude|codex|opencode|cursor`); `AgentNativeBinding` + `AgentSessionRef`
  with model/mode metadata and lifecycle statuses. Runtime binding is
  immutable — `rebindRuntime` returns a new session id rather than mutating.
- **Normalized turns + events (B-02):** `SessionEvent` union
  (text/reasoning/tool/subtask/step/attachment/diff/usage/compaction/
  permission/question/status/turn/diagnostic) + `SessionTranscript` and the
  pure `applySessionEvent` reducer (deterministic replay). Unknown native
  events are preserved as redacted `diagnostic` events; secret redaction
  (bearer/API-key stripping + size bounding) runs before persistence.
- **Persistence schema + codecs (B-03):** versioned `SessionRecord` and
  per-workspace `SessionStoreIndex` around the native binding — no
  provider-prefixed fields. Canonical (key-sorted, redacted) JSON encode;
  decoders fail explicitly on corrupt input (no silent partial decode).
- **Tests (B-04):** 37 domain/codec tests covering every union variant,
  immutable binding, unknown→diagnostic, malformed data, and restart
  round-trips.
- Implementation notes: `specs/ops/01-foundation-agent-host/implementation-notes-phase-b.md`.
- Out of scope (later phases): rewiring the live OpenCode workspace-session
  store/UI onto the new domain (Phase F), host transport (D/E), real adapters
  (C / 02–05). No persisted data is migrated (the new schema is additive).

## 2026-08-11 23:50 MSK — Phase A: remove standalone Chat and dormant Cloud surfaces

**Breaking reset of AI state** (pre-release; no migration per repository policy):
the standalone HTTP Chat (beta) context and the reserved Cloud context are gone.
Old `provider-secrets.json` HTTP-connection keys and any `chat/` thread files
carrying HTTP provider/mode/connection metadata are ignored on load.

- Removed the `chat-http` and `chat-cloud` activity-rail contexts, their
  `WindowContextState` snapshots, restore/snapshot/sanitizer paths, and the Dev
  "Enable Chat (beta)" gate. The activity rail is now `[Notepad] | [Workspace …]`.
- Removed the entire HTTP provider system: provider registry/types/bootstrap,
  the `http` / `debug-chat` / `debug-workspace` providers, OpenAI-compatible +
  SSE adapters, HTTP connection settings, model catalogs, capability checker,
  connection/rail gating, and the `ai/providers/` module tree.
- Removed the chat-modes product (ask/review/raw system prompts, settings, and
  picker) and `ChatThreadMetadata.mode` / `provider` / `connectionId`; assistant
  system-event markers (`provider-switched` / `model-switched`) and
  `message.systemEvent`.
- Simplified the send pipeline to a single workspace path
  (`chatSendPipeline` / `sendChatMessage` / `retryChatTurn`); `chatContextKind`
  and the chat-http composer routing are gone.
- Removed HTTP/API-key settings (`providerSettings`, `providerModelCatalogs`,
  `providerApiKeys`, `chatHttp`, `chatModes`) from `AppSettingsState`,
  `settingsStore`, and the settings UI (Providers / Chat modes / Debug Provider
  Dev tabs). `providerSecretsStore` now stores only the OpenCode server password.
- Preserved reusable workspace-session rendering (transcript primitives,
  `ChatMessageList`, `ChatComposer`, `ToolCard`, reasoning/subtask/step/diff
  parts) and the OpenCode backend path — these feed Phase B's runtime-neutral
  session domain.
- Implementation notes and the checked removal list live in
  `specs/ops/01-foundation-agent-host/implementation-notes-phase-a.md`.

## 2026-08-11 22:35 MSK — Stop project-tree refresh/expand after drag-drop move

- Dragging a file/folder to another folder in the project pane no longer makes
  the tree visibly re-render a second time and expand folders to the moved
  file's new location.
- `projectTreeController`: added a short freshness cooldown
  (`RELOAD_FRESH_COOLDOWN_MS = 500`). `reloadDirectories` now records each
  reloaded directory, and the debounced filesystem-change flush skips dirs
  reloaded within the cooldown — so the in-app move's own targeted reload
  absorbs the redundant ~400ms-later flush emitted by both the post-mutation
  notify and the OS file watcher. Genuinely external changes arriving later
  still reload normally.
- `appShellEffects`: exported `markActiveFileTreeExpandApplied` to seed the
  reveal-active-file effect's dedup key, so its next (debounced) run is a no-op.
- `appShellProjectTreeHandlers` / `AppShellHost`: after a successful drag-drop
  move, the handler seeds that dedup key with the (possibly relocated) active
  document's path, suppressing the auto-reveal expansion that would otherwise
  open folders down to the moved file. No-op when the active document was not
  relocated.
- Tests: added coverage for the cooldown-skip and post-cooldown reload in
  `projectTreeController.test.ts`, and for the suppress key in
  `appShellEffects.test.ts`.

## 2026-08-11 22:28 MSK — Restructure active ops into assignable phase plans

- Kept the product and architecture direction in a standalone
  `specs/ops/roadmap.md`.
- Replaced the six flat task documents with six numbered phase folders based on
  the milestone template: each folder now has a scope/decision `README.md`, an
  `execution-plan.md` index, dependencies, risks, and definition-of-done gates.
- Split implementation into 26 ordered execution plans sized as focused agent
  handoffs: 6 for the foundation and 4 for each later phase.
- Added stable `AS<phase>-<slice>-<task>` task ids, per-plan ownership
  boundaries, acceptance criteria, verification, and next-plan handoff gates.
- Updated the ops allowlist for recursive phase folders and corrected roadmap
  release/historical references to the new `01`–`06` numbering.

## 2026-08-11 22:10 MSK — Split and clean the specs archive

- Archived the previous changelog as
  `specs/archive/changelog-pre-08-26.md`; this file starts the new changelog.
- Rebuilt `specs/ops` around the unified Sessions roadmap only: `00` is the
  product/architecture overview and tasks `01`–`06` are numbered in required
  implementation order.
- Moved 49 completed legacy ops documents to `specs/archive/ops-done`.
- Moved 9 cancelled, superseded, or unscheduled ops documents to
  `specs/archive/ops-postponed`.
- Updated source-code references to completed phase-3.5 specs after their move.
- Narrowly allowlisted the new active ops files and the three new archive paths
  so the cleanup remains represented in version control.
- Removed 25 archived documents dated before 2026-06-01. Documents dated June
  2026 or later were retained.
