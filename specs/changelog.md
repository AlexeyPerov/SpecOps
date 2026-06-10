# Changelog

## 2026-06-10 16:15

- **Regression and validation sweep + phase-3 closure (phase 3 M3 tasks 4–5):** Created `phase3M3.validation.test.ts` with 33 tests covering workspace HTTP cutover regression gate: workspace sends route exclusively through OpenCode backend (never HTTP ChatProvider), chat-http sends never invoke workspace backend, `shouldUseWorkspaceAgentBackend` routing invariants, event normalization contract alignment (v2 SDK events → contract names: `message.delta`, `tool.started`/`tool.completed`, `permission.requested`, `question.requested`, `run.failed`), session restore reconciliation (stale mapping detection, valid mapping preservation, session-scoped mapping without HTTP run-id fields), permission/question/tool flows end-to-end, workspace cancellation with `abortSession`, backend error mapping (auth failure, server unavailable). Chat-http non-regression coverage: SSE streaming, cancellation with abort signal, retry after failure. All 1071 tests pass, 0 typecheck errors. Marked phase-3 exit criteria complete in `phase-3.md` (status: complete). Marked tasks 4–5 `[DONE]` in `execution-plan-m3.md`. Added phase-5 handoff notes covering cursor-local backend stub, routing extension point, session mapping reuse, and contract freeze scoping.

## 2026-06-10 16:00

- **Breaking-change docs and user-facing notes (phase 3 M3 task 3):** Updated `docs/providers.md` opening paragraph to clarify HTTP provider registry applies to Chat context only — workspace uses OpenCode backend. Updated `docs/architecture.md` send pipeline and access preflight descriptions to distinguish Chat vs Workspace validation paths. Updated `chatErrorCopy.ts` recovery hints to remove "Choose HTTP" language from provider-agnostic error copy (`PROVIDER_UNAVAILABLE_RECOVERY`, `PROVIDER_UNSUPPORTED_ACCESS_RECOVERY`, `PROVIDER_NOT_REGISTERED_MESSAGE`, `PROVIDER_NOT_REGISTERED_RECOVERY`). Updated `selection.ts` doc comment to clarify default provider precedence is for Chat context only. Updated `ConnectionsSettingsPanel.svelte` Providers section note to specify "Chat context", empty state copy to say "Chat context" instead of "HTTP chat", and OpenCode section note to clarify workspace agents use OpenCode backend. Added breaking-change note to `phase-3.md` (E2A): legacy workspace HTTP thread JSON is not imported or migrated to OpenCode sessions. Marked Task 3 `[DONE]` in `execution-plan-m3.md`.

## 2026-06-10 15:18

- **Remove stale workspace HTTP branches and dead code (phase 3 M3 task 2):** Removed dead `validateWorkspaceAgentBackendSend()` function (never called after Task 1). Removed dead workspace access-preflight branch from `validateProviderSend()` (unreachable since workspace sends route through `validateOpencodeBackendSend`). Removed dead workspace-HTTP guard block and `logWorkspaceHttpProviderGuard` diagnostic from `executeProviderTurn()`/`chatDiagnostics.ts` (unreachable after Task 1 cutover). Updated HTTP provider capability message from "ready for workspace chat" to "ready for chat". Removed stale test "keeps workspace HTTP chat working" that tested dead workspace-HTTP path. Updated phase 2 validation test comments to reference OpenCode instead of HTTP for workspace. Updated workspace empty-hint text in `ChatPanel.svelte` and `ChatMessageList.svelte` to reflect OpenCode-first workspace runtime. Removed deprecated `resolveWorkspaceRoot` wrapper, migrating all callers to `resolveChatScopeKey`. Updated affected tests to use ws-* contexts where needed. `chat-http` send behavior completely unchanged. All 1038 tests pass, 0 typecheck errors.

## 2026-06-10 14:55

- **Workspace send-path cutover to OpenCode only (phase 3 M3 task 1):** Removed workspace (`ws-*`) context coupling to HTTP `ChatProvider` validation. Added `validateOpencodeBackendSend()` in `chatSendPipeline.ts` that checks filesystem access via `ensureWorkspaceReadAccess` and resolves model from OpenCode catalog or thread metadata — entirely independent of HTTP provider config/capability checks. Workspace sends now bypass `validateProviderSend()` (which validates HTTP API keys, provider capabilities, and model catalogs) and go directly through `validateOpencodeBackendSend()` → `executeWorkspaceAgentBackendTurn()`. Applied same cutover to `retryChatTurn.ts`. Added guard assertion in `executeProviderTurn()`: if a ws-* context somehow reaches the HTTP provider path, logs `logWorkspaceHttpProviderGuard` diagnostic and returns error. Added `logWorkspaceHttpProviderGuard` to `chatDiagnostics.ts`. Made `provider` and `accessStatus` optional in `executeProviderTurn`/`executeWorkspaceAgentBackendTurn` params since workspace sends don't need them. Added test verifying workspace sends succeed even when HTTP provider is unconfigured. Updated workspace send model assertion (model now resolved from OpenCode catalog/metadata instead of HTTP provider catalog). `chat-http` send behavior completely unchanged. All 1039 tests pass, 0 typecheck errors.

## 2026-06-10 14:40

- **Milestone 2 tests and verification (phase 3 M2 task 6):** Added comprehensive test coverage locking MVP interaction flows for workspace OpenCode runtime. Created `chatSendPipeline.test.ts` (13 tests) covering workspace streaming delta rendering interleaved with tool events, tool progress tracking during streaming, `run.failed` error handling, multiple tool calls with mixed success/failure, `message.completed` event replacing accumulated deltas, and tool call state preservation after cancellation. Added 6 edge case tests to `toolCallReducer.test.ts` covering failure lifecycle, progress on terminal state, multiple rapid progress updates, triple duplicate idempotency, out-of-order progress before start, and null callId consistency across all reducer functions. Added 5 stream normalization tests to `workspaceAgentBackend.test.ts` covering tool failure event normalization, `message.completed` from `text.ended` SDK event, malformed frame skipping, empty delta filtering, and concurrent tool calls with interleaved dedup. Added 8 workspace model selection tests to `selection.test.ts` covering `resolveWorkspaceModelId` (preferred model, stale fallback, null/empty/whitespace handling) and `listSelectableWorkspaceModels`. Total test count increased from 1007 to 1038. All tests pass, 0 typecheck errors.

## 2026-06-10 14:25

- **Models/agents list alignment with OpenCode config (phase 3 M2 task 5):** Extended `WorkspaceAgentBackend` with `listModels()`, `listProviders()`, and `listAgents()` methods mapping to OpenCode `/api/model`, `/api/provider`, `/api/agent` endpoints via `RawOpencodeClient` HTTP client. Added `OpencodeModelEntry`, `OpencodeProviderEntry`, `OpencodeAgentEntry` domain types with robust payload parsing (`unwrapList`, `mapModelEntry`, `mapProviderEntry`, `mapAgentEntry`). Created `opencodeCatalog` service with per-workspace cached catalog state (`idle`/`loading`/`loaded`/`error`), inflight request deduplication, and deterministic refresh/recovery — `refreshOpencodeCatalog()` fetches all three catalogs in parallel via `Promise.all`. Extended `selection.ts` with `listSelectableWorkspaceModels()` and `resolveWorkspaceModelId()` for workspace model selection from OpenCode catalog. Updated `ChatPanel.svelte` to auto-refresh catalog on workspace open (triggers on `idle` or `error` state) and pass catalog state to `ChatComposer.svelte` via `opencodeCatalog` prop. Updated `ChatComposer.svelte` to use OpenCode catalog models when in workspace context with loaded catalog, falling back to settings-based `ProviderModelCatalogs` when catalog is unavailable. Stale selected model falls back deterministically to first available catalog model via existing `syncComposerModelFallback`. Added "Refresh model list" button to `ConnectionsSettingsPanel.svelte` in the OpenCode section. Added 13 tests for catalog service (refresh, cache, dedup, error handling, model fallback, re-refresh) plus 5 backend tests for catalog listing endpoints including cursor-local stubs. All 1007 tests pass, 0 typecheck errors.

## 2026-06-10 14:05

- **Question prompt modal + reply plumbing (phase 3 M2 task 4):** Added question prompt service (`questionPrompt.ts`) with promise-based runner registration pattern (matching `permissionPrompt.ts`), defaulting to reject when no runner is registered. Created `QuestionPrompt.svelte` modal component showing question prompt text with multi-select checkbox choices, validation that requires at least one selection, Submit/Cancel buttons, backdrop dismiss defaults to reject, escape key cancels. Wired `question.requested` event handling in `executeWorkspaceAgentBackendTurn` stream loop in `chatSendPipeline.ts` — stream pauses on question events, surfaces modal via service, awaits user decision, calls `backend.replyQuestion()` with selected answers or `backend.rejectQuestion()` on cancel, then resumes. Added `isWaitingForQuestion` to `ChatThreadRuntimeState` with `setWaitingForQuestion()` runtime slice method so UI can distinguish generating vs awaiting question input. Handles stale `notFound` reply/reject errors gracefully (breaks stream loop). Multiple sequential question events naturally queue FIFO via sequential `for await` processing. Added 5 stream integration tests covering reply/reject, FIFO queueing, stale recovery, and wait-state tracking, plus 4 service-level tests. All 989 tests pass, 0 typecheck errors.

## 2026-06-10 13:44

- **Permission request modal + reply plumbing (phase 3 M2 task 3):** Added permission prompt service (`permissionPrompt.ts`) with promise-based runner registration pattern (like `entryNamePrompt`), defaulting to reject when no runner is registered. Created `PermissionPrompt.svelte` modal component showing action label with Deny/Allow Once/Always Allow buttons, backdrop dismiss defaults to reject, escape key cancels. Wired `permission.requested` event handling in `executeWorkspaceAgentBackendTurn` stream loop in `chatSendPipeline.ts` — stream pauses on permission events, surfaces modal via service, awaits user decision, calls `backend.replyPermission()` with chosen action (`once`/`always`/`reject`), then resumes. Added `isWaitingForPermission` to `ChatThreadRuntimeState` with `setWaitingForPermission()` runtime slice method so UI can distinguish generating vs awaiting approval. Handles stale `notFound` reply errors gracefully (breaks stream loop). Multiple sequential permission events naturally queue FIFO via sequential `for await` processing. Added 6 stream integration tests covering allow/deny/always-allow, FIFO queueing, stale recovery, and wait-state tracking, plus 4 service-level tests. All 980 tests pass, 0 typecheck errors.

## 2026-06-10 13:19

- **Tool event timeline and cards (phase 3 M2 task 2):** Added `ToolCallRecord`/`ToolCallStatus` domain types and extended `ChatMessage` with optional `toolCalls` array. Created idempotent `toolCallReducer` (`applyToolStarted`/`applyToolCompleted`/`applyToolProgress`) with out-of-order synthetic placeholder handling per event normalization spec. Wired `tool.started`/`tool.completed`/`tool.progress` events in workspace backend stream loop (`chatSendPipeline.ts`), updating assistant message tool call state in real time. Added `updateMessageToolCalls` to thread messages slice. Created `ToolCard.svelte` component (collapsed summary with expandable input/progress/output details, status indicators). Rendered tool cards inline in `ChatMessageList.svelte` below assistant text. Updated persistence codec to serialize/deserialize `toolCalls` on messages. Added 16 reducer tests covering idempotent updates, out-of-order events, multiple concurrent calls, and full lifecycle flows. All 970 tests pass, 0 typecheck errors.

## 2026-06-10 12:39

- **M1.5 Task 6 verification gate + M2 handoff:** Completed phase-3 M1.5 verification by extending contract-aligned backend coverage in `workspaceAgentBackend.test.ts` (explicit prompt send contract assertion) and fixing `appShellAgentHandlers.test.ts` preflight mock typing for current `ChatAccessState`. Updated `specs/ops/phase-3/m1-task5-smoke.md` into an M1.5 Task 6 checklist to cover prompt/tool/permission/question/reject/cancel and restore-reconcile flows in sidecar and URL modes, and added explicit handoff guidance to resume Milestone 2 from `execution-plan-m2.md` Task 2. Marked Task 6 `[DONE]` and completed M1.5 exit criteria in `execution-plan-m1-5.md` after passing `npm test` and `npm run check` (warnings only).

## 2026-06-10 12:34

- **Session mapping restore/reconcile hardening (phase 3 M1.5 task 5):** Integrated workspace-scoped OpenCode session mapping reconciliation into runtime workspace restore flow via `appShellAgentHandlers`: after loading workspace agents and merging session drafts, restore now validates persisted agent->session links against backend session list and deterministically clears stale mappings when remote sessions are missing/deleted, while preserving restore behavior when backend listing is temporarily unavailable (`serverUnavailable`/`transportError`/`authFailure`). Added focused tests in `appShellAgentHandlers.test.ts` for stale-mapping cleanup and unavailable-backend fallback; marked M1.5 Task 5 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:58

- **Permission/question reply and abort backend commands (phase 3 M1.5 task 4):** Extended `workspaceAgentBackend` with explicit command APIs for permission replies (`reply: once|always|reject`), question replies (`answers: string[][]`), question reject, and session abort semantics for cancel UX. Wired HTTP client routes for OpenCode v2 permission/question reply/reject endpoints and added abort fallback routing (`/api/session/{id}/abort|stop`, then `/session/{id}/abort|stop`) with consistent `WorkspaceAgentBackendError` propagation. Updated workspace send cancellation flow to call backend session abort on turn cancellation and covered the behavior with backend/send tests. Marked M1.5 Task 4 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:49

- **Exact event normalization rewrite (phase 3 M1.5 task 3):** Reworked OpenCode stream normalization in `workspaceAgentBackend` to follow the phase-3 spec exactly: strict `data`/`properties` envelope parsing, v2-only permission/question mapping, optional `tool.progress`, deterministic dedup by frame id with composite fallback (`type + sessionID + callID + timestamp`), and out-of-order tool lifecycle recovery by emitting synthetic `tool.started` before terminal tool events. Added diagnostic logging for unknown and malformed frames without failing stream consumption, removed `runId` assumptions from normalized `run.completed`/`run.failed` events, updated workspace streaming tests (including duplicate and out-of-order cases), and marked M1.5 Task 3 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:48

- **Workspace backend contract correction (phase 3 M1.5 task 2):** Reworked `workspaceAgentBackend` and workspace send pipeline to remove run-endpoint assumptions and align with OpenCode canonical contract: session CRUD now uses `/session` + `/api/session`, prompt send uses `/api/session/{sessionID}/prompt`, and streaming uses canonical `/api/event` envelope with bridged `/event` fallback. Updated event normalization to v2 stream types (`session.next.*`, `permission.v2.asked`, `question.v2.asked`, `session.status/session.idle`, `session.error`) and removed `runId` dependency from workspace chat send flow. Refreshed backend/send tests for the new prompt+session-stream semantics and marked M1.5 Task 2 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:40

- **Docs (phase 3 M1.5 task 1 contract freeze):** Added `specs/ops/phase-3/opencode-contract-freeze-m1-5.md` as a single baseline for frozen OpenCode session/prompt/stream contract assumptions, explicit invalid legacy run-endpoint assumptions to remove, and implementation guardrails for Tasks 2-6. Linked the contract-freeze baseline from `phase-3.md`, milestone plans (`execution-plan-m2.md`, `execution-plan-m3.md`), and marked M1.5 Task 1 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:34

- **Docs (phase 3 decisions applied):** Resolved Phase 3 OpenCode contract uncertainties with explicit decisions in docs/plans: canonical stream envelope is native `/api/event`; permission/question handling is v2-only (no backward compatibility path); prompt queue policy is single-active-per-session with FIFO; tool-card lifecycle uses idempotent updates plus synthetic placeholders for out-of-order/partial events; model/provider catalog strategy is auto-refresh on open plus manual refresh action; M3 requires full workspace-lane audit (runtime + copy + docs + tests) before closure.

## 2026-06-09 23:55

- **Docs (phase 3 contract alignment package):** Added OpenCode contract references for Phase 3 implementation planning: `specs/ops/phase-3/opencode-api-mapping.md` (SpecOps -> OpenCode endpoint/SDK mapping), `specs/ops/phase-3/opencode-event-normalization-spec.md` (exact stream normalization and idempotency rules), `specs/ops/phase-3/opencode-permission-question-flow.md` (modal/reply behavior), `specs/ops/phase-3/opencode-error-mapping.md` (backend error translation), and `specs/ops/phase-3/opencode-m1-gap-analysis.md` (M1 gap summary).
- **Docs (phase 3 milestone bridge):** Added `specs/ops/phase-3/execution-plan-m1-5.md` to bridge M1 -> M2 with ordered refactor/fix tasks for OpenCode contract alignment before continuing M2 Task 2.
- **Docs (phase 3 execution order update):** Updated `phase-3.md` execution chain to include `m1-5`, linked new contract docs in deliverables, and added changelog row for M1.5 alignment bridge.
- **Docs (milestone plans):** Updated `execution-plan-m2.md` to require M1.5 completion, added Task 1 re-verification note, and adjusted Task 2-6 dependencies/required context to start M2 from Task 2 after M1.5. Updated `execution-plan-m3.md` prerequisites and task details to enforce M1.5 -> M2 -> M3 ordering and to remove remaining workspace HTTP coupling using contract-aligned semantics.

## 2026-06-09 23:24

- **Workspace composer OpenCode stream routing (P3-4 / Task 1):** Added workspace-only (`ws-*`) send path in chat pipeline to execute turns through `WorkspaceAgentBackend("opencode")` while preserving existing `chat-http` provider pipeline. Workspace turns now create/reuse per-agent OpenCode sessions, stream assistant deltas into the active assistant message in real time, and preserve generation lifecycle semantics for success/cancel/error without changing chat-only contexts. Added coverage in `sendChatMessage.test.ts` for ws-context backend routing, stream cancellation behavior, and non-workspace isolation.

## 2026-06-09 23:08

- **Milestone 1 verification (P3-8 partial / Task 5):** Expanded OpenCode runtime coverage across sidecar health transitions and URL checks (`appShellEffects.opencodeSidecar.test.ts`), backend HTTP error mapping and additional stream-event normalization (`workspaceAgentBackend.test.ts`), and sidecar health mapping fallback (`opencodeSidecar.test.ts`). Added manual connectivity smoke checklist for sidecar and URL modes in `specs/ops/phase-3/m1-task5-smoke.md`, and marked Task 5 `[DONE]` plus M1 quality-gate exit criterion complete in `execution-plan-m1.md` after passing `npm test` and `npm run check`.

## 2026-06-09 23:03

- **Workspace agent session mapping (P3-3 / Task 4):** Added persisted per-agent OpenCode session mapping metadata to workspace agent index entries (`opencodeSessionId`, plus optional model/provider restore hints), including codec validation and round-trip coverage in chat persistence tests. Extended chat store agent APIs with workspace-scoped session link set/get/clear helpers and added unit coverage for mapping updates and workspace isolation. Added mapping reconciliation helpers/tests in `workspaceAgentSession` for deterministic recovery when a previously linked remote session is missing.

## 2026-06-09 22:45

- **Workspace backend (OpenCode adapter, P3-2):** Replaced `workspaceAgentBackend` phase-1 stub for `id: "opencode"` with a functional adapter that resolves sidecar/URL client mode, binds every request to workspace `rootPath` as `directory`, and adds backend API for session CRUD, run send, and normalized stream events. Added frontend-safe event normalization boundary (message/tool/permission/question/run events), robust backend error typing and mapping (`authFailure`, `serverUnavailable`, `transportError`, `invalidDirectory`, `invalidResponse`, `notFound`), and preserved `cursor-local` as a phase-5 stub path. Added unit coverage in `workspaceAgentBackend.test.ts` for functional creation, directory validation, stream normalization, and payload validation failures.

## 2026-06-09 22:22

- **Settings + runtime (OpenCode transport + health, P3-6 partial):** Added OpenCode workspace settings schema (`mode`, URL) and runtime health model (`unknown/checking/healthy/degraded/error`, source, last error) with persisted storage and app-state wiring. Implemented Settings UI controls in `ConnectionsSettingsPanel.svelte` for sidecar vs URL mode, URL validation, OpenCode server password secret, health indicator, and manual check action. Wired runtime reconnect/health refresh on mode changes without restart via app shell effects, plus sidecar health normalization and URL health probe. Added OpenCode server password secrets APIs in `providerSecretsStore.ts`.

## 2026-06-09 22:12

- **OpenCode sidecar packaging (P3-1 follow-up):** Added `externalBin` config in `tauri.conf.json`, dev proxy binary at `src-tauri/binaries/opencode-aarch64-apple-darwin`, and leak-prevention unit tests for idempotent stop/teardown state.

## 2026-06-09 21:35

- **OpenCode sidecar (phase 3 / P3-1):** Added Tauri `opencode_sidecar` manager with start/stop/restart/attach/status commands, typed lifecycle errors (`portInUse`, `missingBinary`, `launchFailure`, `healthTimeout`, `staleProcess`), health probing against `/global/health`, hybrid reuse-or-restart attach per workspace `rootPath`, and deterministic teardown on app exit. Frontend bridge in `opencodeSidecar.ts`; workspace attach effect and app-shell cleanup wiring. Tests for Rust attach logic and TS invoke wrappers.

## 2026-06-09 18:22

- **Docs (phase 3 execution):** Added milestone execution plans for OpenCode workspace rollout: [execution-plan-m1.md](./ops/phase-3/execution-plan-m1.md) (sidecar/client/session foundation), [execution-plan-m2.md](./ops/phase-3/execution-plan-m2.md) (stream/tool/permission/question MVP UI), and [execution-plan-m3.md](./ops/phase-3/execution-plan-m3.md) (workspace HTTP cutover, cleanup, and closure). Linked plans from [phase-3.md](./ops/phase-3/phase-3.md).

## 2026-06-09 18:05

- **Docs (roadmap):** Swapped phases 3 and 4 — OpenCode workspace UI is now [phase-3](./ops/phase-3/phase-3.md); Cloud context (`chat-cloud`) is now [phase-4](./ops/phase-4/phase-4.md). Renamed `specs/ops/phase-3/` ↔ `specs/ops/phase-4/` folders and updated cross-references in roadmap, phase-1..7 specs, execution plans, and `workspaceAgentBackend` stub message.

## 2026-06-09 14:45

- **Status bar (Chats/Agents):** In chat/agent tabs, the bottom status bar now shows only console toggle context, status message, and path. Editor-only metadata (Ln/Col, encoding, EOL, zoom, wrap, modified/missing flags) remains visible for file editor tabs.
- **Theme editor + tokens:** Added dedicated text-accent theme tokens for `keyword`, `type`, `link`, and `plaintext-symbol` (`syntax-keyword`, `syntax-type`, `syntax-link`, `syntax-plaintext-symbol`) and grouped them under a new **Text accents** section in theme token schema. Existing accent controls are preserved.
- **Plaintext symbol coloring:** Fixed non-English plaintext handling so Unicode letters/numbers are no longer treated as symbols for accent decoration. Only punctuation/symbol characters are decorated in plaintext mode.
- **Session restore behavior:** Window session restore now falls back to the snapshot of the last active window if the current window has no stored snapshot, while preserving intentional app-level fallback behavior to notepad when active context cannot be restored.
- **macOS dock open/drop:** Updated Tauri bundle file association configuration to a wildcard association (`*/*` / `*`) so opening/dropping extensionless and uncommon files through the dock/app icon is accepted, while existing preview/read-only open behavior remains unchanged.
- **Tests:** Added coverage for Unicode symbol-decoration logic and last-active-window restore fallback; updated theme/token tests to assert the expanded token surface.

## 2026-06-09 12:55

- **Chat UI (context window budgeting):** Added realtime debounced token budget estimate in composer, shown to the left of `Send` as `~used / limit` when a model limit is known (or `~used tokens` otherwise). Estimate includes resolved system prompt + retained history + current draft and updates on draft/thread/model/mode/provider changes.
- **AI internals:** Added shared estimation utility (`app/src/lib/ai/contextWindowBudget.ts`) with lightweight context-limit heuristics for common model ids and initial unit coverage in `contextWindowBudget.test.ts`.
- **Docs:** Updated `phase-2.5-token-ideas.md` marking Context window budgeting as **DONE (UI estimate slice)** with implementation notes; added `specs/backlog.md` to track follow-up ideas/tech debt.

## 2026-06-09 10:00

- **Chat UI:** Composer toolbar simplified — removed Connection, Model, and Mode text labels; mode picker is now a dropdown on the left; connection/model selects sit beside it; Send (and Retry) moved to the right. Applies to both agent and chat-http composers.

## 2026-06-08 15:00

- **Chat modes (token optimization):** Removed duplicated Review section headings from `REVIEW_MODE_SYSTEM_PROMPT`; `sectionInstructions()` via `requiredSections` is now the single source. Added `{{workspace}}` and `{{summary}}` placeholders to Ask, Review, and Raw built-in prompt templates so context toggles affect outgoing system prompts.

## 2026-06-08 14:30

- **Docs:** `phase-2.5-token-ideas.md` — Open questions expanded with answer options and recommended choices.

## 2026-06-08 14:00

- **Docs:** `phase-2.5-token-ideas.md` — added **What to implement** under each gap in “What is missing or weak”; aligned prioritized table Idea column with those section names.

## 2026-06-08 13:00

- **Docs:** Split phase-2.5 backlog into `phase-2.5-token-ideas.md` (detailed token optimization notes) and `phase-2.5-ux-ideas.md` (UX ideas updated for tile grid + editor dialog settings). `phase-2.5-ideas.md` is now an index.

## 2026-06-08 12:30

- **Docs:** Added `specs/ops/phase-2.5/phase-2.5-ideas.md` — backlog of chat-mode token-efficiency gaps and UI/UX improvements (post-M5 review).

## 2026-06-08 12:00

- **Settings UI:** Settings window is 50% wider by default. Opening settings shows a full-window backdrop that blocks interaction with the main app; keyboard shortcuts are suppressed except toggling settings closed.
- **Settings UI:** Fixed Remove button vertical alignment in list rows (connections, required sections) with horizontal inset.
- **Settings chat modes:** Replaced foldout/list layout with a grid of rounded square tiles for built-in and custom modes; clicking a tile opens an editor popup; a `+` tile adds a custom mode.

## 2026-06-08 11:00

- **Global UI:** Bottom panel (console + status bar) now spans the full window width instead of only the editor column. Removed the activity-rail separator between Notepad and Chat/workspace modes.
- **Chat UI:** Removed borders and card background from assistant (AI) message blocks; user and system messages keep bordered styling.

## 2026-06-08 10:15

- **Chats/Agents sidebar UI:** Sidebar list titles truncate at 32 characters with ellipsis; rows show a smaller gray subtitle from the first AI answer. Fixed sidebar overflow (right inset, collapse button moved left of New chat/agent, `overflow: hidden`). New chat/agent button now has a visible border and background. Removed accent highlight styling from agent/chat tabs in the tab bar.

## 2026-06-08 09:30

- **Fix:** Removed duplicate re-export of `nextNumericId` / `sanitizeWindowSnapshot` in `sessionManager.ts` that broke Vite/esbuild on launch.

## 2026-06-08 09:15

- **Settings chat modes:** Added collapsible foldouts for the Built-in modes section in Chat Modes settings; Ask and Review each have nested foldouts (Raw stays inline). New shared `SettingsFoldout.svelte` + `settingsFoldout.css`.

## 2026-06-08 08:48

- **M6 complete (P2-10):** Closed milestone validation (Task 7). Reorganized large test files into `appState/`, `chatStore/`, `commands/handlers/`, and `ai/retryChatTurn.test.ts` (removed broken import-only aggregators). Fixed `settingsSlice` ↔ `registry` circular import via `commandBindingRuntime.ts`; re-exported `nextNumericId` / `sanitizeWindowSnapshot` from `sessionManager.ts`. All audit production files ≤600 lines; test files ≤600 lines. 888 tests; `npm run check` 0 errors. Updated parent M6 exit criteria, `phase-2.md`, and `docs/architecture.md` module-size conventions.

## 2026-06-08 08:31

- **M6.4 Tasks 3-4 (P2-10):** Split chat send pipeline into `ai/sendChatMessage.ts` (public orchestration), `ai/retryChatTurn.ts` (retry flow/guards), and `ai/chatSendPipeline.ts` (shared provider validation, streaming execution, compaction/persistence hooks), keeping exports stable (`sendChatMessage` + `retryLastChatTurn`) and behavior unchanged.
- **M6.4 Task 4 (P2-10):** Extracted app menu builders to `services/appMenuDefinitions.ts` while preserving install/refresh orchestration in `services/appMenu.ts`; extracted external reload policy/runtime helpers to `services/externalFileReloadPolicy.ts`, `services/externalFileChangesRuntime.ts`, and `services/externalFileChangesTypes.ts`, keeping watcher/focus/tab/startup orchestration in `services/externalFileChanges.ts`.
- Updated `execution-plan-m6-4-platform-refactoring.md` to mark Tasks 3 and 4 as `[DONE]`. Verified with `npm test -- src/lib/ai/sendChatMessage.test.ts src/lib/services/appMenu.test.ts src/lib/services/externalFileChanges.test.ts src/lib/services/externalFileChanges.helpers.test.ts` and `npm run check` (0 errors; existing warnings unchanged).

## 2026-06-08 08:08

- **M6.4 Tasks 1-2 (P2-10):** Split command registry into `commands/definitions.ts` plus grouped handler modules under `commands/handlers/` (`app.ts`, `file.ts`, `workspace.ts`, `edit.ts`, `view.ts`) with shared `fileActions.ts`; `registry.ts` now retains handler merge, dispatch, keymap lookup, registered ids, active document content, and binding override wiring while re-exporting `commandDefinitions` for backward compatibility. `registry.ts` is 129 lines and each required handler module is <= 250 lines.
- **M6.4 Task 2 (P2-10):** Split chat persistence into `chatPersistenceCodec.ts` (encode/decode, index helpers, compaction helpers, hash key), `chatPersistencePaths.ts` (scope segment + agents/index path resolvers), and a thinner `chatPersistence.ts` for read/write, debounce scheduling, persist/delete orchestration, and backward-compatible re-exports. Persistence behavior and APIs are unchanged for current consumers/tests.
- Updated `execution-plan-m6-4-platform-refactoring.md` to mark Tasks 1 and 2 as `[DONE]`. Verified with `npm test -- src/lib/commands/registry.test.ts src/lib/services/chatPersistence.test.ts src/lib/services/chatPersistence.retention.test.ts` and `npm run check` (0 errors; existing warnings unchanged).

## 2026-06-07 23:55

- **M6.3 Task 4 (P2-10):** Split `chatStore/threads.ts` into focused modules: `threadMessages.ts` (`appendMessage`, `updateMessageContent`, `removeMessage`, `compactActiveThread`, `getMessages`), `threadMetadata.ts` (`setAgentThread`, `setWorkspaceThread`, `updateThreadMetadata`, metadata/thread snapshot accessors), and `threadProviderSelection.ts` (provider/connection/model getters and switch flows with diagnostics/logging). `createThreadsSlice` now composes these slices while preserving the public `chatStore` API. Marked M6.3 Task 4 and exit criteria complete. Verified with `npm test -- chatStore/threadMessages.test.ts chatStore/threadProviderSelection.test.ts` and `npm run check` (0 errors).

## 2026-06-07 23:44

- **M6.3 Task 3 (P2-10):** Split `settingsSlice.ts` into `settingsSlice.ts` (composer, `defaultSettings`, command bindings, `applyPersistedSettings`), `providerSettingsSlice.ts` (debug/HTTP providers, API keys, model catalogs), `chatModesSettingsSlice.ts` (raw/builtin/custom mode CRUD), and `logSettingsSlice.ts` (log settings mutators). `createSettingsSlice` composes all four; `appState` public API unchanged. Largest settings slice file 277 lines (≤350). M6.1 settings CRUD tests pass; `npm test` and `npm run check` pass.

## 2026-06-07 23:41

- **M6.3 Task 2 (P2-10):** Split `documentTabsSlice.ts` into `documentTabsSlice.ts` (tab lifecycle), `documentContentSlice.ts` (document mutations), and `tabTransferSlice.ts` (cross-window transfer/migration); moved shared tab helpers (`canCreateFileTabs`, `selectTabInternal`, `reopenTabForDocument`) to `tabHelpers.ts`. `createDocumentTabsSlice` composes all three; `appState` public API unchanged. Largest slice file 349 lines (≤450). `npm test` and `npm run check` pass.

## 2026-06-07 23:38

- **M6.3 Task 1 (P2-10):** Split `domain/contracts.ts` into focused modules (`document`, `workspace`, `settings`, `chat`, `commands`, `persistence`); `contracts.ts` is now a 79-line barrel re-export. Added `domain/contracts.barrel.test.ts` smoke test. Test count 920 → 923; `npm test` and `npm run check` pass.

## 2026-06-07 23:29

- **M6.2 Tasks 7–8 (P2-10):** Extracted `editorCommandRunner.ts` and view-bound search ops in `editorSearchOps.ts` from `EditorSurface.svelte` (301 lines, ≤350). Extracted tab context menu handlers to `tabContextMenuActions.ts`, `TabBarNearbySubmenu.svelte`, and `tab-context-menu.css` (281 lines, ≤350). Extracted `agentsSidebarController.ts`, `AgentSidebarRow.svelte`, and `agents-sidebar.css` from `AgentsSidebar.svelte` (220 lines, ≤400). M6.2 exit criteria satisfied; `npm test` and `npm run check` pass.

## 2026-06-07 23:24

- **M6.2 Tasks 5–6 (P2-10):** Extracted reactive side effects from `+page.svelte` into `appShellEffects.ts` (4 thin `$effect` wrappers) plus `appShellPageHandlers.ts` and `appShellDocumentView.ts` — shell route is 572 lines (≤600). Extracted `ChatModePicker`, `ChatConnectionPicker`, `composerSendActions.ts`, `composerSelectionActions.ts`, and `composerSelectionEffects.ts` from `ChatComposer.svelte` (297 lines, ≤350). `npm test` and `npm run check` pass.

## 2026-06-07 23:18

- **M6.2 Task 4 (P2-10):** Extracted `+page.svelte` handler groups into `appShellProjectTreeHandlers.ts`, `appShellAgentHandlers.ts`, `appShellLayoutHandlers.ts`, and extended `workspaceContextMenuController.ts` with `createWorkspaceContextMenuActions`. `+page.svelte` is 790 lines (≤800 target). `npm test` and `npm run check` pass.

## 2026-06-07 23:16

- **M6.2 Task 3 (P2-10):** Extracted app shell layout from `+page.svelte` into `AppShell.svelte` (ActivityRail, AgentsSidebar, TabBar, editor pane routing, ProjectPanel, ConsolePanel, FindReplacePanel, overlays). Grouped props into typed objects (`activityRail`, `agentsSidebar`, `projectTree`, `editor`, `statusBar`, `workspaceContextMenu`, `overlays`); `+page.svelte` is 1186 lines (202-line reduction). `npm test` and `npm run check` pass.

## 2026-06-07 23:13

- **M6.2 Task 2 (P2-10):** Extracted settings dialog drag/resize handlers and size measurement to `settings/settingsDialogChrome.ts`, dialog layout styles to `settingsDialogChrome.css`, and hidden measurement panels to `SettingsDialogMeasure.svelte`. `SettingsDialog.svelte` is 288 lines (≤450 target). Test count 916 → 920; `npm test` and `npm run check` pass.

## 2026-06-07 23:10

- **M6.2 Task 1 (P2-10):** Extracted settings tab panels from `SettingsDialog.svelte` into `app/src/lib/components/settings/` (`EditorSettingsPanel`, `ConnectionsSettingsPanel`, `ChatModesSettingsPanel`, `DebugProviderSettingsPanel`, `LogsSettingsPanel`, `ProviderModelCatalogPanel`); moved connection/debug parsing helpers to `settingsPanelActions.ts` and shared list styles to `settingsPanelLists.css`. Shell is 587 lines; all panels ≤331 lines. Test count 908 → 916; `npm test` and `npm run check` pass.

## 2026-06-07 23:06

- **M6.1 Tasks 7–8 (P2-10) complete:** Extracted `settingsPanelActions.ts` (external-files KB normalization, connection/mode list selection, required-section mutations) and `workspaceContextMenuController.ts` (close-workspace prompt flow, reorder bounds) with unit tests; wired into `SettingsDialog.svelte` and `+page.svelte`. Fixed pre-existing `svelte-check` errors in M6.1 test files and `TabBarContextMenu.svelte`. Test count 873 → 908; `npm test` and `npm run check` pass. M6.1 exit criteria satisfied.

## 2026-06-07 22:52

- **M6.1 Tasks 5–6 (P2-10):** Added `closeTabFlow.test.ts` and `tabContextMenuActions.ts` (+ tests) for unsaved-close flows and tab context menu capability helpers; extracted `editorLineOps.ts` and `editorSearchOps.ts` from `EditorSurface` with unit tests. Test count 846 → 873.

## 2026-06-07 22:49

- **M6.1 Tasks 3–4 (P2-10):** Added `threadMessages.test.ts` and `threadProviderSelection.test.ts` covering `updateMessageContent`, `removeMessage`, `compactActiveThread`, and `switchThreadConnection` via public `chatStore` APIs.
- Extended `registry.test.ts` with dispatch tests for all previously untested command handlers (file open/recent/save-as/rename/reload, app toggles, edit/view commands, tab navigation); test count 779 → 846.

## 2026-06-07 22:41

- **M6.1 Tasks 1–2 (P2-10):** Added `settingsSlice.test.ts` covering HTTP connection CRUD, chat mode mutators, debug provider patches, and provider catalog/API key updates via public `appState` APIs.
- Added `documentTabsSlice.test.ts` for `migrateNotepadFileTabToWorkspace` (move, duplicate-focus, guard paths) and `renameDocument` behavior; marked M6.1 Tasks 1–2 done in execution plan.

## 2026-06-07 22:30

- Added M6.1 pre-refactor test coverage sub-milestone ([execution-plan-m6-1-test-coverage.md](./ops/phase-2/execution-plan-m6-1-test-coverage.md)) as the first M6 step before production refactors.
- Renamed M6 sub-plans to numbered sub-milestones (M6.1 tests, M6.2 UI, M6.3 state, M6.4 platform); updated parent plan, phase-2 links, and execution order (M6.1 → M6.2 ∥ M6.3 → M6.4).

## 2026-06-07 22:10

- Fixed chats/workspace interaction regressions in app shell by removing debug-only instrumentation from `+page.svelte`, `AgentsSidebar.svelte`, and `ChatPanel.svelte` after validation.
- Preserved behavior fixes: reliable sidebar toggle/new-chat pointer handling in `AgentsSidebar` and agent id counter synchronization in chat store to prevent duplicate-key crashes when creating chats.

## 2026-06-07 22:00

- Added M6 execution plan for behavior-preserving codebase refactoring: parent [execution-plan-m6-refactoring.md](./ops/phase-2/execution-plan-m6-refactoring.md) plus sub-plans [M6-UI](./ops/phase-2/execution-plan-m6-ui-refactoring.md), [M6-State](./ops/phase-2/execution-plan-m6-state-refactoring.md), and [M6-Platform](./ops/phase-2/execution-plan-m6-platform-refactoring.md).
- Documented 2026-06-07 audit findings (tier 1–3 oversized files) with task breakdowns covering settings dialog, app shell, state slices, commands, services, domain types, and large test splits.
- Updated [phase-2.md](./ops/phase-2/phase-2.md) with M6 milestone summary and P2-10 task id.

## 2026-06-07 21:26

- Fixed chat/workspace agents sidebar collapse behavior in app shell: chat now honors manual sidebar collapse state, and toggle behavior is no longer misleading while responsive auto-collapse is active.
- Added disabled-state UX for the agents sidebar collapse button when auto-collapse is enforced by viewport width, including a tooltip hint to expand the window.
- Tightened collapsed agents sidebar header/button layout styles to prevent visual overflow into the tab strip area.
- Added responsive layout regression coverage for agents sidebar auto-collapse behavior outside workspace context.

## 2026-06-07 20:17

- **M5 Task 7 (P2-9):** Finalized custom chat modes validation and documentation by extending milestone tests for chat-http/custom-mode coverage and resolving a test-run unhandled persistence side effect in `chatM6-4.validation.test.ts` via chat persistence mocking.
- Verified milestone quality gate from `app/`: `npm test` and `npm run check` pass (with one pre-existing Svelte accessibility warning in `EntryNamePrompt.svelte`).
- Marked M5 Task 7 and Milestone 5 exit criteria complete in execution docs; updated phase-2 milestone table to reflect M5 done.

## 2026-06-07 20:10

- **M5 Tasks 5–6 (P2-9):** Unified mode availability across workspace and chat-http composers by removing ask-only chat-http filtering/coercion, deriving selectable modes from settings resolver, and auto-falling back in UI when a stale disabled mode is present.
- Removed chat-http mode normalization to Ask from thread scope/load/store paths so persisted Review/custom modes are preserved and sent as selected.
- Extended HTTP/Debug provider capability mode support to resolver-driven dynamic mode ids (including `raw` and enabled custom modes), updated unsupported-mode recovery copy to point users to Settings → Chats → Chat modes, and refreshed provider/store validation tests accordingly.

## 2026-06-07 19:58

- **M5 Task 4 (P2-9):** Added Settings → Chats → Chat modes tab with built-in mode cards (Ask/Review/Raw) showing read-only prompt templates, required sections, editable context toggles, and Raw enable control.
- Added custom mode management UI in settings: add/select/remove/enable, mode name and prompt editor with `{{workspace}}` / `{{summary}}` hint, include-workspace/include-summary toggles, optional section guidance, and ordered required-sections editor (add/remove/reorder).
- Registered `openSettingsDialog("chatModes")` deep-link support and updated settings tab/sidebar definitions and tests for the new tab layout.

## 2026-06-07 19:45

- **M5 Task 3 (P2-9):** Generalized structured assistant message parsing from Review-only behavior to mode-driven `requiredSections` with case-insensitive heading matching.
- Updated chat UI wiring so `ChatPanel` resolves the active mode and passes `requiredSections` to `ChatMessageList`, which now renders section cards for any structured mode while preserving streaming plain-text behavior until completion.
- Expanded parser tests to cover arbitrary section lists, case-insensitive matches, and conversational fallback behavior.

## 2026-06-07 19:40

- **M5 Task 2 (P2-9):** Reworked prompt assembly to resolve mode system text from settings-driven mode definitions with `{{workspace}}` / `{{summary}}` placeholders, per-mode toggles, structured required-section instructions, chat-http workspace label handling (`Workspace: Chats (chat-http)`), and pre-resolved provider payload system prompts.
- Refactored send path to build provider payloads from resolved mode context and removed hardcoded workspace/summary appends from OpenAI message assembly.
- Expanded mode prompt tests to cover Ask toggle-off behavior, custom placeholder substitution, Review required sections, and Raw persona-free output.

## 2026-06-07 19:30

- **M5 Task 1 (P2-9):** Custom chat mode schema, settings persistence, and resolver — widened `ChatModeId`, added `ChatModesSettings` / `ResolvedChatMode`, built-in Raw mode definition, preset custom modes in defaults, settings slice CRUD helpers, `resolveChatMode` / `listSelectableChatModes`, and thread mode parse normalization.

## 2026-06-07 16:30

- Renamed M5 execution plan to [execution-plan-m5-custom-modes.md](./ops/phase-2/execution-plan-m5-custom-modes.md) (was `execution-plan-m4-custom-modes.md`).
- Updated [phase-2.md](./ops/phase-2/phase-2.md) with M5 milestone summary and P2-9 task id.

## 2026-06-07

- Added verbose provider logging: full request/response payloads are written to the console when enabled (default on). Toggle in Settings → Logging → Logs.
- Added Settings sidebar section **Logging** with a **Verbose provider logging** option.
- Chat composer clears the input immediately on send and appends the user message before async validation, so messages appear in the thread without waiting for preflight.
