# Changelog

## 2026-05-30 (MSK)

- **Markdown view mode persistence:** Each markdown file remembers its edit/split/preview mode per document. Mode restores when switching tabs and is saved in the session snapshot between app restarts.

- **Markdown preview links:** External `http`/`https`/`mailto`/`tel` links open in the system browser via `tauri-plugin-opener`; relative and `file:` links resolve against the open markdown file and open in the editor. In-webview navigation is blocked on all markdown preview surfaces.

## 2026-05-28 22:30 (MSK)

- **M6-5 — AI chat MVP ship:** Ran full validation suite (`npm test` 436 tests, `npm run check` clean, `cargo test` 5 tests). Added `chatM6-5.validation.test.ts` covering M6 exit criteria — retry on Debug/GLM, streaming vs buffered fallback, recovery copy, compaction + delete agent, concurrent multi-agent generation. Updated README to reflect shipped MVP scope. Marked M6-5 complete in execution plan.
- **AI chat MVP ships at M6 completion.** Scope: workspace agents sidebar + agent tabs, Ask/Review modes, GLM production provider, Debug for development, retry, streaming fallback, error/recovery copy, retention compaction, delete agent. Known follow-ups: optional Cursor SDK (`specs/ai-m-extra-1-execution-plan.md`), agent list subtitles, custom modes.

## 2026-05-28 22:25 (MSK)

- **M6-4 — Edge-case UX polish:** Added workspace-scoped generation cancellation (`cancelAgentGeneration`, `cancelAllGenerations`) wired on workspace switch and agent tab close so `isGenerating` never sticks after transitions. Send pipeline updates and completes turns against the originating workspace root and stops cleanly when cancelled mid-stream. Provider switch clears failed-turn retry state. Review mode renders structured section headings for long responses; compaction banner copy/styling improved; agent tab layout stays scrollable at narrow widths with responsive panel/sidebar collapse. Added `chatReviewContent`, `chatM6-4.validation.test.ts`. Marked M6-4 complete in execution plan.

## 2026-05-28 22:20 (MSK)

- **M6-3 — Error copy and recovery guidance polish:** Centralized user-facing chat error copy in `chatErrorCopy.ts` for missing provider config, workspace access blocked, provider request failure, and mode/provider incompatibility. `ChatPanel` shows consistent titles, messages, and recovery hints (including Retry guidance for failed turns); Debug blocked state adds a settings CTA. Send pipeline sanitizes unexpected provider errors so raw stack traces never reach the UI. Updated GLM/Debug/capability checker and chatStore copy. Added `chatErrorCopy.test.ts`. Marked M6-3 complete in execution plan.

## 2026-05-28 22:05 (MSK)

- **M6-2 — Streaming response support:** Send pipeline uses `streamProviderMessage` to append partial assistant content via `chatStore.updateMessageContent` during generation and finalize on completion. Debug provider streams simulated chunks; GLM and other buffered-only providers fall back to `sendMessage` with a single content update. Persistence writes the final message once after the turn completes (no partial persist thrash). Added `chatSend.test.ts` for adapter streaming/fallback coverage and send-pipeline tests for persist-after-stream and GLM buffered fallback. Marked M6-2 complete in execution plan.

## 2026-05-28 22:00 (MSK)

- **M6-1 — Retry last turn:** Added `retryLastChatTurn()` to resend the last user message through the current provider without duplicating the user turn. Wired **Retry** in `ChatPanel` when a failed turn exists (disabled while generating). Successful retry clears failure runtime state and appends a system note preserving the previous error. Added retry pipeline unit tests for Debug and GLM paths. Marked M6-1 complete in execution plan.

## 2026-05-28 21:15 (MSK)

- **M5-3-3 — Milestone validation:** Added `chatM5-3.validation.test.ts` covering M5.3 exit criteria — Debug/GLM access preflight pass/fail, per-agent generation lock, concurrent Debug+GLM sends, streaming finalize, failure retry scaffolding, GLM review mode, provider switch persistence, and workspace access blocks. Documented manual smoke checklist and optional GLM integration env requirements. Ran `npm test` (410 tests) and `npm run check` (clean). Marked M5.3 execution plan complete.

## 2026-05-28 21:00 (MSK)

- **M5-3-2 — GLM provider adapter:** Added `GlmChatProvider` with OpenAI-compatible `/chat/completions` calls, shared prompt assembly (`buildGlmChatMessages`), capability checks, and user-facing `ChatProviderError` mapping. Registered GLM in provider bootstrap; capability checker delegates to the adapter when credentials are configured. Buffered send path only (streaming deferred to M7). Unit tests with mock fetch for adapter, registry checker, and send pipeline.

## 2026-05-28 20:12 (MSK)

- **M5-3-1 — GLM settings and config UI:** Added `GlmProviderSettings` (enabled, base URL, model ID) to persisted settings; API key stored separately in `glm-secrets.json` (never in `settings.json`, chat threads, or Debug diagnostics). New **GLM** tab in Settings; inline setup CTA in `ChatPanel` when GLM is selected but credentials are missing. Capability preflight and send pipeline block unconfigured GLM with actionable hints. Unit tests for settings normalization and secrets store.

## 2026-05-28 18:05 (MSK)

- **M5-2-8 — Milestone validation:** Added `chatM5-2.validation.test.ts` covering M5.2 exit criteria (draft lifecycle, parallel Debug generation, date grouping and title search, delete agent, session restore, close-tab navigation, console height-only prefs). Ran `npm test` (377 tests) and `npm run check` (clean). Marked M5.2 execution plan complete.

## 2026-05-28 17:30 (MSK)

- **M5-2-7 — Console logs-only:** Removed Chat tab from `ConsolePanel`; console shows `ConsoleLogsPanel` only. Dropped console chat tab preference persistence (`tabsByWorkspaceKey`, `ConsoleTabId`, workspace tab read/write). Removed `+page.svelte` wiring for console tab selection and chat-gated preflight on console tab. Access monitor comment updated for agent-tab context. Trimmed `consoleTabPrefs` tests to height persistence only.

## 2026-05-28 17:12 (MSK)

- **M5-2-6 — Session restore and sidebar ↔ tab sync:** Added `lastActiveAgentId` to workspace session state. On workspace enter, restore open agent tabs (including session-only drafts via `mergeSessionDraftAgents`), focus last active agent when it still exists, otherwise clear sidebar selection without auto-opening another. Close agent tab: next open agent tab in bar order, else next sidebar row (highlight only), else clear selection. `TabBar` uses `onCloseTab` for agent navigation. Unit tests for routing helpers, restore resolution, merge drafts, and close-tab order.

## 2026-05-28 17:05 (MSK)

- **M5-2-5 — Agent tabs and editor routing:** Agent tabs in `TabBar` use accent styling and titles from the workspace agent index. Editor pane shows `ChatPanel` when an agent tab is selected (file tabs unchanged). Chat access preflight and polling run on agent tab activation instead of the console Chat tab. Replaced “Clear workspace chat history” with **Delete agent** in chat chrome. Added `editorRouting.ts` unit tests.

## 2026-05-28 16:26 (MSK)

- **M5-2-4 — Agents sidebar UI:** Added `AgentsSidebar.svelte` (search, New agent, date-grouped list, selection highlight, delete via context menu, resize/collapse). Integrated into shell grid to the right of the project panel; hidden outside workspace context. Wired `openOrFocusAgentTab` / `closeTabsForAgent` in `appState` and sidebar handlers to `chatStore`. Added `chatAgentIndex` and `chatActiveAgentId` derived stores.

## 2026-05-28 16:16 (MSK)

- **M5-2-3 — Draft agent lifecycle:** Added `chatStore.createDraftAgent`, `isAgentDraft`, and `getAgentTitle`. Drafts live in the in-memory agent index only (no thread file) until the first user message; `appendMessage` and `sendChatMessage` promote the draft (title from first line, `isDraft` cleared, `lastUsedAt` updated). Persistence is skipped until a user message exists. Unit tests for multiple drafts, promotion, and first-send persist.

## 2026-05-28 15:56 (MSK)

- **M5-2-2 — chatStore per-agent refactor:** Refactored `chatStore` to `threadsByAgentId`, `runtimeByAgentId`, `activeAgentId`, and in-memory workspace agent index per root. Mutations, turn lifecycle, provider switch, and `deleteAgent` target agent id; generation lock is per agent. `sendChatMessage` accepts optional `agentId`. Removed `INTERIM_WORKSPACE_AGENT_ID` bridge. Added unit tests for parallel runtime, active-agent switching, and delete agent.

## 2026-05-28 15:25 (MSK)

- **M5-2-1 — Multi-agent contracts and persistence:** Added per-agent types (`AgentIndexEntry`, `WorkspaceAgentsIndexSnapshot`, `ChatAgentThreadFileSnapshot`), `agentId`/`threadId` on `ChatThreadMetadata`, and `TabState` discriminated union (`file` | `agent`). Replaced single workspace chat file with `chat/{hash}/index.json` plus per-agent `{agentId}.json` thread files. Added `chatAgents.ts` helpers (title derivation, date grouping). Updated persistence callers to use interim single-agent bridge until M5-2-2. Unit tests for title truncation, date grouping, index read/write, and per-agent thread read/write.

## 2026-05-28 14:30 (MSK)

- **AI agents pivot — specs:** Rewrote `specs/ai-requirements.md` for agents sidebar + agent tabs (multi-agent per workspace, draft-on-first-message lifecycle, delete agent, logs-only console). Split M5 execution plan into `specs/ai-m-5-1-execution-plan.md` (completed Debug/provider foundation), `specs/ai-m-5-2-execution-plan.md` (Agents UI shell, 8 tasks), and `specs/ai-m-5-3-execution-plan.md` (GLM in agent tabs). Removed `specs/ai-m-5-execution-plan.md`. Updated `specs/ai-m-6-execution-plan.md` and `specs/ai-m-7-execution-plan.md` for agent-tab UX. Updated README WIP roadmap.

## 2026-05-28 11:45 (MSK)

- **Build warnings:** Fixed Svelte a11y warnings in `FindReplacePanel.svelte` (use `<search>` with programmatic keydown) and `SettingsDialog.svelte` (`div` instead of `nav` for tablist). Split settings CSS into `settingsForm.css`, `settingsDialogForm.css`, and `themePaneForm.css` so scoped imports no longer report unused selectors.

## 2026-05-28 (release)

- **Version 0.2.0:** Bumped app version in `package.json`, `Cargo.toml`, and `tauri.conf.json`.

## 2026-05-28 09:15 (MSK)

- **Themes T5:** `cycleTheme` flips `dark-amber` ↔ `light-blue` by current `data-theme` mode (from built-in or custom); clears custom selection. Menu/command wiring unchanged (`Meta+Shift+T`, View → Cycle Theme). `settingsStore.test.ts` documents that theme tests live in `themeStore.test.ts`; legacy `theme` field still ignored on load.
- **Themes T6:** Scrollbar colors use CSS vars (`scrollbar-track`, `scrollbar-thumb`, `scrollbar-thumb-hover`) — 26 tokens total; customs can theme scrollbars. Unit tests green (`themes`, `themeStore`, `appState`, `settingsStore`). Manual checklist: clone from each built-in, edit bg/accent, restart persistence, delete custom, legacy `settings.json` `theme` → `theme.json` migration — verified via unit tests and code review.

## 2026-05-28 09:12 (MSK)

- **Themes T4:** Full `ThemePane.svelte` UI — built-in radios with accent swatches, **+ New theme**, scrollable **Your themes** custom list, rename/delete controls, grouped token editor (color picker + CSS text field per token, all 23 keys); shared button/token row styles in `settingsForm.css`.

## 2026-05-28 09:10 (MSK)

- **Themes T3:** App state theme APIs and startup wiring — `AppThemeState` on domain state (`activeTheme`, `customThemes`); `setActiveTheme`, `createCustomTheme`, `renameCustomTheme`, `deleteCustomTheme`, `updateCustomThemeToken` (debounced save); `loadTheme()` at startup from `theme.json`; save-failure toast via `setThemeSaveErrorNotifier`; removed `theme` from `settings.json` / `PersistedSettings`; updated `ThemePane`, `+page.svelte`, and tests.

## 2026-05-28 09:05 (MSK)

- **Themes T2:** Added `themeStore.ts` and `themeStore.test.ts` — `theme.json` v1 schema (`activeTheme`, `customThemes`), load/save with token normalization (all 23 keys), one-time migration from `settings.json` when `theme.json` is missing (`dark-*` → `dark-amber`, `light-*` → `light-blue`).

## 2026-05-28 09:00 (MSK)

- **Themes T1:** Added `app/src/lib/styles/themeTokens.ts` — 23-token catalog with labels/groups, two built-ins (`dark-amber`, `light-blue`), `resolveBuiltinTokens`, `applyBuiltinTheme`, `applyCustomTheme`, `clearThemeOverrides`, `snapshotThemeTokens`, and legacy theme id normalization. Refactored `themes.ts` to thin re-exports; expanded `themes.test.ts`. Default persisted theme is `dark-amber`; settings load maps legacy `dark-*` / `light-*` ids to built-ins.

## 2026-05-27 24:00 (MSK)

- **Themes execution plan:** Added `specs/themes-execution-plan.md` (tasks T1–T6) from `specs/themes-plan.md` with all recommended clarification answers locked.

## 2026-05-27 23:45 (MSK)

- **Themes plan:** Added `specs/themes-plan.md` — two built-in themes, full-token custom themes, `theme.json` persistence, ThemePane UX, implementation checklist, and numbered clarification questions.

## 2026-05-27 23:00 (MSK)

- **Markdown split view:** Fixed post-scroll drift by syncing only user-initiated scroll events (`isTrusted`); programmatic sync no longer bounces between editor and preview panes.

## 2026-05-27 22:30 (MSK)

- **README:** Removed all references to `specs/` and internal milestone IDs; WIP roadmap rewritten in plain product terms.

## 2026-05-27 22:15 (MSK)

- **README:** Reframed SpecOps as a workspace-oriented desktop app (notepad, project panel, workspaces, console). Added main-screen screenshot, app icon in title, current-features list, and WIP roadmap from `specs/ai-requirements.md`.

## 2026-05-27 (fix)

- **Fix Debug provider preflight:** `chatStore.getActiveChatProvider()` resolves thread provider or bootstrap default; preflight and send pipeline no longer fall back to hardcoded `glm` when thread metadata is missing. `ChatPanel` re-runs access preflight when effective provider or Debug settings change; provider/mode pickers stay enabled while blocked so users can switch to Debug.

## 2026-05-27 21:00 (MSK)

- **Settings dialog:** Initial size measured to fit **Debug AI** without scrolling; tab switches keep fixed dimensions; bottom-right resize with min size equal to initial measured width/height; body scrolls only when content overflows after resize.

## 2026-05-27 20:35 (MSK)

- **Settings dialog:** Renamed **AI** tab to **Debug AI** (Debug provider settings only). Tabs moved to a fixed-width left sidebar column; panel content scrolls on the right.

## 2026-05-27 19:15 (MSK)

- **Settings split:** Toolbar **Theme** button opens a scrollable side pane (themes + decoration only). Full **Settings** dialog with **Editor** and **AI** tabs opens from **SpecOps → Settings** (macOS), **File → Settings…** (Windows/Linux), and `Cmd/Ctrl+,`.
- **Components:** Added `ThemePane.svelte`, `SettingsDialog.svelte`, and shared `settingsForm.css`.

## 2026-05-27 18:30 (MSK)

- **Console UX:** Vertically resizable console (drag handle, double-click reset, height persisted in `console-tab-prefs.json`). Console and status bar moved into the editor column so chat aligns with the text area; shared `--editor-content-padding-x` with the editor pane.
- **Chat UX:** Grid layout fixes mode/provider chrome clipping; provider picker is a dropdown; empty-state copy updated.
- **Debug provider:** Enabled by default in `defaultDebugProviderSettings` for dogfooding.
- **Branding:** User-visible app name unified to **SpecOps** (window title, About menu, Tauri `productName`, web title, release name).
- **Activity rail:** Fast custom `HoverTooltip` (folder name + full path) on workspace and rail buttons.

## 2026-05-27 17:10 (MSK)

- **App icon:** Replaced the orange spec-ops icon with the cyan variant from `spec-ops-cyan-app-icon.png`. Source glyph upscaled (LANCZOS) onto a 1024×1024 transparent canvas at the same ~86.5% fill ratio as the previous icon so macOS dock size stays consistent. Regenerated all Tauri bundle icons (`icon.icns`, `icon.ico`, platform PNGs) and updated `app/static/favicon.png`.

## 2026-05-26 21:50 (MSK)

- **AI M5-6 provider/mode selection UI:** Added provider picker to `ChatPanel.svelte` with Debug gated by Developer Settings; mode options filter by active provider capabilities; provider/mode controls disable while generating.
- **Provider selection helpers:** Added `app/src/lib/ai/providers/selection.ts` with selectable provider list, default precedence (GLM when configured → Debug when enabled → GLM fallback), and switch notice formatting.
- **AI M5-7 provider switch events:** Added `chatStore.switchThreadProvider()` to persist provider metadata, append `provider-switched` system messages, block Debug when disabled, and prevent switches during generation; distinct system-event rendering in chat history.
- **Bootstrap:** Wired default new-thread provider resolver via `setDefaultChatProviderResolver()`.
- **Tests:** Added `selection.test.ts` and `chatStore` provider-switch coverage; full `npm test` (304 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-6` and `Task M5-7` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:41 (MSK)

- **AI M5-5 chat send pipeline:** Added `sendChatMessage()` orchestrating access preflight, user append, `beginTurn()`, provider streaming/buffered send, incremental assistant updates, `completeTurn()` / `failTurn()`, post-turn compaction, and single persist per completed turn.
- **Chat store streaming support:** Added `updateMessageContent()`, `removeMessage()`, `compactActiveThread()`, and `skipCompaction` option on `appendMessage()` for streaming without partial persist thrash.
- **Chat UI:** Wired `ChatPanel` to the send pipeline; composer disables while generating; streaming assistant placeholder/partial content visible; inline error on failure (retry deferred to M7).
- **Tests:** Added `sendChatMessage.test.ts` covering Debug ask/review E2E, streaming partial updates, generation lock, failure scaffolding, and preflight blocking; full `npm test` (297 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-5` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:34 (MSK)

- **AI M5-4 Debug provider adapter:** Added `DebugChatProvider` with settings-gated `checkCapabilities()`, seeded simulation (`debugSimulation.ts`), structured ask/review responses, optional diagnostics appendix, buffered `sendMessage()`, and chunked `streamMessage()` with configurable delay/failure.
- **Provider bootstrap:** Added registry-backed capability checker (`capabilityChecker.ts`), provider registration/bootstrap wired at app startup, and `streamProviderMessage()` helper in `chatSend.ts` for send-pipeline integration (M5-5).
- **Errors:** Added `ChatProviderError` for simulated provider failures mapped to `failTurn` scaffolding.
- **Tests:** Added `debugChatProvider.test.ts` and `capabilityChecker.test.ts` covering deterministic seeded simulation, review template shape, diagnostics toggle, streaming chunks, and failTurn wiring; full `npm test` (291 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-4` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:15 (MSK)

- **AI M5-3 Developer Settings:** Added `DebugProviderSettings` to persisted settings and `AppSettingsState` with safe defaults (`enabled: false`, `failureProbability: 0`); validation/clamping via `normalizeDebugProviderSettings()` on load/save.
- **Developer Settings UI:** Added grouped Debug provider section in settings pane (Enable · Simulation · Output) with seed, delay/chunk ranges, failure probability/message, and diagnostics toggle.
- **Debug send blocking:** When thread metadata has `provider: "debug"` but Debug is disabled, chat send is blocked with a recovery hint pointing to Developer Settings (no auto-switch).
- **Tests:** Added `debugProviderSettings.test.ts` and extended `settingsStore.test.ts` for defaults, range normalization, and send-block helpers; full `npm test` (278 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-3` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:11 (MSK)

- **AI M5-2 built-in modes:** Added `app/src/lib/ai/modes/builtins.ts` with `ask` and `review` system prompt templates, mode registry (`id`, `label`, `outputStyle`), review section requirements, and T-shirt size + confidence wording enforcement.
- **Shared prompt assembly:** Added `app/src/lib/ai/modes/prompt.ts` with `buildThreadProviderRequest()` so Debug diagnostics and GLM adapter input share identical mode-aware payloads from M5-1 helpers.
- **Chat UI:** Wired segmented Ask/Review mode control in `ChatPanel.svelte`; selection persists via thread metadata and disables while generating.
- **Chat store:** `updateThreadMetadata()` now creates an empty thread when mode is selected before the first message.
- **Tests:** Added `builtins.test.ts` for mode registry and prompt assembly; extended `chatStore.test.ts` for pre-message mode persistence; full `npm test` (268 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-2` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 20:59 (MSK)

- **AI M5-1 provider abstraction:** Added `app/src/lib/ai/providers/types.ts` with `ChatProvider` contract (buffered `sendMessage`, optional `streamMessage`, `checkCapabilities`), request/response DTOs, and shared `buildProviderRequest()` / `buildProviderRequestFromThread()` for mode-aware prompt payload assembly.
- **Provider registry:** Added `app/src/lib/ai/providers/registry.ts` for register/resolve/list of active providers.
- **Debug provider id:** Extended `ChatProviderId` with `"debug"` and `PRODUCT_CHAT_PROVIDER_IDS`; updated chat persistence validation.
- **Tests:** Added `providers.test.ts` with in-memory test double covering buffered/streaming paths and registry resolution; full `npm test` (260 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-1` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 (planning)

- **AI M5 execution plan rewrite:** Reordered `specs/ai-m-5-execution-plan.md` so Debug provider ships before GLM. Added Developer Settings (`DebugProviderSettings`), streaming simulation (random delay + chunked tokens), structured review templates, diagnostics appendix, and failure probability. Expanded to 10 tasks (M5-1–M5-10); GLM settings/adapter moved to M5-8/M5-9; milestone validation to M5-10. Updated Milestone 5 summary in `specs/ai-requirements.md`.

## 2026-05-26 17:42 (MSK)

- **AI M4-7 milestone validation:** Added `app/src/lib/state/chatM4.validation.test.ts` covering M4 exit criteria: FIFO cap overflow bounds, compaction summary/metadata updates, prompt-context shape, clear-history isolation, and retry scaffolding without provider coupling.
- **Validation run:** Full `npm test` (31 files, 251 tests passed) and `npm run check` (0 errors; 1 pre-existing `FindReplacePanel.svelte` a11y warning unchanged).
- **Manual smoke checklist (M4 exit):**
  - Long conversation append triggers FIFO compaction; compaction banner shows compacted message count.
  - Clear workspace chat history returns to empty state and persists after restart.
  - Retry hooks (`beginTurn` / `failTurn` / `canRetryLastTurn`) available without provider integration.
- **Specs tracking:** Marked `Task M4-7` as done in `specs/ai-m-4-execution-plan.md`. Milestone 4 complete.

## 2026-05-26 17:45 (MSK)

- **AI M4-5 retry scaffolding:** Added per-workspace ephemeral runtime state in `chatStore` (`isGenerating`, `lastFailedTurnId`, `lastError`) with provider hooks `beginTurn()`, `completeTurn()`, `failTurn()`, and `canRetryLastTurn()`; runtime resets on clear history.
- **AI M4-6 compaction indicator:** Added persistent thread banner in `ChatPanel.svelte` when `compactedMessageCount > 0`, using `formatCompactionNotice()` copy (e.g. "24 older messages compacted").
- **Tests:** Added chatStore turn lifecycle, workspace-scoped failure retention, clear-reset, and compaction notice formatting coverage; full `npm test` and `npm run check` pass.
- **Specs tracking:** Marked `Task M4-5` and `Task M4-6` as done in `specs/ai-m-4-execution-plan.md`.

## 2026-05-26 17:34 (MSK)

- **AI M4-3 compaction summary:** Extended `ChatThreadMetadata` with `compactionCount`, `lastCompactedAt`, and `compactedMessageCount`; on FIFO truncation, `compactChatThread()` now appends structured user/assistant bullet summaries and updates compaction metadata.
- **Prompt context helper:** Added `buildThreadPromptContext()` in `chatRetention.ts` for future M5 prompt assembly (summary + recent messages).
- **AI M4-4 clear history:** Added `clearWorkspaceChatFileSnapshot()` and `chatStore.clearActiveWorkspaceChatHistory()` to reset in-memory thread and persist an empty workspace chat file; added confirm-gated "Clear workspace chat history" action in `ChatPanel.svelte`.
- **Tests:** Added summary append, clear/idempotency, and workspace-isolation coverage in `chatRetention.test.ts`, `chatPersistence.test.ts`, and `chatStore.test.ts`; full `npm test` (241 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M4-3` and `Task M4-4` as done in `specs/ai-m-4-execution-plan.md`.

## 2026-05-26 14:43 (MSK)

- **AI M4-1 retention policy:** Added `CHAT_RETENTION_MAX_TURNS` (50), `countConversationTurns()`, and `needsChatCompaction()` in `app/src/lib/services/chatPersistence.ts` with policy comments cross-referencing `specs/ai-requirements.md`.
- **AI M4-2 FIFO compaction:** Added `app/src/lib/services/chatRetention.ts` with turn-based FIFO truncation (oldest user/assistant turns and plain system notices droppable; provider `systemEvent` markers preserved); wired compaction into `chatStore.appendMessage()` after each append.
- **Tests:** Added `chatPersistence.retention.test.ts`, `chatRetention.test.ts`, and chatStore compaction integration coverage; full `npm test` (233 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M4-1` and `Task M4-2` as done in `specs/ai-m-4-execution-plan.md`.

## 2026-05-26 14:15 (MSK)

- **AI M3-5 mid-session access loss:** Extended `chatStore.runAccessPreflight()` to detect `ready` → `blocked` transitions for `workspace_path_inaccessible`, append a system message in the active thread, and reject further user sends while blocked without clearing history.
- **Access monitoring:** Added `chatAccessMonitor.ts` with conservative Chat-tab polling (`15s`) and wired `+page.svelte` to start/stop monitoring when the console Chat tab is active; project-tree root reload probes inaccessible roots and re-runs preflight.
- **Lightweight probe:** Added `probeWorkspaceReadAccess()` in `fileSystem.ts` (readDir-only, no persistence) for FS hooks and tree refresh triggers.
- **AI M3-6 validation:** Added `capabilities.test.ts`, `chatAccessMonitor.test.ts`, expanded `chatStore.test.ts` and `fileSystem.test.ts` for access-loss transitions; full `npm test` and `npm run check` pass.
- **Manual smoke (M3 exit):** Accessible workspace shows blocked composer with stub checker; simulated inaccessible root blocks sends, keeps history read-only, shows recovery banner + system loss message after prior ready state.
- **Specs tracking:** Marked `Task M3-5` and `Task M3-6` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 13:32 (MSK)

- **AI M3-4 blocked chat UI:** Updated `app/src/lib/components/ChatPanel.svelte` to consume reactive `chatAccessState`, disable composer/send when access is blocked, and render a visible inline blocked-state message (`AI cannot read files in this workspace`) with reason-specific copy and recovery guidance.
- **Reason-aware messaging:** Added blocked-state message mapping for `workspace_path_inaccessible`, `missing_provider_config`, and `provider_unsupported`, with fallback text for unknown blocked cases.
- **Behavior gating:** `submitMessage` now hard-blocks sends while access is blocked, and textarea/button disabled state follows blocked state directly.
- **Tests:** Added `app/src/lib/components/ChatPanel.test.ts` covering blocked-state disablement/message visibility and ready-state composer enablement.
- **Specs tracking:** Marked `Task M3-4` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 13:05 (MSK)

- **AI M3-3 preflight orchestrator:** Extended `app/src/lib/state/chatStore.ts` with runtime access preflight orchestration (`runAccessPreflight`) that composes workspace access checks (`ensureWorkspaceReadAccess`) with provider capability checks and stores per-workspace chat access outcomes.
- **Stub capability checker:** Added a deterministic built-in capability checker fallback in `chatStore` that returns a blocked `provider_unsupported` state until real provider integrations land, while preserving `setCapabilityChecker` for future real provider wiring.
- **Reactive access state:** Added `ChatAccessState` and reactive `chatAccessState` export in `chatStore` plus imperative `getChatAccessState()` for UI consumption and upcoming blocked-state UX wiring.
- **Preflight triggers:** Updated `app/src/routes/+page.svelte` to run chat preflight on workspace activation, on Chat tab selection, and when opening the console directly into Chat.
- **Tests:** Expanded `app/src/lib/state/chatStore.test.ts` with M3-3 coverage for blocked workspace-path preflight and deterministic stub-checker blocked preflight behavior.
- **Specs tracking:** Marked `Task M3-3` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 09:45 (MSK)

- **AI M3-2 workspace access preparation:** Added `ensureWorkspaceReadAccess(rootPath)` and access snapshot persistence in `app/src/lib/services/fileSystem.ts`; successful checks return `ready`, inaccessible roots return `blocked`, and diagnostics are emitted via `logDiagnostic`.
- **Allowed roots persistence:** Added `workspace-access.json` handling in app data (`readAllowedWorkspaceRoots`, internal read/write helpers) to persist normalized workspace roots that pass read-access preparation.
- **Workspace add/open wiring:** Updated `workspace.add` command in `app/src/lib/commands/registry.ts` to enforce access preparation before adding a workspace and show actionable blocked messaging; updated `app/src/routes/+page.svelte` to run access preparation on restored workspace activation and workspace switch.
- **Tests:** Extended `app/src/lib/services/fileSystem.test.ts` and `app/src/lib/commands/registry.test.ts` to cover ready/blocked access checks, diagnostics logging on failure, persisted allowed roots parsing, and blocked workspace-add flow.
- **Specs tracking:** Marked `Task M3-2` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 09:13 (MSK)

- **AI M3-1 capability contract:** Added provider-agnostic capability types and checker interface in `app/src/lib/ai/capabilities.ts`: `WorkspaceAccessStatus`, `WorkspaceAccessReason` codes (`missing_provider_config`, `workspace_path_inaccessible`, `provider_unsupported`), `ProviderCapabilities`, `CapabilityCheckResult`, and `CapabilityChecker`.
- **Chat runtime preflight import point:** Updated `app/src/lib/state/chatStore.ts` to import and use the capability contract via `setCapabilityChecker(...)` and `checkActiveWorkspaceCapabilities()`, making capability checks callable from chat runtime flow.
- **Tests:** Extended `app/src/lib/state/chatStore.test.ts` with coverage for unknown-state fallback and configured checker invocation/return path.
- **Specs tracking:** Marked `Task M3-1` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-25 23:20 (MSK)

- **AI M2-6 milestone validation:** Completed full Milestone 2 validation run in `app` with `npm test` (26 files, 208 tests passed) and `npm run check` (0 errors; 1 pre-existing `FindReplacePanel.svelte` a11y warning unchanged).
- **M2 coverage status:** Added/validated dedicated tests for codec + store + workspace isolation (`chatPersistence.test.ts`, `chatStore.test.ts`) and confirmed M2-2..M2-5 acceptance behavior remains green in the full suite.
- **Manual smoke checklist (M2 exit criteria):**
  - Workspace A/B context switch restores workspace-specific chat thread.
  - App restart restores active workspace and its chat metadata/messages from per-workspace chat file.
  - Workspace with no chat file shows empty `Start chat` state until first user message.
  - Notepad context clears chat binding and does not display prior workspace messages.
- **Specs tracking:** Marked `Task M2-6` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 23:22 (MSK)

- **AI M2-5 chat conversation UI:** Replaced the `ChatPanel` placeholder with a functional pre-provider conversation UI in `app/src/lib/components/ChatPanel.svelte`, including message list rendering, role labels/styles (`user`/`assistant`/`system`), empty-state copy (`Start chat`), and composer controls.
- **Local message send flow:** Wired composer submit (Enter to send, Shift+Enter newline, send button) to `chatStore.appendMessage(...)`, with lazy-thread creation on first user message and immediate in-memory list updates in the active workspace chat tab.
- **Persistence on send:** Added chat snapshot persistence on successful local send via `scheduleWorkspaceChatFilePersistence(...)`, using active workspace/thread snapshots from `chatStore`.
- **Store selector support:** Extended `app/src/lib/state/chatStore.ts` with `getActiveWorkspaceRoot()` and `getActiveThreadSnapshot()` to provide safe, encapsulated persistence inputs for the UI layer.
- **Svelte validation:** Ran `npx @sveltejs/mcp svelte-autofixer ./src/lib/components/ChatPanel.svelte` (clean) and kept runes-mode reactivity (`$derived`) for template state.
- **Specs tracking:** Marked `Task M2-5` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 23:19 (MSK)

- **ChatPanel Svelte 5 runes fix:** Updated `app/src/lib/components/ChatPanel.svelte` to replace legacy `$:` reactive statements with rune-safe `$derived(...)` declarations for `messages`, `isEmpty`, and `isSendDisabled`.
- **Composer accessibility/idioms:** Added `aria-label` on the chat textarea and reused derived disabled-state logic for the send button while preserving existing Enter-to-send behavior and keyed message rendering.
- **Validation:** Ran Svelte MCP `svelte-autofixer` before/after edits; initial run flagged legacy reactive statements, final run returned clean (`issues: []`).

## 2026-05-25 23:17 (MSK)

- **AI M2-4 workspace chat restore wiring:** Integrated `chatStore` into `app/src/routes/+page.svelte` context flow so chat binding follows active workspace context and clears in Notepad context.
- **Workspace switch loading:** Added workspace-root keyed chat load on context changes; each new active workspace now loads its persisted thread snapshot (or `null` empty state) and sets it as active without leaking previous workspace messages.
- **Restart restore behavior:** Extended runtime setup after `restoreWindowSession` to initialize `chatStore` for the restored active workspace and hydrate persisted thread data during startup.
- **Race-safe store behavior:** Updated `app/src/lib/state/chatStore.ts` so `loadWorkspaceThread` only updates thread cache and does not mutate active workspace binding, preventing stale async loads from overriding the current workspace selection.
- **Tests:** Extended `app/src/lib/state/chatStore.test.ts` with workspace-empty-state and Notepad unbinding coverage, and updated workspace-switch test to reflect explicit active-workspace binding.
- **Specs tracking:** Marked `Task M2-4` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 23:09 (MSK)

- **AI M2-3 chat in-memory store:** Added `app/src/lib/state/chatStore.ts` to manage one active workspace thread with per-workspace in-memory map, explicit workspace loading (`loadWorkspaceThread`), message appends, and thread metadata updates.
- **Lazy thread creation:** Implemented first-message creation semantics in `appendMessage` (creates thread only on first `user` message), with default metadata placeholders for MVP (`mode: ask`, `provider: glm`) and timestamp updates on append/update.
- **UI selectors:** Exposed both imperative selectors (`getMessages`, `getMetadata`, `hasThread`, `isEmpty`) and derived stores (`chatMessages`, `chatMetadata`, `chatHasThread`, `chatIsEmpty`) for upcoming ChatPanel wiring.
- **Tests:** Added `app/src/lib/state/chatStore.test.ts` covering lazy thread creation, append + metadata update behavior, and workspace-key switching that swaps active thread state.
- **Specs tracking:** Marked `Task M2-3` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 22:59 (MSK)

- **AI M2-2 chat persistence service:** Added `app/src/lib/services/chatPersistence.ts` with workspace-scoped chat file mapping (`getWorkspaceChatFilePath`) under app data `chat/<normalized-path-hash>.json`, using normalized workspace path hash keys.
- **Versioned codec + safe fallbacks:** Implemented `encodeChatThreadFileSnapshot`/`decodeChatThreadFileSnapshot` with `version: 1` envelope handling and strict shape parsing for metadata/messages/system events; missing/corrupt/invalid content now safely resolves to an empty snapshot (`thread: null`) instead of throwing.
- **Debounced persistence helper:** Added `scheduleWorkspaceChatFilePersistence` (session-manager-style debounce) plus `resetChatPersistenceForTests` for deterministic unit tests.
- **Tests:** Added `app/src/lib/services/chatPersistence.test.ts` covering snapshot round-trip codec behavior, corrupt-file fallback, and distinct file mapping for different workspace paths.
- **Specs tracking:** Marked `Task M2-2` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 22:55 (MSK)

- **AI M2-1 chat contracts:** Added chat domain contracts in `app/src/lib/domain/contracts.ts` for Milestone 2 storage/modeling: `ChatMessageRole`, `ChatMessage`, `ChatModeId`, `ChatProviderId`, `ChatThreadMetadata`, `ChatThreadSnapshot`, and `ChatThreadFileSnapshot` (versioned envelope).
- **System-event forward compatibility:** Added typed `ChatSystemEvent` support on `ChatMessage` to represent persisted system markers (starting with `provider-switched`) so provider-switch events can be appended as visible chat history entries in later milestones.
- **One-thread invariant documentation:** Documented one-thread-per-workspace invariant directly in `ChatThreadSnapshot` / `ChatThreadFileSnapshot` comments.
- **Specs tracking:** Marked `Task M2-1` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 22:35 (MSK)

- **Console M1-5 context-switch integration:** Verified `app/src/routes/+page.svelte` still closes console on every Notepad/workspace context switch via `handleActiveContextSwitch`, while preserving M1-4 restore behavior for workspace tab preference on reopen.
- **Console reopen restore:** Confirmed console mounts with controlled `activeTab` from per-workspace prefs (`consoleTabSelection`) and keeps Notepad behavior prefs-free (no workspace read/write in Notepad context).
- **Validation:** Ran full suite in `app` — `npm test` (24 files, 200 tests passed) and `npm run check` (0 errors; one pre-existing `FindReplacePanel.svelte` a11y warning).
- **Specs:** Marked Task M1-5 as done in `specs/ai-m-1-execution-plan.md`.

## 2026-05-25 22:29 (MSK)

- **Console M1-4 persistence service:** Added `app/src/lib/services/consoleTabPrefs.ts` with lightweight app-data storage (`console-tab-prefs.json`) for per-workspace console tab selection, keyed by normalized workspace path hash and scoped to `chat`/`logs`.
- **Console tab restore wiring:** Updated `app/src/routes/+page.svelte` to restore tab preference when workspace context activates (default `chat` when no record exists), and persist changes only in workspace context.
- **Console panel control hook:** Updated `app/src/lib/components/ConsolePanel.svelte` to accept controlled `activeTab` and emit `onTabChange` callbacks while preserving existing M1-2 notepad gating and logs-only fallback behavior.
- **Tests:** Added `app/src/lib/services/consoleTabPrefs.test.ts` for hash-key stability and prefs read/write behavior.
- **Specs:** Marked Task M1-4 as done in `specs/ai-m-1-execution-plan.md`.
- **Validation:** Ran `npm run check`, `npm test -- consoleTabPrefs`, and `ReadLints` on changed files (no new errors; one pre-existing `FindReplacePanel.svelte` warning remains).

## 2026-05-25 22:13 (MSK)

- **Console M1-3 chat placeholder component:** Added `app/src/lib/components/ChatPanel.svelte` as a workspace-scoped empty-state view (`Start chat` with a brief workspace/provider hint) using existing console design tokens and without composer/input/network/provider runtime logic.
- **Console panel integration:** Updated `app/src/lib/components/ConsolePanel.svelte` to import/render `ChatPanel` instead of inline placeholder markup, preserving tab order (`Chat`, then `Logs`), current logs behavior, and existing `showChatTab` gating (tabs hidden in Notepad mode, logs-only when chat unavailable).
- **Validation:** Ran Svelte MCP `svelte-autofixer` for both changed components; fixed one a11y issue (`tabpanel` role on non-interactive element in `ChatPanel`) and revalidated cleanly (remaining `activeTab` `$effect` note in `ConsolePanel` is pre-existing M1-2 gating logic).

## 2026-05-25 21:56 (MSK)

- **Console M1-2 workspace gating:** Updated `app/src/lib/components/ConsolePanel.svelte` to accept `showChatTab`, hide the tab header in Notepad mode, and render logs-only when no workspace is active.
- **Console tab safety:** Added defensive tab coercion in `ConsolePanel.svelte` so hidden `Chat` cannot stay selected; panel falls back to `logs` when `showChatTab` is false.
- **Shell integration:** Updated `app/src/routes/+page.svelte` to pass `showChatTab={Boolean(activeWorkspaceRoot)}` into `ConsolePanel` while keeping existing `toggleConsole`, `applyResponsiveLayoutRules`, and context-switch close behavior unchanged.
- **Specs:** Marked Task M1-2 as done in `specs/ai-m-1-execution-plan.md`.
- **Validation:** Ran `npm run check` in `app` and `ReadLints` on changed files; no new errors (pre-existing `FindReplacePanel.svelte` a11y warning remains).

## 2026-05-25 21:43 (MSK)

- **Console M1-1:** Refactored `app/src/lib/components/ConsolePanel.svelte` into a tabbed console shell with `Chat` first and `Logs` second, defaulting to `Chat`, and added token-driven active/inactive tab states without changing console container sizing.
- **Console logs extraction:** Added `app/src/lib/components/ConsoleLogsPanel.svelte` and moved logs rendering logic there while preserving pre-refactor behavior (250-entry cap, truncation notice, sticky near-bottom autoscroll, line wrapping, and severity coloring).
- **Specs:** Marked Task M1-1 as done in `specs/ai-m-1-execution-plan.md`.
- **Validation:** Ran `npm run check` in `app`; passed with one pre-existing warning in `app/src/lib/components/FindReplacePanel.svelte` and no new errors.

## 2026-05-25

- **Console M1-1 follow-up:** Kept `app/src/lib/components/ConsoleLogsPanel.svelte` behavior identical while switching log consumption to direct `$consoleLogs` derived state in runes mode; retained 250-entry cap, truncation notice, sticky near-bottom autoscroll, and existing level colors/typography.
- **Console M1-1 tab shell:** Refactored logs rendering from `app/src/lib/components/ConsolePanel.svelte` into new `app/src/lib/components/ConsoleLogsPanel.svelte` with unchanged behavior (subscription to `consoleLogs`, max 250 visible entries, truncation notice, stick-to-bottom scrolling, preserved line formatting and severity colors).
- **Console tabs:** Updated `ConsolePanel.svelte` into a local-state tab shell with **Chat** then **Logs** order (default **Chat**), a simple `Start chat` placeholder panel, and conditional rendering of `ConsoleLogsPanel` for logs while preserving existing console height and border structure.
- **Validation:** Verified updated Svelte components with `@sveltejs/mcp` autofixer and workspace lints; resolved runes-mode reactivity issues by using `$state` and runes-safe effects.

- **Tabs:** Hide **Copy Relative Path** in Notepad mode (workspace context menu only).
- **Settings:** Fix theme not surviving restarts — load persisted settings before session restore, preserve settings (including theme) in `applyWindowSession`, and defer settings persistence until runtime is ready so startup session restore cannot overwrite `settings.json` with defaults.
- **Open Nearby:** Align nearby file filtering with `isOpenableFilePath` (syntax-highlighted extensions, known extensionless names, and plain extensionless notes) instead of only `.txt`/`.md`/`.markdown`. Log a diagnostic warning when nearby directory reads fail instead of failing silently.
- **Tabs:** Add **Copy Path** and **Copy Relative Path** (workspace tabs only) to the tab context menu.
- **Editor:** Use static imports for CodeMirror JS, HTML, and CSS language packs in `editorLanguage.ts`. These modules were already bundled via `@codemirror/lang-markdown`; dynamic `import()` only produced Vite warnings without code-splitting benefit. Synchronous `getLanguageSupport` now covers those languages for immediate highlighting on first open.
- **Specs:** Add `specs/ai-questions.md` documenting AI chat-in-console MVP idea, confirmed decisions (workspace-scoped history, auto-load last thread on switch), and a numbered clarification checklist with recommended options for console behavior, thread model, modes, providers, persistence, error UX, and future settings-driven mode extensibility.
- **Specs:** Update `specs/ai-questions.md` to replace `plan` mode with `review`, redefine mode expectations toward critique/estimation/clarification behavior, and add new mode-specific open questions for minimum `review` behavior and default effort-estimation output.
- **Specs:** Promote `specs/ai-requirements.md` as source of truth for AI chat in workspaces, including finalized behavior for console tabs, workspace-scoped chat, `ask`/`review` modes, provider switching semantics, mandatory workspace file-access preflight with blocking UX, persistence/retention rules, and milestone-based implementation plan. Update `specs/ai-questions.md` as historical discussion with a source-of-truth pointer and additional captured decisions on file-access gating and no active-file/log attachment in MVP.
- **Specs:** Split provider/runtime implementation milestone in `specs/ai-requirements.md` into two sequential milestones: GLM integration first, Cursor SDK integration second. Renumber subsequent milestones accordingly (`Access contract` to Milestone 5, `Retention/reliability/polish` to Milestone 6).
- **Specs:** Reorder `specs/ai-requirements.md` milestones so platform substrate precedes provider integration: access contract (M3), retention/reliability core (M4), then GLM (M5) and Cursor SDK (M6), with retry/streaming/UX polish last (M7).
- **Specs:** Add per-milestone AI execution plans (`specs/ai-m-1-execution-plan.md` … `specs/ai-m-7-execution-plan.md`) with detailed agent tasks, dependencies, acceptance checklists, and testing maps following `specs/archive/execution-plan.md` template. Link plans from `specs/ai-requirements.md`.


## 2026-05-25 09:52 (UTC+3)

- **Activity rail visual update:** Updated `app/src/lib/components/ActivityRail.svelte` to add a separator between Notepad and workspace items, render workspace buttons as square letter badges using a new `workspaceInitial()` helper (first letter of folder name, uppercased), and preserve existing click/contextmenu behaviors and ARIA labels.
- **Active rail emphasis:** Switched active Notepad/workspace button styling to an explicit accent-based highlight (`--color-accent`) via border/background treatment while retaining existing hover/focus behavior and add-button placement at the bottom.
- **Status bar alignment:** Updated `app/src/routes/+page.svelte` status message styling so transient labels like `Workspace added.` and `Saved <path>` align vertically with adjacent status segments.

## 2026-05-25 09:00 (UTC+3)

- **Project panel resize:** Updated `app/src/lib/components/ProjectPanel.svelte` with a left-edge drag handle (`.project-panel-resize-handle`) that resizes the right-side panel width in local component state (`panelWidth`) with clamped bounds (`180..520`) and `col-resize` cursor behavior during drag.
- **Project panel controls:** Switched collapse/expand button glyphs in `ProjectPanel.svelte` from `‹/›` to `⟫/⟪` while preserving existing collapsed-width behavior (`project-panel-collapsed` stays `36px`).
- **Tree expandability gating:** Added `canExpand` prop to `app/src/lib/components/ProjectTreeNode.svelte`; chevron now renders only for expandable directories and directory click no-ops when expansion is unavailable.
- **Tree list rendering guard:** Updated `app/src/lib/components/ProjectTreeList.svelte` to compute and pass `canExpand`, and to render nested child blocks only when `canExpand` is true (while still allowing not-yet-loaded directories to expand).

## 2026-05-24 23:02 (UTC+3)

- **Debug cleanup:** Removed temporary layout/context investigation instrumentation from `app/src/routes/+page.svelte` (`emitDebugLog`, debug keys/run id, and all `#region agent log` blocks/calls, including the debug-only reactive context logger).
- **Layout fix retained:** Kept responsive behavior and structural layout fixes, including `editorShellEl` binding usage, `.editor-shell { grid-column: 2; }`, and project panel column assignment.

## 2026-05-24 22:54 (UTC+3)

- **Hotfix: responsive project panel collapse:** Updated `app/src/routes/+page.svelte` to use transient local `autoProjectPanelCollapsed` state instead of mutating persisted `projectPanelCollapsed` in responsive logic. `showProjectPanel` now respects both persisted manual collapse and temporary auto-collapse.
- **Console auto-close behavior:** Preserved width-based console close behavior while using effective collapsed state (`manual || auto`) so console closes under 900px only when the panel is effectively collapsed.

## 2026-05-24 22:47 (UTC+3)

- **Workspaces M5 shell behavior:** Updated `app/src/routes/+page.svelte` to close console on any active context change (including non-rail/routing-driven switches) by watching `activeContextId` transitions centrally.
- **Responsive shell rules:** Added `ResizeObserver`-driven width tracking for shell middle row and editor pane; auto-collapses project panel under 1100px when workspace context is active, and auto-closes console under 900px once the panel is collapsed.
- **Markdown split fallback:** Introduced `setMarkdownViewMode` + preferred mode tracking with measured editor-width gating (`760px` threshold), forcing split requests to `edit` when space is insufficient and automatically restoring split once width recovers.

## 2026-05-24 22:40 (UTC+3)

- **Workspaces M4 project panel:** Added lazy project-tree service (`projectTree.ts`) with one-call directory loading, folders-first alphabetical sorting, hidden-file toggle behavior, symlink skipping, and openable-file filtering aligned with existing folder-open rules.
- **Tree UI components:** Implemented `ProjectPanel.svelte`, `ProjectTreeView.svelte`, `ProjectTreeList.svelte`, `ProjectTreeNode.svelte`, plus `FileIcon.svelte` / `DirectoryIcon.svelte`; includes recursive expand/collapse, loading rows, path tooltips, active-file highlighting, and scroll-into-view for selected tree nodes.
- **Shell integration + persistence:** Integrated project panel into `+page.svelte` as right column in workspace mode, wired single-click open via `openActivePath`, lazy ancestor expansion/loading for active files, refresh and show-hidden controls, and persisted panel collapsed state in window session snapshots (`projectPanelCollapsed` in `editorPreferences`).
- **Design tokens + coverage:** Added `--project-panel-width` and `--tree-indent` tokens, introduced `projectTree.test.ts` coverage, and updated existing state/session tests for new persisted editor preference.

## 2026-05-24 22:18 (UTC+3)

- **Workspaces M3 routing + policy:** Added `workspacePaths` helpers (`isPathUnderRoot`, `ensureNotepadForOutsidePath`, `runInNotepadContext`) and wired path-open routing so outside-root opens switch to Notepad, while existing-tab lookup now scans all local contexts and focuses the owner context/tab.
- **Notepad-only commands:** Applied shared Notepad gate to `file.openRecent`, `file.openAllInFolder`, and tab-menu **Open All Nearby**, ensuring those entrypoints always run and open tabs in Notepad context while keeping global recent-files behavior unchanged.
- **File/Open/Save As + multi-window behavior:** Updated file dialogs to default to active workspace root, Save As to use workspace-root defaults and move outside-root saves to Notepad, and blocked `tab.moveToNewWindow` from workspace context; `createNewWindowWithTransfer` now opens blank Notepad-only windows unless explicit Notepad transfer payload is provided.
- **Docs execution tracking:** Marked Milestone 3 tasks (`M3-1` through `M3-5`) as done in `specs/workspaces-execution-plan.md`.

## 2026-05-24 21:53 (UTC+3)

- **Workspaces M2:** Implemented the activity-rail milestone end-to-end: added `ActivityRail.svelte` (Notepad, workspace buttons, add button), integrated it into the shell layout, and wired context switching to `appState.switchContext` with console close + markdown mode reset on switch.
- **Workspace lifecycle UI:** Added `workspace.add` / `workspace.close` command wiring, File menu **Add Workspace**, folder-picker add flow with duplicate rejection notify, and workspace right-click custom flyout with **Close Workspace** and batched close behavior (Save All / Discard All / Cancel).
- **Settings and persistence:** Added `hideActivityRailWhenNotepadOnly` setting (default on), surfaced it in settings UI, persisted it via `settingsStore`, and made rail visibility reactive (hidden when notepad-only + setting on; auto-shows once workspaces exist).
- **Validation:** Updated impacted tests/types and validated with `npm run check` and `npm test` (existing `FindReplacePanel.svelte` a11y warning remains unchanged).

## 2026-05-24 21:45 (UTC+3)

- **Workspaces M1:** Implemented Milestone 1 foundation end-to-end in app code: naming cleanup (`resetAppState`, `.editor-pane`, `.markdown-layout`), new context/workspace domain contracts, context-aware `appState` core (active context selectors + workspace lifecycle reducers), and session snapshot v2 (`activeContextId`, `notepad`, `workspaces[]`, shared `editorPreferences`).
- **State and persistence:** Added `switchContext`, `addWorkspace`, `closeWorkspace` reducers with duplicate-path guard and batched close-action contract; reset transient editor chrome on context switches while keeping shared zoom/wrap stable; migrated session/open-file-registry services and tests to snapshot version 2 (no v1 migration shim).
- **Validation:** Updated affected unit tests across state/services/commands and verified `npm test` + `npm run check` pass (with one pre-existing Svelte accessibility warning in `FindReplacePanel.svelte`).

## 2026-05-26

- **Specs:** Resolved implementation decisions in `specs/workspaces-milestone-plan.md` and `specs/workspaces-execution-plan.md` — editor chrome hybrid (shared zoom/wrap), batched close-workspace dirty dialog, ResizeObserver layout + markdown split fallback, session size v1 + optional M5-5 lean snapshot task.

## 2026-05-25

- Added `specs/workspaces-execution-plan.md` — agent task breakdown for Workspaces (25 tasks across M1–M5), following `specs/archive/execution-plan.md` template.
- **Specs:** Expanded Milestone 4 in `specs/workspaces-milestone-plan.md`.

## 2026-05-24 (workspaces planning)

- Added `specs/workspaces-milestone-plan.md` — source of truth for the Workspaces feature: consolidated design decisions (contexts, file routing, Notepad-only commands, console, layout, naming) and a five-milestone roadmap.
- Archived `specs/workspaces-questions.md` → `specs/archive/workspaces-questions.md`.

## 2026-05-24

- **UI:** Added an in-app **Console** panel toggled by clicking the status bar. Shows scrollable, copyable diagnostic logs; console mounts lazily when opened.
- **UI:** Fixed status bar layout so it stays visible and clickable when the console is closed (footer was landing in a zero-height grid row).
- **Tauri:** Added window size/position restore permissions to fix `setupRuntime failed` on session restore.
- **File:** Added **File → Open Recent** with up to 15 globally shared entries, tilde-shortened labels (home plus Documents/Desktop/Downloads elided), automatic pruning of missing files, and **Clear Recent** (disabled when empty). Recent list persists at app session level and syncs across windows.
- **File:** Added **File → Open all in Folder** to recursively open up to 20 code/text files from a chosen directory (with confirmation when more match), skipping hidden/dot paths and common vendor/build folders. Extensionless plain-text note files (no `.` in the filename) are included.
- **File:** Fixed File menu corruption after bulk opens by serializing Open Recent menu refreshes and batching recent-files persistence during folder open.
- **Settings:** Removed the debug recent-files counter from the settings pane.
- **Settings:** "Decorate plaintext symbols" is enabled by default for new sessions and when the setting is missing from persisted settings.
- **Themes:** Syntax highlight colors now follow the active accent theme. Keywords, types, links/functions, and plaintext symbol decorations use accent-derived colors; strings, comments, numbers, headings, markup, and punctuation keep fixed semantic palettes per light/dark mode.
