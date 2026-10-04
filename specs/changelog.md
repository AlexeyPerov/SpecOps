# Changelog

## 2026-10-04 20:05 MSK — Add isolated second-runtime host bootstrap

- Implemented AS04-A source ownership/profile/bootstrap: exact host SDK/runtime 1.17.4 and reproducible host lockfile, packaged executable propagation, isolated native homes/config/provider auth, host-only loopback password/port, explicit external endpoint ownership and finite core/extension ledger.
- Added a default host / explicit legacy parity process-start gate, bounded connection/version probes, safe profile snapshots and stale-response rejection, native auth persistence/logout/restart, private credential storage and observed descendant retirement. Core session/events remain the next plan; legacy files remain until cutover.
- Validation: 125 host tests passed (one ordinary opt-in skip), 8 explicit bundled-native bootstrap tests passed without account credentials, host/frontend checks and host build passed, 17 Rust host tests passed. Upstream installed/account baseline, paid-provider inference, installed owner switching, platform packaging and immediate descendant-exit race remain open. No data migration or compatibility shim.

## 2026-10-04 17:49 MSK — Harden experimental native faults and credential boundaries

- Implemented AS02-D source fault/security closure: malformed/oversized/crashed native fixture retirement, bounded ignored cancel, profile-local observed descendant cleanup preserving the supervisor group, selected logout credential cleanup and safe direct auth results.
- Masked supported secret shapes in native text/reasoning/tool events and hydrated history without truncating benign output. Streaming retains split credential fragments across unrelated item completions; cumulative state bounds hold even with draining consumers.
- Verified actual bundled-host death with two active production-client native streams and a pending approval, retaining bindings/history without replay. Recorded setup/recovery procedures and a blocked AS08-A selected-scope matrix; immediate descendant spawn/crash race, human account-A/B and installed AS03-A/B remain open. Default-off experimental legacy coding stays unaccepted as baseline.
- Validation: 118 host, 3,238 frontend and 17 Rust Agent Host tests; host/frontend checks and production builds passed. Native contracts unchanged. No live account credentials/default auth files read, installed acceptance, migration or compatibility shim.

## 2026-10-04 17:32 MSK — Add profile recovery, optional settings and authoritative native history

- Implemented AS02-C supported source scope: optional neutral session configuration descriptors replace runtime-specific common-UI branches, with model-specific effort defaults, separate sandbox/approval/collaboration scope and validated session overrides. Profile config remains native-owned; the persisted experimental protocol gate defaults off.
- Added per-profile/account/limit sparse usage merges, actionable quota/auth-expiry/offline/retry states, explicit backend-authorized quota recovery and isolated logout/session auth-required marking. Supervised host epoch plus child generation prevent stale auth state after whole-host replacement; old-host account replies are rejected.
- Reconciled full materialized legacy native history by stable turn/item IDs, terminal-first deduplication and retained interrupted partial work. Production persistence reconstructs divergent/duplicate/corrupt caches, preserves readable local metadata/lineage, retains missing-native-thread records and never silently replays prompts. Sparse/paginated history and unavailable native management panels remain explicit pinned-runtime deferrals.
- Recorded the pinned execution/display/configuration ledger and reproducible 199-file/46-root contracts. Validation: 102 host, 3,237 frontend and 17 Rust Agent Host tests passed; host/frontend checks and both production builds passed. Real account-B inference/account-A preservation, native extension/instruction smoke, whole-host UI recovery and installed readiness remain external gates. No persisted-data migration or compatibility shim.

## 2026-10-04 17:01 MSK — Add native coding turns and minimum thread resume

- Implemented AS02-B source thread start/read/resume, deterministic native text/reasoning/tools/file/usage events, stable native IDs/generation correlation, single-terminal streams, native interrupt and selected-child loss settlement.
- Added correlated command/file approvals and supported native questions with explicit allow/deny/answer/cancel/deadline handling, late/stale reply rejection and prompt visibility across remount. Frontend stream observation settles waiting UI on terminal/loss and cancels/disposes bounded producers.
- Persisted distinct model/effort/collaboration/sandbox/approval settings and write capability through the production pipeline; fresh app/host fixtures hydrate completed native history and continue the same thread without replay or duplicate messages.
- Verified the official pinned npm distribution: default paginated history lacks required hydration support. Added a default-off persisted profile experimental checkbox and blocked coding before work without opt-in; opted sessions use explicitly selected legacy history. Recorded actual no-account legacy marker/read/resume evidence and deterministic 188-file/44-root generated contracts.
- Validation: 94 host tests and 3,229 frontend tests passed; host/frontend checks and production builds passed. Native process/shared-contract fixtures, actual dispatcher/client/pipeline/disk restart and approval-child-loss integration, remount/abort/overflow/disposal UI checks passed. Authenticated coding/account preservation, whole supervised-host smoke and installed readiness remain explicit external gates. No data migration or compatibility shim.

## 2026-10-04 16:28 MSK — Add isolated Codex connection and authentication

- Implemented AS02-A source control plane: pinned 0.160.0 app-server handshake/schemas, bounded profile child transport/restart/generations, official account read/browser/device/API-key login/cancel/logout, native creation shell and model discovery. Native turns/resume remain the next execution plan.
- Added private app-data profile homes, explicit file credential storage, controlled inherited authentication/provider environment, permissions and symlink checks, secret-safe auth updates and host-only browser/device/API-key handling. Default desktop credentials are never copied.
- Added neutral Sessions enablement and runtime/profile creation/selection, ensure-start catalog recovery, immutable profile-aware bindings and actual draft/index/session persistence; runtime/profile namespaces separate equal native IDs.
- Verified the actual pinned binary without login in a temporary isolated home; required initialization/account/control/catalog methods passed and contract regeneration was byte-identical. Recorded setup/distribution/support evidence and kept real account-B sign-in plus installed acceptance explicitly pending.
- Validation: 3,222 frontend tests, 73 host tests and 16 Agent Host Rust tests passed; frontend/host type checks and production builds passed. No data migration or compatibility shim. Existing unrelated Rust formatting differences/warning and canvas-stub notices remain.

## 2026-10-04 15:54 MSK — Stabilize foundation persistence, transport and supervision

- Implemented AS01-S-01–05: full production binding/mode/runtime-settings persistence, per-session debounce and serialized index writes; native sends await binding storage. Resume rejects incompatible runtime/native IDs explicitly.
- Moved supervisor stdin writes to a bounded background queue, serialized lifecycle operations, enforced request deadlines, repaired cooperative shutdown and generation-safe process-group cleanup. Event/framing loss retires the generation; untrusted stderr content is excluded from application logs.
- Bounded host framing/output/dispatch and frontend stream queues; added stateful UTF-8 decoding, real response backpressure, bounded cancel/drain, broken-output settlement, listener/status/generation recovery and secret-safe error/diagnostic output.
- Strengthened shared adapter contracts with complete iterator drain, mandatory fault/capability fixtures and fresh-instance/process resume. Fixed terminal replay, incremental usage totals, subtask terminal events, catalog extension ownership, target binding descriptors and strict codec round-trips.
- Accepted source-checkout macOS scope; Windows host launch is explicitly disabled until tree cleanup is implemented. Linux/installed packaging and native creation/catalog gates remain assigned downstream. Added the full Critical/Major disposition ledger, support bounds, setup notes and updated plan/roadmap statuses. No persisted-data migration or compatibility shim.
- Validation: 3,217 frontend tests, 61 host tests and 97 Rust tests passed (Rust serial); frontend/host type checks and production build passed. Process fixtures cover unread stdin, ignored shutdown/cancel, concurrent starts, host crash and TERM-resistant descendants. Existing canvas-stub notices, one unrelated Rust test warning and the same two pre-existing Markdown-link issues remain.

## 2026-10-04 14:53 MSK — Reorder operations folders and archive completed records

- Renumbered the active queue: 01 foundation stabilization, 02 Codex, 03 early preview delivery, 04 OpenCode core, 05 Claude, 06 handoff/native extensions, 07 Cursor and 08 recurring release gates.
- Split early activity/packaging, later handoff/OpenCode extensions/Codex profiles and release acceptance into their corresponding ordered directories; renamed phase files and active task IDs to match.
- Moved implemented foundation A–F, implementation notes and completed review/audit artifacts into `specs/ops/done`. Historical task IDs are preserved; unresolved acceptance remains assigned to active plans.
- Added active/done navigation and updated roadmap, scopes, indexes, dependencies and links, including references in historical changelog entries.
- Validation: all 22 active phases and 98 tasks retain their acceptance criteria; active prefixes and local links verified. Repository-wide Markdown checking retains the same two pre-existing issues. Runtime code and credentials unchanged.

## 2026-10-04 14:38 MSK — Adopt Codex-first operations composition and delivery order

- Rewrote the active roadmap and all milestone scope/index/phase plans around foundation stabilization, isolated Codex accounts, usable installed Codex delivery, OpenCode core, Claude, later handoff/native extensions and Cursor.
- Added phase AS01-S for reopened production persistence, bounded supervision/transport, failed-stream settlement, redaction and strengthened acceptance evidence; preserved A–F implementation history with explicit historical status.
- Added profile identity, isolated native auth/config homes, profile-scoped routing and control-plane events throughout runtime plans. Codex A–D now accept the separate-desktop-account scenario without a Claude prerequisite; later E covers simultaneous accounts inside SpecOps.
- Moved shared activity and host/Node packaging/diagnostics/recovery to independent early AS06-B/C gates; defined repeatable selected-runtime/platform release acceptance without requiring all adapters or handoff.
- Changed OpenCode order to A → B → D core cutover, with C native extensions later; updated Claude/Cursor auth-policy, native capability/configuration and installed-asset verification tasks.
- Marked the audit proposal adopted and linked historical evidence to active gates. No runtime implementation or credentials changed.
- Validation: 22 active phase plans, 98 unique tasks with acceptance, 234 local operations-document links and an acyclic default dependency graph verified; whitespace checks passed. Repository-wide Markdown check retains the same two pre-existing issues outside these changes. Runtime tests were not repeated for this documentation-only revision.

## 2026-10-04 14:15 MSK — Audit agent-runtime tasks and propose Codex-first delivery

- Added an implementation audit of operations milestones 01–06, separating the fake-runtime foundation, acceptance gaps, legacy integration code and missing production adapters.
- Recorded verified persistence, supervision, stream-failure, redaction, catalog/creation UX, contract-test and packaging gaps; proposed bounded stabilization tasks.
- Proposed isolated Codex connection profiles for an account separate from the desktop app, with profile-scoped authentication, native history, process routing and acceptance checks.
- Added an alternative delivery sequence prioritizing a usable Codex preview and moving recovery, packaging and basic activity visibility ahead of additional adapters and handoff. Linked the review from the roadmap and milestone scope documents; implementation statuses are not promoted by this proposal.
- Validation: 115 targeted frontend/domain tests in 13 files and 48 Agent Host tests in five files passed. No runtime code or account credentials changed; real-account, full Rust and installed-build verification remain outside this audit.

## 2026-10-04 14:03 MSK — Resolve integration merge conflicts

- Combined the session architecture with current appearance settings, project-tree actions, favorites, preview tabs and compact secondary windows.
- Preserved project search cancellation, progress and scanned/unreadable counts alongside stable ordering and oversized-file reporting.
- Unified file-drop listeners so context targeting and the visible drop overlay share the same opener and large-file bypass; retained preview-tab handling for ordinary file opens.
- Removed obsolete chat-context checks and updated test fixtures to the current state and event contracts. Preserved file-icon persistence coverage after removing the obsolete settings test suite.
- Validation: 3,198 frontend tests, seven release-helper tests and 94 Rust tests passed (Rust tests run serially after a port-allocation race); type checking reported zero errors/warnings; production build passed. The documentation link check reports two existing broken links.

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
[`specs/ops/done/01-foundation-agent-host/review-issues-1.md`](ops/done/01-foundation-agent-host/review-issues-1.md).
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
- Implementation notes: `specs/ops/done/01-foundation-agent-host/implementation-notes-phase-b.md`.
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
  `specs/ops/done/01-foundation-agent-host/implementation-notes-phase-a.md`.
## 2026-10-04 12:48 MSK — Keep the local installer available

- On macOS, `build --local` now mounts and opens the finished DMG after a
  successful build. Its Finder window remains available until manually closed
  or ejected, after the temporary packaging window disappears.
- Uses only installer paths reported by the current build, including custom
  targets and paths with spaces; app-only and failed builds do not open old DMGs.
  A mount failure reports the installer path without failing the completed build.
- Validation: release helper tests cover installer opening, argument forwarding,
  app-only builds, build failures and mount failures (7 tests passed). A real
  local build succeeded and mounted the finished installer at `/Volumes/SpecOps`.

## 2026-10-04 12:47 MSK — Fix collection annotations in component builds

- Reused fresh empty-set helpers in editor pane and project search effects,
  preventing orphaned pure annotations when Svelte removes effects from the
  server build and eliminating the associated sourcemap warnings.
- Applied the same fix to the project tree context menu's default favorites
  set, removing its client-build annotation warning; clarified the collection
  helper's use for effects as well as prop defaults.
- Validation: production build passed without annotation or sourcemap warnings;
  Svelte check passed with zero errors and warnings; all eight editor tab
  keep-alive tests passed.

## 2026-10-04 12:38 MSK — Release 0.3.0

- Bumped application version from 0.2.0 to 0.3.0.

## 2026-10-04 12:35 MSK — Release helper commands

- Added `node scripts/release.mjs bump [patch|minor|major|X.Y.Z]` to
  synchronize application versions across npm, Tauri, Cargo and lockfiles,
  record the version change here and commit it on `master`.
- Added `build` to push `master` and its annotated version tag atomically,
  triggering the existing GitHub installer workflow, and `build --local`
  to run the desktop build with optional Tauri arguments.
- Release commands require a clean checkout, validate synchronized versions
  and refuse duplicate published tags, conflicting local tags and a checkout
  that does not include remote `master`. Documented usage and failure recovery.
- Validation: six isolated Git integration tests cover version changes,
  commits, dirty/staged changes, version mismatch, tag publication and remote
  divergence; added these tests to the cross-platform CI workflow. Local
  build argument forwarding passed. Markdown link checking still reports two
  existing broken links outside the changed documentation.

## 2026-10-04 12:22 MSK — Project tree navigation, Git colors and favorites

- Added a tree actions menu with Expand one level and Collapse all. Expansion
  opens the first closed level in each visible branch; collapse clears the
  persisted expansion set while retaining cached directory listings.
- Highlighted pending files and their ancestor folders in cyan, including
  changes inside closed branches. Kept change badges and added a distinct
  conflict color and `!` badge for unmerged Git entries.
- Added a collapsible Favorites section above the tree, sorted alphabetically
  with relative paths and yellow stars. Files open directly; folders reveal
  their location in the tree. Context menus add or remove favorites.
- Persisted favorites per project in shared application storage, with a
  dedicated cross-window write lock and change notifications. Favorites follow
  app-initiated renames and moves and are removed after deletion. Missing
  entries are hidden when favorites reload, including tree refreshes.
- Validation: full suite passed (3515 tests); Svelte check reported zero errors
  and warnings; production build passed. Added coverage for favorites storage,
  concurrent updates and notifications, relocation/deletion, tree actions,
  ancestor highlighting and all unmerged Git status codes.

## 2026-10-03 23:12 MSK — Complete theme appearance and expanded palettes

- Expanded the catalog from 18 to 43 themes, with 10 light options. Added
  familiar editor palettes and distinct CRT, DOS, LCD, paper, neon and drawing
  styles. A single catalog now drives selection, resolution, cycling and
  persistence; curated themes no longer disappear or fall back on restart.
- Added Palette, Typography, Layout, Effects and Preview sections with search,
  collection filters, the current theme name and isolated live previews.
- Added seven font choices, including five bundled families for offline use.
  Interface, chat and code fonts are independent; typography controls include
  sizes, line heights, letter spacing and code ligatures. Retro Latin glyphs
  use a readable size adjustment and other scripts fall back to a bundled
  monospace font.
- Added density, corners, shadows, border contrast, accent and file icon
  preferences, plus bar/block/underline editor cursors. Personal overrides
  survive palette changes; applying a full style resets overrides and restores
  custom saved sizes. Entire appearances can be saved as custom themes or
  updated in place, including their palette, style and text sizes.
- Added adjustable text glow, scanlines, screen-edge shading and paper texture.
  Optional gentle CRT shimmer defaults off and respects reduced motion.
  Effects do not capture input and are removed from printed output. Theme
  changes clear stale accents, selection overrides, effects and cursor styles.
- Improved preset text/comment/hidden-file contrast on both main surfaces and
  made range controls follow the active palette. Editors remeasure on font and
  appearance changes; zoomed editors follow the selected base size and the
  virtual project tree recalculates its row pitch after density changes.
- Fixed custom theme activation in manual mode and fallback when deleting the
  active custom theme. Saved theme styles and personal overrides are validated
  and persisted without introducing data migrations.
- Validation: 3507 tests passed; Svelte check reported zero errors/warnings;
  production build passed. Browser visual checks covered light typography,
  CRT rendering with Latin/Cyrillic, personal font priority and full-style
  application. Screenshots saved in `screenshots/appearance-typography.jpg`
  and `screenshots/appearance-crt.jpg`.

## 2026-10-03 22:37 MSK — Appearance setting previews and layout

- Added a live plain-text sample below Decorate plaintext symbols. Its
  punctuation follows the toggle and uses the editor's symbol color and opacity.
- Placed file icon samples immediately after their labels, with wrapping on
  narrow panes. Moved Mode directly above theme selection and sized its
  segmented control to its contents.

## 2026-10-01 16:02 MSK — Theme preview grid

- Replaced theme selection rows with a responsive grid of cards showing a
  text and syntax sample beside a miniature project tree, with names below.
- Preview palettes are isolated per card, including derived colors, gradients,
  light/dark file icon colors and live custom-theme edits. Selection has a
  border, checkmark and keyboard focus; Duplicate remains a separate action.
- Preserved Manual selection and independent Light/Dark choices in Auto.
  Verified selection, duplication, custom gradients and responsive rendering.

## 2026-10-01 14:57 MSK — Selectable file icon colors

- Added Color and Monochrome file icon choices with sample symbols in Themes.
  The selection applies immediately to the project tree and new-file drafts,
  persists in app settings, and defaults to Color.
- Preserved the existing symbol shapes in both modes. Replaced `light-dark()`
  icon colors with explicit light/dark palette variables so colored symbols
  do not depend on support for that CSS function in the desktop WebView.
- Covered appearance switching, settings persistence and draft rendering.

## 2026-10-01 14:37 MSK — File symbols and compact folder chevrons

- Added 45 original SVG file symbols with 170 extension rules and filename
  overrides for documentation, Git files, configuration and build files.
  The set covers source code, media and game resources, including scenes,
  prefabs, materials, shaders, models, animation and metadata. Unknown types
  retain a generic file symbol. Colors adapt to light and dark appearance.
- Project tree folders now show a thin rotating chevron without a folder icon;
  files show a single colored symbol aligned with the folder chevrons. Empty
  folders reserve the same space without an expansion affordance. New-file
  draft symbols update as the filename is typed.
- Added classification and tree interaction coverage, including special-name
  priority, compound extensions, empty folders and draft extension changes.

## 2026-09-28 14:11 MSK — File catalog stays current for background workspaces

- Folders created in a workspace while another workspace was active never
  showed up under the project panel's `.md` filter (or in Quick Open) after
  switching back. The watcher covers every open workspace, but its events
  reached only the active workspace's file catalog, and returning to a
  workspace reuses its cached catalog without re-enumerating. Watcher events
  now go to every retained catalog; each ignores paths outside its own root.
- The project panel's Refresh button now rebuilds the file catalog as well as
  the tree, so a stale `.md` filter can be recovered by hand.

## 2026-09-27 12:08 MSK — `.md` filter keeps nested Markdown files

- The project panel's `.md` filter hid every folder whenever the workspace file
  list behind it had not been built yet, so only the Markdown files in the root
  stayed visible. The list is now reported as "unknown" until the first
  enumeration completes, and while it is unknown the filter keeps every folder
  (files are still narrowed to `.md`). Once the list is in, only folders with a
  Markdown file somewhere below them remain. Folder matching compares
  case-folded paths.
- Switching workspaces with the filter on now starts enumerating the new
  workspace as well; previously only toggling the button did.
- A watcher-driven catalog rebuild no longer cancels an enumeration that is
  still running. On a large or busy workspace a steady trickle of file events
  could restart it indefinitely, so the catalog (and with it the `.md` filter
  and Quick Open) never became ready. The rebuild now runs once, right after
  the current enumeration finishes.

## 2026-09-22 17:46 MSK — Draggable editor text column

- The blank strip between the line-number gutter and the first character is
  half of what the pane has spare around the centred text column, and it was
  fixed at whatever `--editor-text-max-width` said (1200px). Hovering a text
  editor now reveals a thin rule on the column's left edge; dragging it resizes
  the column, and because the column stays centred, one pixel of pointer travel
  moves the edge by one and changes the width by two. Double-clicking the rule
  hands the column back to the app default.
- The width is stored per document (`DocumentState.textColumnWidthPx`,
  alongside `scrollTop` and `markdownViewMode`), so each tab keeps its own and
  the value survives a session restore. `null` means "use the default".
- The drag is clamped: never below 240px, and never past the space the pane
  actually has (measured as the column plus both margins, so the gutter and the
  minimap are accounted for without querying them). At full width the handle
  stops flush with the gutter's right edge instead of straddling it, so it
  cannot eat clicks on the line numbers, and it is hidden entirely when an
  unwrapped long line has scrolled the column's edge behind the sticky gutter.

## 2026-09-22 17:06 MSK — Notepad rail card, Open in New Window, project-tree refresh fixes

- The expanded activity rail's Notepad card no longer prints a "Notepad"
  heading — the avatar icon already names it. Its labels start at the top of
  the rail, and it lists up to three of the most recently opened Notepad files
  (previously one) as a vertical list instead of a wrapped stat row. The card's
  64px minimum height is gone, so it grows with the list rather than reserving
  space for it.
- Added **Open in New Window** to the file-tab context menu. The file moves to a
  freshly created window rather than being duplicated: a path may be open in
  exactly one window (`openFileRegistry` owns that invariant, and two windows
  editing one buffer would race on save), so the source tab closes once the new
  window has adopted it. A dirty tab is prompted for first and a failed transfer
  leaves the tab in place. The entry is enabled only for Notepad tabs, matching
  the existing tab drag-out policy. `moveTabToNewWindow` now raises the new
  window again after the transfer completes, so it ends up in front with the
  file already open.
- Fixed the project panel not reflecting changes — neither the user's own moves,
  creates, renames and deletes nor external ones. `projectTreeController` mixed
  two path forms: `childrenByPath` / `expandedPaths` are keyed exactly as the
  tree rows are, but the reload paths keyed them by the case-folded comparison
  form. On macOS and Windows those differ for any path with an uppercase
  segment — with `/Users/...`, every path — so:
  - `directoriesToRefreshForChange` matched a folded parent against the raw
    expanded set, found nothing, and dropped the change;
  - `reloadDirectories` stored fresh listings under folded keys that no row
    reads, and rebuilt root rows from a folded root, re-spelling every row path;
  - `expandedAncestorPathsForFile` returned folded ancestors, so revealing the
    active file expanded folders the tree could not match.
  Each of these now folds only for comparison and keeps the tree's own spelling
  for tree state.
- `reloadDirectories` also drops the shared directory-listing cache for the
  directories it is about to re-read. Without that it re-read the very listing
  the change had invalidated, concluded nothing had moved, and — having marked
  those directories fresh — suppressed the watcher flush that would have
  corrected it.
- Expanding a folder whose children are already in memory now re-lists it
  quietly in the background and applies the result only if it differs. A
  collapsed folder is not covered by the focus/workspace-switch revalidation
  passes, so its cached children could be arbitrarily old.
- Tests: `projectTreeCaseFolding.test.ts` covers the four cases above with the
  platform mocked as case-insensitive (the default test platform is
  case-sensitive, which is why none of this was caught); tab-menu gating covered
  in `tabContextMenuActions.test.ts`.
- Verification: `npm run check`, all 3,423 Vitest tests, and `npm run build`.

## 2026-09-20 — Copy workspace root path

- Added **Copy Path** to the activity-rail workspace context menu. The action
  copies the selected workspace's root-folder path to the clipboard without
  switching the active workspace.

## 2026-09-20 — Hide Markdown view controls for empty and non-Markdown files

- The edit/split/preview control is now rendered only for non-empty Markdown
  documents. Empty Markdown documents stay in edit mode so typing the first
  character makes the view controls available, while non-Markdown tabs no
  longer expose Markdown-only actions.

## 2026-09-14 14:40 MSK — Live project-tree refresh, preview tabs, path git log

- The project tree now revalidates itself when the window regains focus, when a
  workspace is switched to, and when the panel is expanded again — not only on
  manual refresh and startup. `projectTreeController.revalidateProjectTree`
  re-lists the root plus the currently expanded folders with bounded
  concurrency, compares each listing against the one on screen, and applies (and
  publishes) only real differences, so an unchanged tree costs a few directory
  reads and zero re-renders. Passes are throttled (2 s), de-duplicated while one
  is in flight, skipped while the panel is collapsed, and skipped right after a
  cold load, which already read from disk. The shared directory cache is
  invalidated for exactly the directories a pass is about to re-read.
- Manual refresh no longer rebuilds the tree. It runs the same pass with
  `force`, so `childrenByPath` is never emptied — the rows, the expansion, and
  the scroll position all survive a refresh.
- The project panel no longer jumps after a delete, move, or refresh: the
  reveal-active-file effect now runs only when the active file actually changes
  (retrying across tree updates until its row exists) instead of on every tree
  publish, and a scroll offset the browser clamped away while the list was
  briefly shorter is restored.
- Project-pane spacing moved into `tokens.css` as `--project-tree-*` (padding,
  per-depth indent, row padding, icon gap, row height, row spacing). The indent
  went from 4px to 10px. `ProjectTreeView` reads the row height and row spacing
  back at runtime for its virtualization math, so those values can be retuned in
  one place with no code change.
- Single-clicking a file in the project tree now opens it as a **transient
  (preview) tab**, rendered in italics: the next single click reuses the slot and
  closes the previous preview instead of stacking tabs. A preview is promoted to
  an ordinary tab as soon as the user acts on the file — an edit, a user-driven
  caret or selection move, a double click on the row or the tab, dragging the
  tab, or reopening the file through an explicit route (Quick Open, a menu, a
  pane drop). A preview holding unsaved edits or a pin is promoted rather than
  closed, and tabs restored from a session snapshot are never transient.
- Added **Git Log…** to the project-tree context menu (files and folders) and
  the file-tab context menu. It opens a popup at the click point listing the
  commits that touch that path (subject, short sha, author, relative date) with
  "Load more"; picking a commit opens Version Control on it, including when that
  view is already mounted. `queryCommits` accepts `paths` (literal pathspecs)
  and `follow`, and the popup runs with the `versionControl` git scope because
  it is user-initiated.
- The editor text column now has flexible side margins: it is centred once the
  editor is wider than `--editor-text-max-width` (1200px) and hugs the gutter
  below that. Long lines still scroll horizontally, and `none` restores the
  previous always-left-aligned layout.
- Verification: `npm run check`, all 3,416 Vitest tests, and `npm run build`.

## 2026-09-13 21:47 MSK — Refine secondary windows, project files, search, and drag-drop

- Secondary windows now complete confirmed closes with a direct window teardown,
  avoiding the intercepted close-request loop that left individual windows open.
  A secondary window showing Notepad now keeps only the title area, tab strip,
  and editor; workspace rails, panels, Markdown controls, and the status/bottom
  area are omitted.
- CodeMirror selection styling now overrides its focused-selection rule, keeping
  selected text legible in dark themes. Markdown edit/split/preview controls are
  limited to actual Markdown documents and remain available for empty `.md`
  files, while no-document and non-Markdown views do not show them.
- Project search now preserves whitespace queries, cancels stale results when
  query options change, produces stable result ordering, reports unreadable or
  oversized skipped files, and prevents Replace All from acting on an obsolete
  result set. Project replacement now evaluates blocked directories relative to
  the workspace root rather than rejecting safe workspaces under dot-prefixed
  ancestor paths.
- Every project-tree context menu can start file or folder creation. The project
  header has a root-create `+` menu and the blank area below the tree opens the
  same root menu. Creation uses an in-tree, focused name placeholder: Enter
  commits to disk, while Escape or focus loss cancels without creating anything.
- Added a `.md` project-panel filter that loads the workspace catalog and shows
  only Markdown files plus their ancestor folders.
- Files from the project tree or the operating system can be dropped onto the
  Notepad or workspace rail icons to open/move the tab in that context. Chat
  contexts are deliberately excluded and valid targets show a hover affordance.
- Cleared the full type-check backlog in affected legacy tests and host API
  declarations. Stabilized platform-specific Git null-device handling and
  Markdown-outline reactive refreshes found by the full test run.
- Verification: `npm run check`, all 3,391 Vitest tests, and `npm run build`.

## 2026-08-18 16:11 MSK — Stop lowercasing paths in Copy Path / Copy Relative Path

- Copy Path and Copy Relative Path (tab menu and project-tree menu) no longer
  return lowercased strings on macOS/Windows: case folding now happens only in
  comparison keys, never in paths stored, displayed, or copied.
- `workspacePaths.workspaceRelativePath`: containment is still decided on the
  case-folded comparison keys, but the returned slice now comes from the
  case-preserving normalized form, so the copied relative path keeps the real
  on-disk casing.
- `workspaceTraversal`: `normalizeWorkspaceRoot` now preserves casing (it feeds
  the traversal root and display forms); `relativePathFromRoot` compares
  case-insensitively but slices the case-preserving path, so picker/search
  relative paths keep their casing too.
- `workspaceFileCatalog`: entries keep the original casing in
  `absolutePath`/`relativePath`/`basename`/`directory`; only the dedup `key` is
  case-folded. Files opened via Quick Open / project search therefore store the
  real path on the document, which is what Copy Path copies. Watcher-driven
  incremental `create` adds take the raw watcher path so they keep casing as
  well; root-containment checks inside the catalog now fold both sides.
- `openFileGate.requestOpenPath` returns the original (un-folded) path for
  `redirected`/`existing` results, so recents and "Switched to…" notifications
  keep the real casing; `openActivePath` reports large-file
  `pending_confirm` paths without folding.
- Tests: casing-preservation cases added in `workspacePaths.test.ts`,
  `workspaceTraversal.test.ts`, and `workspaceFileCatalog.test.ts`.

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
