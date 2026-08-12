# Changelog

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
