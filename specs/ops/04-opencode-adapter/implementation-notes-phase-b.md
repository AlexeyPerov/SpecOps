# AS04-B — Native core sessions and normalized turns

**Updated:** 2026-10-04 20:27 MSK
**State:** Source implementation verified; installed and live-provider acceptance remains open.

## Implemented contract

The host uses the exact 1.17.4 native SDK for session create/get/update/messages/status/prompt_async/abort, provider/model and primary-agent catalogs, permission replies and question answers/rejections. Profile, canonical workspace path, model and mode are persisted in native session metadata and checked during resume. Configured model/default agent are captured when creating a session; sending without a configured or explicitly selected model requires an explicit new session selection. Later changes to defaults do not change an existing binding. Native policy, workspace instructions and tools remain authoritative; no synthetic sandbox or write guarantee is advertised.

Resume fetches bounded native history, stops a reported orphaned busy session, preserves interrupted/failed partial turns and returns normalized reasoning/tool/step/subtask/file/usage events. Native-to-client user message identifiers persist in native metadata so production history reconciliation keeps local message identity without replay or duplicates. Missing profile/history preserves the application's record and returns an explicit failure. No migrations, compatibility shims or model wrappers were added.

SSE uses its own cancellable fetch and `/event` subscription established before dispatch, separate from the three-second control-plane fetch. It never reconnects and replays a prompt automatically. Disconnects require explicit resume. Frames are capped at 1 MiB; queued events at 4,096 / 4 MiB; cumulative mapper state at 8 MiB and finite identity counts; history at 10,000 messages / 16 MiB. Events carry stable native item/prompt IDs, host cursors, immutable profile and child generation. Duplicate event/part/step snapshots and stale session/profile/turn events are ignored. Unknown native events retain bounded redacted diagnostics. A malformed required part fails the turn rather than emitting malformed common events.

Core text/reasoning/tools/steps/subtasks/file attachments/patches/usage, error, retry and native compaction notifications are normalized. Usage comes from per-step finish increments, avoiding double counting assistant message totals. Compaction does not claim a removed-message count that the native event does not expose. Subtask descriptors represent started work; task tool completion/failure supplies terminal subtask state. Optional next-session rich extensions remain outside this slice.

Permission and question tokens are host-generated and scoped to the active native prompt/profile/generation. Only native requests linked to a correlated assistant message are exposed; uncorrelated requests remain unavailable with a diagnostic. Native once/always/reject remains native-authoritative. Multi-question answers accumulate once before the single native reply. Duplicate/stale answers are rejected. Native deadlines, Stop, mapper overflow, disconnect and child loss settle one terminal and close the iterator. Failed/cancelled streams retain the session reservation until native abort and in-flight dispatch settle; a late prompt acknowledgement triggers another abort. Unconfirmed abort retires only the owning connection/child. External endpoint ownership cannot promise to kill an owner's process after an unconfirmed abort; its stream is retired and explicit recovery is required.

Split text/reasoning credentials remain private across unrelated parts until the lexical atom is complete. Final snapshots, tools, diagnostics and history use the shared redactor without truncating benign output.

## Required versus later ledger

Required categories in the AS04-A finite ledger now have source implementations: native create/read/resume/history, persisted immutable binding/settings, native model/primary-agent catalogs, core events/tools/file changes/usage/failure, permissions/questions/cancel/deadlines, interrupted-state and explicit reconnect. Local Sessions indexing/history persistence is exercised through production writers and native hydration. Native archive/list management is not advertised by an unsupported common extension. Fork/revert/share/manual summarize/commands/todos/session diffs/diagnostics/MCP/skills/configuration panels remain unavailable and owned by 06-B or their explicit future owner. Core compaction and patch events do not advertise those rich panels.

## Verification recorded

- Full host suite: 154 tests passed, two opt-in native tests skipped in ordinary runs; host TypeScript and production bundle passed.
- Explicit bundled 1.17.4 no-account run: 38 tests passed across bootstrap/core suites, including real native session creation, child restart, read/resume and empty authoritative history in isolated temporary homes. This is native lifecycle evidence, not provider inference acceptance.
- Frontend: 56 focused tests passed, covering legacy core history/catalog comparisons, shared contracts, bindings and production dispatcher/client/pipeline/disk persistence; Svelte check reported zero errors/warnings; production build passed with its existing chunk-size warning.
- Deterministic native protocol fixtures cover concurrent-send exclusion, profile-local crash, delayed/ignored native abort, late acknowledgement, deadline/Stop, duplicate and cross-profile interactions, malformed parts, undrained/draining capacity, every split-position credential canary and divergent/corrupt cached history recovery. Codex host and production-persistence regressions passed.

## Concrete AS04-C handoff and acceptance gates

C must connect the common runtime selector/profile panel to the selected runtime instead of the current Codex-only profile branch, expose OpenCode native primary modes/models through the common controls, and remove the legacy frontend SDK/backend factory and Rust supervisor/ownership gate. Adapt native API-key login to the existing host-only private-file credential import flow before advertising a common frontend key-entry flow; B does not add a WebView key field. Preserve metadata/native binding when profile or history is missing. No rich 06-B control is a prerequisite.

Still unverified: paid/live-provider auth/inference, actual live permission/question/tool/cancel and restart, account-A/B preservation, UI/installed ownership cutover and packaging/security acceptance, Windows/Linux installed process cleanup, immediate descendant spawn/exit cleanup race, upstream AS02-D installed/account baseline and selected-scope release gates. Tasks below are source-Done only; no installed/release acceptance is claimed.
