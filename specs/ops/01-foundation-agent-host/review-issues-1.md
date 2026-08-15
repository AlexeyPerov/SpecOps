# 01 — Review issues (round 1)

**Date:** 2026-08-15
**Scope:** milestone 01 phases A–F implementation review (session domain, adapter
contract + fake runtime, Agent Host package, Tauri supervision, frontend Sessions
integration) against the phase plans in this folder.
**Method:** four deep-dive review passes over
`app/src/lib/session/`, `app/host/`, `app/src-tauri/src/agent_host.rs`, and the
frontend send pipeline / stores / UI, with spot-verification of every Critical
and headline Major finding against the source.

**Test status at review time:** domain/adapter 75/75, host package 48/48,
Rust supervision 13/13, phase-F frontend tests 152/152 — all green. The full
frontend suite has 5 failures outside milestone 01 (gitService ×3 sandbox/`NUL`
dependent, MarkdownOutlinePanel Svelte effect error, workspaceFileCatalog
integration ×1) — pre-existing, not introduced by this milestone.

## Completion verdict

Milestone 01 is marked Done and the fake-runtime happy path does work end to
end: create → stream → reply → cancel → restart → restore renders through the
common UI, and the WebView→Tauri→host boundary is genuinely enforced. However,
**several acceptance criteria are only partially met** (table at the end), and
three Critical plus ~29 Major issues were found. The issues cluster exactly
where the acceptance criteria pointed: hostile/dying peers, shutdown/recovery
paths, persistence of bindings, and the strength of the shared contract suite.

Recommendation: keep the milestone functionally closed but treat
[R1 fix list](#recommended-fix-ordering) as a stabilization backlog that must
land before phase 02's own exit gates (real credentials, real restart recovery,
real streaming) can be trusted — several phase-02 acceptance checks would fail
today against the current foundation (noted per issue).

---

## Critical

### R1-C1 — Runtime bindings are never persisted; restart recovery is fictional

- **Files:** `app/src/lib/services/chatPersistence.ts:117-130`,
  `app/src/lib/services/chatPersistenceCodec.ts:467-476`,
  `app/src/lib/ai/chatSendPipeline.ts:324-369`
- The only production writer of the workspace sessions index
  (`persistSessionThreadSnapshot → syncSessionIndexEntryForThread`) upserts
  `{ id, title, lastUsedAt }` only, and `upsertSessionIndexEntry` **replaces**
  the previous entry — `runtimeId` / `nativeSessionId` / `modelId` /
  `shareUrl` / `parentSessionId` are stripped on every debounced save.
  `setSessionLink` mutates memory only; `scheduleWorkspaceSessionsIndexPersistence`
  has zero callers (verified).
- **Consequence:** after restart, every restored session mints a *new* native
  session on first send; `session.resume` recovery only works within one app
  run. Phase-02 acceptance "app restart resumes each session independently"
  fails against this foundation.
- **Fix:** persist the full neutral binding (merge with in-memory entry or
  accept a full `SessionIndexEntry`), and add a round-trip test
  persist → disk → load → resume.

### R1-C2 — Blocking stdin write under the supervisor mutex can deadlock the supervisor and app quit

- **File:** `app/src-tauri/src/agent_host.rs:747-761`
- `AgentHostState::request` performs `stdin.write_all().flush()` **while holding
  `self.inner`**. The host reads stdin serially; when it is busy handling one
  slow request (or ≥64 KB of requests are queued), the pipe fills and
  `write_all` blocks forever holding the lock. Every `request`, `status`,
  `stop`/`shutdown`, and app-quit `stop_sync` then blocks on the mutex — one
  wedged host hangs application quit.
- **Fix:** never hold `inner` across pipe I/O — dedicated writer with a bounded
  channel, or a separately-locked `Arc<Mutex<ChildStdin>>` with a poll/timeout
  write.

### R1-C3 — Fire-and-forget turn pump: a stdout write failure crashes the host via unhandled rejection

- **Files:** `app/host/src/dispatch.ts:308,386-396`
- `void this.pumpTurn(...)` attaches no `.catch`. If an event write rejects
  (EPIPE / destroyed stream — e.g. the client closes its read pipe), the
  rejection propagates through the catch block's second `writeEvent` and kills
  the process under Node's default `--unhandled-rejections=throw`.
- **Fix:** `this.pumpTurn(...).catch(...)` with logging + settle, and make the
  synthesized-failure write best-effort.

---

## Major — Agent Host package (phase D)

### R1-M1 — `gracefulShutdown` can wait forever on a hung adapter

`app/host/src/dispatch.ts:426-435` — no bound on awaiting `controller.done`;
a vendor stream that never terminates and ignores `cancel()` blocks shutdown
indefinitely (verified by probe). SIGTERM path (`host.ts:98`) then never exits;
only the Rust supervisor's grace timeout saves it. Race `done` against a bounded
drain timeout, then force-settle.

### R1-M2 — Framing swallows stream errors that arrive while a read is pending

`app/host/src/framing.ts:56-67` — `wake()` has two identical `resolve({done:true})`
branches (dead code proving the intent). An `error` event during a pending
`next()` looks like clean EOF → `stop("stdin closed")` → **exit code 0** with no
diagnostic. Store a rejecter and reject the waiter instead.

### R1-M3 — Multi-byte UTF-8 split across chunks is silently corrupted

`app/host/src/framing.ts:75` — `buffer += chunk.toString("utf8")` decodes each
chunk independently; a code point split at a chunk boundary becomes U+FFFD and
the JSON still parses (verified by probe: emoji split mid-chip corrupted). Split
on `\n` in Buffer space or use `StringDecoder`.

### R1-M4 — No backpressure on two of the four data paths

`app/host/src/framing.ts:35-50` — inbound `queue` is unbounded and
`pause()/resume()` are declared but never called (verified); while the host loop
awaits a slow handler, a fast peer grows memory without bound.
`app/host/src/dispatch.ts:448-468` — responses use `writeRaw` without awaiting
`drain`; a flood of cheap requests against a slow consumer buffers unboundedly.
Only the event stream has real (tested) backpressure, so AS01-D-03 holds only
partially.

### R1-M5 — Adapter error text crosses to the client unredacted

`app/host/src/dispatch.ts:390-396` (synthesized `turn.failed` carries raw
`error.message`) and `app/host/src/errors.ts:38-41` (`toProtocolError` maps raw
message, while the internal-error path redacts — the inconsistency is the bug).
Probe confirmed a `Bearer sk-…` in an adapter exception reaches the WebView and
would be persisted into the transcript. Wrap both with the redactor.

### R1-M6 — Timeouts are declared but never enforced; protocol doc lies

`app/host/src/protocol.ts:48-54` — `DEFAULT_REQUEST_TIMEOUT_MS`,
`INITIALIZE_TIMEOUT_MS`, `MAX_CONCURRENT_TURNS` are imported nowhere;
`TIMEOUT` (-32002) is unreachable. A hung adapter call blocks the sequential
host loop forever. The Rust supervisor's 30 s/10 s timeouts are the only
defense, and the dead constants drift from the live Rust ones. Enforce in
dispatch or delete the constants and document supervisor ownership.

### R1-M7 — Outbound messages bypass the size limit entirely

`app/host/src/dispatch.ts:448-468` — `respond`/`writeNotification` stringify and
write without checking `MAX_MESSAGE_BYTES`; the enforcing helper is used only by
tests. An adapter event > 1 MiB defeats the symmetric inbound limit and desyncs
a compliant peer's framer. Check byte length and truncate/synthesize a
diagnostic.

### R1-M8 — Invalid envelopes carrying an `id` get no response

`app/host/src/dispatch.ts:121-124` — valid JSON that is invalid JSON-RPC
(e.g. missing `method`) is logged and dropped; the peer's promise never settles
(verified by probe), violating the "every request receives exactly one
response" header contract. Reply `-32600` with the recovered id.

### R1-M9 — Build is not reproducible

`app/host/scripts/build.mjs:24` embeds `new Date().toISOString()`; two builds of
identical source produce different SHA-256 (verified). AS01-D-01 "reproducible
build/version metadata" is unmet. Derive the timestamp from `SOURCE_DATE_EPOCH`
or the git commit, not wall clock.

## Major — Tauri supervision (phase E)

### R1-M10 — Cooperative shutdown is dead code; every stop is a hard kill

`app/src-tauri/src/agent_host.rs:938-952` — `shutdown()` sets
`inner.shutting_down = true` and **then** calls `self.request("shutdown", …)`,
but `request()` (lines 730-734) rejects immediately when `shutting_down` is set:
the RPC is never written. `reap_child` (550-564) also sends SIGTERM and SIGKILL
back-to-back with no grace wait. The host implements graceful shutdown on both
channels (SIGTERM handler, `shutdown` RPC) — neither can ever run. Normal app
quit hard-kills hosts and active turns; `SHUTDOWN_GRACE` is never awaited; the
module doc describes behavior that does not exist. Send the request before
setting the flag and wait a bounded grace between TERM and KILL.

### R1-M11 — Concurrent `start` calls can kill each other's host

`app/src-tauri/src/agent_host.rs:912-928` — the initialize-error path calls
`stop_child(force)` without verifying the installed child is still the
generation this call spawned; two overlapping `agent_host_start` invokes can
kill each other's healthy child (both fail, host left down). The Ok path keys on
`health == Starting` instead of the spawn generation. Serialize lifecycle ops or
compare generations before mutating.

### R1-M12 — Grandchildren orphaned on the `refresh_liveness` race

`app/src-tauri/src/agent_host.rs:227-244` — on `try_wait() == Ok(Some(_))` the
child handle is dropped without signaling the process group and without bumping
the generation; the reader's later `mark_exited` then finds `child == None` and
never kills the group. A crashed host's grandchildren survive when a
status/request poll wins the race against reader EOF — the no-orphan guarantee
only holds for the stop path (which is the only path the tests cover).
`kill_process_group_pid(child.id())` before dropping the handle.

### R1-M13 — No process-tree cleanup on Windows

`app/src-tauri/src/agent_host.rs:832-836` — `process_group(0)` is unix-only; no
Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; `child.kill()` terminates
only the leader. Grandchildren survive on Windows while the code claims reaping
on every platform; all tree tests are unix-gated. Add a Job Object or document
Windows as unsupported for the host.

### R1-M14 — Node unresolvable in packaged GUI launches (macOS)

`app/src-tauri/src/agent_host.rs:396-403` — `resolve_node_binary` searches only
`PATH`; Finder/Dock launches inherit `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, which
excludes Homebrew/nvm/volta node, and node is not bundled (`tauri.conf.json`
externalBin lists only `binaries/opencode`). A packaged app reports `NodeMissing`
for most macOS users. Probe well-known locations and/or bundle a node sidecar;
this is also a phase-02 packaging dependency (real adapters cannot ship without
it).

## Major — Session domain and adapter contract (phases B/C)

### R1-M15 — Terminal-exclusivity contract test is tautological

`app/src/lib/session/adapter/adapter.contract.ts:70-79,164-171` — the harness
returns at the first terminal event, so "exactly one terminal event" can never
fail, and trailing events after the terminal are unobservable. A phase-02+
adapter emitting `turn.finished` then `turn.cancelled` passes the suite unchanged
and corrupts transcripts (see R1-M18). Drain to completion and assert the
terminal is unique and last.

### R1-M16 — Shared contract suite is missing spec-mandated coverage

`app/src/lib/session/adapter/adapter.contract.ts` — AS01-C-04 lists
"malformed/unknown events, secret-shaped values, restart, typed errors" as suite
coverage. None are in the shared suite: unknown/malformed handling and the
secret canary live only in fake-local tests, restart is only a `resumeSession`
happy path, and no test asserts any `AdapterError` code (the `errors.ts` header
claims the suite asserts the `cancelled` code — it does not). Phases 02–05 will
not inherit these checks "unchanged". Add factory hooks for error injection, a
diagnostics canary assertion, and a restart path.

### R1-M17 — Fake runtime leaks unredacted payloads into `redactedRaw`

`app/src/lib/session/adapter/fake/fakeRuntimeAdapter.ts:240-251` — the scripted
`diagnostic` branch copies `scripted.raw` verbatim, unlike the `unknown-native` /
`malformed` branches which route through redaction. The fake is the reference
implementation later adapters copy; this is the exact pattern that will leak
`Authorization` headers from vendor diagnostics into transcripts. Apply
`redactForSerialization`.

### R1-M18 — Transcript reducer does not enforce terminal exclusivity

`app/src/lib/session/transcript.ts:277-282` — `turn.finished` after
`turn.failed` silently rewrites status; post-terminal `text.delta` /
`tool.completed` mutate completed turns (`findAssistantTurn` matches any status).
The reducer is the replay source and the only restart-recovery mechanism, so a
buggy adapter silently corrupts persisted transcripts with no diagnostic. Ignore
post-terminal events for a turn except `diagnostic`.

### R1-M19 — `usage.recorded` is last-wins; per-call usage/cost is lost

`app/src/lib/session/transcript.ts:270-276` — prior cost parts are dropped and
`usage`/`cost` are overwritten. Real runtimes report usage per API call within
one turn; an adapter emitting faithful per-step events loses all but the last
one, and the adapter contract documents no cumulative-usage requirement. Sum
usage across events (or append per-step cost parts with a cumulative total) and
document the semantics in `adapter.ts`.

### R1-M20 — Codec performs silent partial decodes on malformed optional fields

`app/src/lib/session/codec.ts` — `usage` is completely unvalidated (`:363`,
`{usage:{input:"lots"}}` decodes); `readOptionalString` coercion silently drops
wrong-typed subtask/step/attachment/diff fields (`:187-211,232,252,364`); a
model object missing `id` decodes as `{id:""}` (`:458-473`); diagnostic `reason`
accepts any string (`:308`). AS01-B-03 requires corrupt records to fail or reset
explicitly. Fail when a present field has the wrong type; validate `usage`
structurally; validate `reason` against the literal set.

### R1-M21 — Redaction patterns miss very common secret shapes

`app/src/lib/session/redact.ts:14-29` — `/^token$/i` does not match
`access_token` / `refresh_token` / `auth_token`; `client_secret` is unmatched;
value patterns miss GitHub PATs (`ghp_…`) and AWS key ids (`AKIA…`) (verified by
execution). OAuth token responses are exactly what phases 02–03 will surface in
diagnostics. Broaden key patterns (`/token$/i`, `/secret$/i`, `/cookie$/i`) and
add vendor-prefix value patterns.

### R1-M22 — No subtask terminal event kinds

`app/src/lib/session/events.ts:106` + `transcript.ts:248-252` — subtasks get only
`subtask.started` (an upsert); completion must be signaled by emitting
`subtask.started` with `status:"completed"`. Claude subagents and OpenCode
agents/threads must reuse this contract; the naming guarantees wrong UI logic
and untestable lifecycle ordering. Add `subtask.completed`/`subtask.failed`.

### R1-M23 — Two competing catalog surfaces on the adapter boundary

`app/src/lib/session/adapter/adapter.ts:197,237-239` vs
`app/src/lib/session/adapter/extensions.ts:31-34` — optional `describeCatalog`
on the mandatory interface **and** a `CatalogExtension` with no
`CAPABILITY_EXTENSION_MAP` entry; an adapter can pass one check and fail the
other. This is the only optional feature placed on the core, contradicting the
extensions design. Remove it from the core now (cheap before phase 02, breaking
after).

### R1-M24 — `rebindRuntime` copies old-runtime capabilities and model/mode onto the new session

`app/src/lib/session/binding.ts:203-205` — after rebinding claude→codex the new
session advertises claude's capability set and a claude model id while its
`runtimeId` says codex; invisible to the type system. Accept (or clear)
capabilities/model/mode explicitly for the target runtime.

### R1-M25 — Codec decode paths are largely untested

`app/src/lib/session/codec.test.ts:23-47` — the fixture transcript contains only
`turn.started`/`text.delta`/`turn.finished`, so reasoning, tool calls, all
part variants, diagnostics, and compaction decoders have zero coverage (happy or
malformed); `step.failed` reducer branch untested. AS01-B-04 "cover every union
variant / restart round-trips" is only partially met.

## Major — Frontend Sessions integration (phase F)

### R1-M26 — Model/mode catalogs cannot load before the first send

`app/src/lib/services/agentHostRuntime.ts:98-124`,
`app/src/lib/components/ChatPanel.svelte:132-142`,
`app/src-tauri/src/agent_host.rs:735-737` — the Rust bridge returns
`notRunning` while the host is down; the only `ensureAgentHostStarted()` call is
in the send path; the ChatPanel catalog effect runs once per `runtimeId` with no
ensure-start and no retry. Fresh draft sessions show "No models" (real error
only in a tooltip), defaults never apply, and the catalog is not reloaded after
the first send starts the host (`runtimeId` doesn't change). The F-02
runtime→model→mode creation flow is broken at the root. Ensure-start inside
`loadSessionCatalogs` and/or re-trigger on host status change.

### R1-M27 — Host death/restart mid-turn leaves the turn stream hung forever

`app/src/lib/session/host/agentHostClient.ts:299-358`,
`app/src/lib/ai/chatSendPipeline.ts:434-525` — `sendTurn` resolves only on a
terminal event for that turn; if the host crashes or is restarted mid-turn, no
terminal arrives, the pipeline's `for await` pends forever, and the subscriber +
generator leak. Local liveness checks only run when an event arrives; user cancel
cannot settle the promise on a dead host. Break the iterator on cancellation and
fail in-flight turns on host-exit/restart transitions.

### R1-M28 — Resume path silently desyncs store vs pipeline when the host refreshes the native ref

`app/src/lib/ai/chatSendPipeline.ts:336-349`, `app/src/lib/stores/…/sessions.ts:420-428`
— the contract allows resume to return a refreshed ref; the pipeline uses the
returned binding for the turn while `setSessionLink` silently rejects the
changed `nativeSessionId` (immutability guard), so every subsequent turn resumes
the stale id again — adapters that rotate ids mint a new native session per
turn. Re-read the store binding after resume or surface a real decision.

### R1-M29 — Session creation has no runtime-selection step; runtime is hardcoded

`app/src/lib/services/agentHostRuntime.ts:30` (`DEFAULT_SESSION_RUNTIME_ID = "fake"`),
`app/src/lib/components/ChatPanel.svelte:125`,
`app/src/lib/ai/chatSendPipeline.ts:354` — F-02's acceptance ("runtime → model
→ mode → optional settings creation flow", "replace runtime switching with 'New
session with…'") is not implemented: the runtime is hardcoded to the fake, there
is no runtime picker and no "New session with…" action. Deferred to phase 02 by
code comment, but the milestone table marks F-02 Done. Track explicitly as
phase-02 scope or reopen F-02.

---

## Minor

### Session domain / adapter

1. `binding.ts:149` — `createdAt` silently defaults to Unix epoch; require it or
   document/inject the clock.
2. `transcript.ts:219-220` — `text.finished` semantics (full text vs last
   chunk) undefined in the behavioral contract; fake emits full text.
3. `binding.ts:235-238` — runtimeId immutability guard is a cast, reachable only
   from JS; no status-transition validation on `updateSessionRef`.
4. `codec.ts:293-306` — `seq` accepts 0/negatives/fractions, `at` any string;
   contract says 1-based integers + ISO timestamps.
5. `ids.ts:91-95` — `reindexSpecOpsSessionIdCounter` is dead; documented
   `sos-turn-{n}` format is bypassed by the host client's `turn-${Date.now()}-…`.
6. `ids.ts:38-49` — ids with leading/trailing whitespace are accepted as valid.
7. `fakeRuntimeAdapter.ts:362-364` — concurrent second turn throws `internal`;
   one-turn-at-a-time semantics undocumented in `adapter.ts`; no dedicated code.
8. `fakeScript.ts:82` + `fakeRuntimeAdapter.ts:419-424` — `FakeTurnOutcome.fail.code`
   is declared but ignored; typed mid-stream errors unscriptable.
9. `fakeRuntimeAdapter.ts:477-479` — fake `restart` is an identity function;
   AS01-C-03 promises restart behavior.
10. `capabilities.ts:11-30` — eight capability ids (`nativePlans`, `hooks`,
    `subagents`, `providerManagement`, `modelManagement`, `cloudExecution`,
    `costReporting`, `rateLimitReporting`) have no extension mapping and pass the
    honesty suite vacuously.
11. `extensions.ts:293-295` — dead empty `if` in `inferCapabilities`.
12. `redact.ts:44-66` / `codec.ts:87-100` — cyclic structures throw `RangeError`
    instead of failing decode explicitly; no depth/seen guard.
13. `session/index.ts:104-109` — barrel omits `asTurnId`; `SessionIdParseError`
    exported from two modules.
14. `errors.ts:10-11` — `AdapterError.cause` may carry secrets; only a comment
    defers redaction to the host. Redact at construction.
15. `events.ts:139` — `tool.completed` accepts `pending`/`running` statuses;
    narrow to terminal statuses.

### Agent Host package

16. `host/src/index.ts:19-22` — fatal handler comment promises redaction; none
    applied (defense-in-depth).
17. `dispatch.ts:212-213` — `initialized = true` set before `describe()` resolves;
    a failed describe leaves the host "initialized".
18. `framing.ts:470-490` — failed write leaves the `drain` listener attached; a
    destroyed stream can leave `writeAwaitingDrain` unsettled forever (compounds
    R1-M1).
19. `dispatch.ts:100` — `maxConcurrentTurns ?? 64` duplicates the dead protocol
    constant; "Too many concurrent turns" reuses `INTERNAL_ERROR`.
20. `protocol.ts:300-322` — `id` type unvalidated (objects echoed); batch arrays
    silently dropped.
21. `host/package.json:13-15` — scripts shell out to `../node_modules/.bin/*`;
    declared devDependencies never installed locally; fresh-clone host setup
    silently depends on the app root.
22. `host.ts:15-16`, `registry.ts:13`, `tsconfig.json:22` — the Node sidecar
    compiles files owned by the SvelteKit app (`src/lib/session/**`); dependency
    direction is inverted; any future `$app/environment` import breaks the host
    build. Extract a shared `session-domain` package.
23. `dispatch.ts:403-412` — synthesized failure stamps `at: new Date(0)`; plus an
    unchecked `as SessionEvent` cast.

### Tauri supervision

24. `agent_host.rs:1032-1046` — `timeout_ms` unvalidated; `u64::MAX` parks the
    condvar forever and leaks the pending entry (reachable from any invoke).
25. `agent_host.rs:1028-1047` — no method allowlist in the bridge; the WebView
    can invoke `shutdown`/`initialize`/internal methods (host-side schema
    validation is the only guard).
26. `agent_host.rs:86-90` — `ProtocolVersionMismatch` never constructed; a
    server's mismatched version in a success response is silently accepted.
27. `agent_host.rs:597-601` — exit detection is stdout-EOF-only; a grandchild
    inheriting stdout keeps the reader alive after a crash; pending requests
    burn full timeouts.
28. `agent_host.rs:867-875` — thread-spawn failure after installing the child
    leaves an unsupervised host running.
29. `agent_host.rs:454,255-263` — `restartCount` is windowed (30 s), reported as
    lifetime; misleading in status UI.
30. `agent_host.rs:598-601` — `ErrorKind::Interrupted` read is treated as death
    → SIGKILL of a healthy host; retry instead.
31. `agent_host.rs:671-673` — a full 256-slot event channel drops *any*
    notification including terminal events; `sendTurn` has no fallback and can
    hang (related R1-M27).
32. No kill-on-drop / `Drop` guard on the child; a Rust panic path orphans the
    host.
33. Crash-loop breaker counts starts, not crashes — five manual restarts in 30 s
    trip `CrashLoop`; there is no auto-restart at all.

### Frontend integration

34. `sessions.ts:191-239` — `SessionBinding.modeId` is dead: never
    read/written/compared; `binding?.modeId` reads are always `undefined`; mode
    survives only via `metadata.selectedModeId`.
35. `agentHostClient.ts:311-315` — `compaction.applied` never reaches the
    pipeline (dropped by the turn filter); `attachment.posted` passes but maps
    to nothing.
36. `ChatPanel.svelte:166-185` — host-health badge polls only on
    generating/workspace changes; stale after restart/crash (no status
    subscription).
37. `SessionCatalogPicker.svelte:55` — mode select hidden for single-mode
    runtimes; the fake exposes one mode, so the model→mode step never renders
    in-product.
38. `chatStore/access.ts:173-193` — provider-named user copy ("OpenCode
    workspace session is ready.") in common store code, beyond the documented
    leftovers.
39. `sendChatMessage.ts:55-63` — the debounced thread write is scheduled before
    the sessions-gate check; a gate failure still persists a phantom user
    message.
40. `agentHostClient.ts:205-207` — a rejected `listen` binding is swallowed;
    `turn.send` then waits forever (related R1-M27).
41. Capabilities are never rendered in the Sessions UI (no `discover()`
    consumer) — F-01 acceptance says "renders … capabilities".

## Nits

- `dispatch.ts:308` comment says "tracked for cancellation/shutdown" — tracking
  does not prevent the unhandled rejection (R1-C3).
- `agent_host.rs:528-531` — dead `kill_process_group(child)` (compiler warning);
  duplicated doc comments at 793-794/939-940; `let app = app;` no-ops; clippy
  `bool_assert_comparison` in tests.
- `agent_host.rs:1304-1320` — "recovery" test restarts into another
  immediately-exiting fixture; never proves a healthy restart.
- `agentHostClient.ts:306,347-349` — `terminalError` assigned never.
- `sessionBinding.test.ts:99-113` — test named "codec round-trip" never
  encodes/decodes.
- `hostTurnReducer.ts:54` — no `seq` dedup in the fold; a replayed event
  double-appends text.
- `hostTurnReducer.ts:127,134` — `toolName:""` for out-of-order
  progress/completed creates empty-named tool records.
- `OverlayHost.svelte:809-830` / `SessionListPanel.svelte` — dead hidden
  session-list overlay still imports `ai/backends/opencodeSessionList`
  (provider-typed props remain in `AppShell.svelte:285,290`).
- `chatPersistenceCodec.ts:13` — common codec imports helpers from
  `ai/backends/wireReaders`.
- `protocol.ts:485` — hardcoded `["once","always","reject"]` duplicates the
  `PermissionReply` union via cast.
- `registry.ts:43-48` — `health()` returns a polymorphic `AdapterHealth |
  AdapterHealth[]`.
- Host protocol shapes are hand-mirrored in `agentHostClient.ts`; add a contract
  test that both sides agree on method names/error codes.
- `codec.test.ts:158-159` — `void asSpecOpsTurnId;` linter silencer.
- `fakeRuntimeAdapter.ts:305-312` — auth failure maps error code into the
  message verbatim.
- `transcript.ts:34-46` — `SessionTurn` mixes readonly and mutable fields.

---

## Acceptance criteria assessment

| Phase | Criterion | Verdict | Key evidence |
| --- | --- | --- | --- |
| A | No UI path to Chat/Cloud; settings/state/persistence purged | **Pass** | Only comment-level remnants; see Minor 38 and Nits (dead overlay glue) |
| B | Deterministic round-trip; corrupt records fail explicitly | **Partial** | Silent partial decodes (R1-M20); decode paths untested (R1-M25) |
| B | Unknown native events representable as diagnostics; no vendor types | **Pass** | Neutral payloads; `toUnknownNativeDiagnostic`; subtask gap R1-M22 |
| C | No optional feature as required no-op; extensions only | **Partial** | `describeCatalog` on core (R1-M23); 8 unmapped capability ids (Minor 10) |
| C | Fake reproduces every common UI state deterministically | **Pass (mostly)** | `restart` identity, `fail.code` ignored (Minor 8/9) |
| C | Shared suite covers ordering, seq, malformed/unknown, cancel, exclusivity, restart, honesty, secrets — reusable unchanged | **Partial** | Exclusivity tautology (R1-M15); malformed/secrets/restart/typed errors absent (R1-M16) |
| D | Versioned schemas validated on request **and event** boundaries | **Partial** | Requests validated; event boundary unvalidated; server version in success response unchecked (Minor 26) |
| D | Backpressure; slow consumers bounded; requests settle exactly once | **Partial** | Event stream only; inbound queue + responses unbounded (R1-M4); invalid envelopes never answered (R1-M8) |
| D | Redaction: canaries never cross the diagnostic boundary | **Partial** | Adapter error text unredacted (R1-M5); fake diagnostic path leaks (R1-M17); no process-level canary test |
| D | Reproducible build with deterministic version metadata | **Fail** | Timestamp embed (R1-M9) |
| E | One active generation; stale events can't mutate it | **Partial** | Generation gating correct + tested; concurrent-start race (R1-M11); deadlockable state mutex (R1-C2) |
| E | Every shutdown/recovery path reaps the tree in bounded time | **Fail** | Cooperative shutdown dead (R1-M10); mutex deadlock (R1-C2); orphan race (R1-M12); no Windows cleanup (R1-M13) |
| E | No orphan processes on supported platforms | **Partial** | Stop-path proven; crash-path race (R1-M12); Windows unproven |
| F | Runtime-neutral fields persisted; store enforces immutability | **Partial** | Store guard works + tested; disk persistence drops bindings (R1-C1) |
| F | Runtime → model → mode creation flow; immutable binding | **Partial** | No runtime picker, hardcoded fake (R1-M29); catalogs broken before first send (R1-M26) |
| F | Lifecycle through Tauri+host incl. restart recovery | **Partial** | Happy path works; mid-turn host death hangs (R1-M27); resume ref desync (R1-M28) |
| F | No provider-prefixed session fields in common code | **Pass** | Guard test + sweep; two minor copy/glue leftovers (Minor 38, Nits) |
| F | Fake-host E2E + non-AI regressions green | **Partial** | No fake-host E2E artifact exists; 5 pre-existing non-AI failures unrelated to milestone 01 |

## Recommended fix ordering

**Before phase 02 implementation starts (blocking):**

- R1-C1 (binding persistence), R1-M26 (catalogs before first send),
  R1-M29 (runtime-selection step or explicit phase-02 task),
  R1-M27/R1-M28 (turn stream liveness + resume desync) — these four are the
  phase-02 vertical slice itself; building the Claude adapter on top of them
  wastes the milestone.
- R1-M15/R1-M16 (contract suite strength) — phase-02 exit gates on this suite;
  it must actually enforce what it claims first.
- R1-C3, R1-M1, R1-M5, R1-M10 (host crash/shutdown/redaction semantics) — real
  adapters turn these theoretical paths into daily ones.

**During phase 02 (hardening phase D):** R1-M18/R1-M19 (terminal + usage
semantics), R1-M20/R1-M21/R1-M25 (codec strictness, redaction patterns, decode
tests), R1-M17, R1-M22/R1-M23/R1-M24 (contract shape — breaking changes get
expensive after the first real adapter), R1-C2/R1-M11/R1-M12 (supervision
correctness), R1-M2/R1-M3/R1-M4/R1-M6/R1-M7/R1-M8 (host robustness), Minor 22
(shared package extraction), Minor 24/25 (bridge hardening).

**Before phase 06 release:** R1-M9 (reproducible builds), R1-M13 (Windows job
objects or descoping), R1-M14 (node bundling), Minors 26–33.
