# 01 — Phase A implementation notes

**Date:** 2026-08-11
**Scope:** [`execution-plan-phase-a-chat-removal.md`](execution-plan-phase-a-chat-removal.md)

This file is the checked removal list required by task **AS01-A-01**. It separates
the standalone Chat/Cloud product surface (removed) from the reusable workspace
Sessions rendering and OpenCode backend (preserved). Phase B owns the new
runtime-neutral domain; Phase A does **not** redesign it.

## Boundary rule

The `chat-http` standalone lane and its HTTP provider machinery are removed. The
OpenCode workspace-session path and all shared transcript rendering stay, because
that is the current implementation of the future Sessions surface and will be
refactored onto the Agent Host in later phases.

The two send paths in `chatSendPipeline.ts` make the boundary explicit:

- **Workspace path** (`shouldUseWorkspaceAgentBackend` →
  `executeWorkspaceAgentBackendTurn` → `workspaceAgentBackend`) — KEEP. This is
  the real session runtime today.
- **HTTP provider path** (`validateProviderSend` → the provider branch of
  `executeProviderTurn` → `streamProviderMessage`) — REMOVE. Only the
  `chat-http` context used it.

All three provider ids (`http`, `debug-chat`, `debug-workspace`) route through the
HTTP provider registry and are removed. The deterministic fake runtime is rebuilt
in Phase C on the new domain.

## REMOVE — product surface (chat-http / chat-cloud)

### Context and routing
- `CHAT_HTTP_CONTEXT_ID`, `CHAT_CLOUD_CONTEXT_ID` and the `chatHttp` / `chatCloud`
  snapshots on `WindowContextState` (`domain/workspace.ts`).
- Activity-rail Chat button and chat-http context switching/restore/snapshot
  (`ActivityRail.svelte`, `appState/workspaceContextsSlice.ts`,
  `appState/contextHelpers.ts`, `services/sessionSnapshot*`, `services/appShell*`).
- `chatContextKind` discriminator collapses to workspace-only (the type and all
  `"chat-http"` branches go away).

### Beta gate
- `ChatHttpSettings` and `settings.chatHttp` (`domain/settings.ts`,
  `services/chatHttpSettings.ts`, `settingsStore.ts`, `settingsSlice.ts`).
- Rail gating (`ai/providers/chatHttpRailGating.ts`) and the Dev "Enable Chat
  (beta)" toggle (`DevSettingsPanel.svelte`).
- chat-http-gated settings tabs: `connections`, `chatModes`, `debugAi`
  (`services/settingsDialogUi.ts`, `SettingsView.svelte`).

### HTTP provider runtime — entire `ai/providers/` tree
- Provider registry/types/bootstrap (`registry.ts`, `types.ts`, `bootstrap.ts`,
  `errors.ts`).
- Providers: `openAiCompatibleChatProvider*`, `openAiSseParser*`,
  `openAiChatMessages.ts`, `debugChatProvider*`, `debugSimulation*`,
  `debugResponses*`, `debugProviderSettings*`, `debugProviderTestHelpers*`.
- Connection + catalog + capability helpers: `httpConnectionSettings*`,
  `providerModelCatalog*`, `modelValidation*`, `capabilityChecker*`,
  `threadModelCatalog*`, `appProviderSettings*`, `threadScopeNormalization.ts`,
  `selection.ts` (chat-http parts), `chatHttpRailGating*`.
- Provider send path: `validateProviderSend`, HTTP branch of
  `executeProviderTurn`, `streamProviderMessage` (`ai/chatSend.ts`),
  `buildThreadProviderRequest` / `buildProviderRequest` (`ai/modes/`,
  `providers/types.ts`).
- `ai/contextWindowBudget.ts` (depends on `buildThreadProviderRequest`) and the
  composer budget estimate.

### Chat modes (HTTP prompt product)
- `ai/modes/` (system-prompt templates used only by the HTTP prompt builder).
- Chat-modes settings (`chatModesSettingsSlice.ts`,
  `ChatModesSettingsPanel.svelte`, `ChatModeEditorDialog.svelte`).
- `ChatModePicker.svelte`.
- `ChatModesSettings` / custom-mode domain types and the `chatModes` settings
  field. The vestigial `ChatThreadMetadata.mode` field is removed as well because
  the workspace backend sends raw content and never reads it; Phase B introduces
  its own turn model.

### Settings, secrets, persistence
- HTTP settings fields: `ProviderSettingsById.httpConnections`,
  `defaultConnectionId`, `http`, `debugChat`; `providerModelCatalogs`;
  `providerApiKeys` (HTTP); `appState/providerSettingsSlice.ts`.
- `services/providerSecretsStore.ts` HTTP-key functions
  (`load/save/deleteConnectionApiKey`, `loadConnectionApiKeys`, legacy
  `load/saveProviderApiKey`, the `DEFAULT_HTTP_CONNECTION_ID` import and the
  `http`→connection normalization). The OpenCode server-password functions stay.
- Settings panels: `ConnectionsSettingsPanel.svelte`,
  `ProviderModelCatalogPanel.svelte`, `DebugProviderSettingsPanel.svelte` (chat
  scope; the workspace debug scope goes with the removed debug provider).
- `services/chatAccessMonitor.ts` (chat-http access monitoring).
- chat-http references in `chatPersistence*` / codec / sanitizer.

### Components / composer routing
- `ChatConnectionPicker.svelte`, `ChatModePicker.svelte`.
- chat-http branches in `ChatPanel.svelte`, `ChatComposer.svelte`,
  `ChatMessageList.svelte`, `ChatBlockedState.svelte`.
- Provider/model/connection/mode selectors and composer selection actions/effects
  for chat-http.

## KEEP — workspace sessions and reusable rendering

- `chatStore` + slices (`state/chatStore/`); strip chat-http provider-selection
  branches but keep workspace thread/runtime/session state.
- Transcript primitives: `ChatMessage`, `ChatMessagePart` union, `ToolCallRecord`,
  `ChatThreadSnapshot`, `ChatSessionThreadFileSnapshot`, `SessionIndexEntry`
  (opencode link fields), `WorkspaceSessionsIndexSnapshot`.
- Rendering: `ChatMessageList.svelte`, `ChatComposer.svelte` (workspace-only),
  `ChatPanel.svelte` (workspace-only), `ToolCard`, `SubtaskCard`, `ReasoningBlock`,
  `StepSeparator`, `MarkdownRenderer`, `AttachmentTray`, `MentionPicker`,
  `SlashCommandPopover`, `WorkspaceCatalogPicker`, sessions sidebar components.
- Stream-part reducers: `chatStreamParts.ts`, `toolCallReducer.ts`,
  `chatReasoning.ts`, `chatSteps.ts`, `chatSubtasks.ts`, `chatDiffs*`,
  `chatDiffParser*`, `chatMarkdown*`, `chatMessageLayout.ts`, `chatReviewContent`,
  `chatErrorCopy.ts` (workspace messages), `chatDiagnostics.ts` (workspace
  logging, minus provider specifics), `chatAttachments*`, `retryChatTurn.ts`.
- OpenCode backend + services: `ai/backends/`, `workspaceAgentBackend`,
  `opencodeSidecar*`, `opencodeCatalog*`, `opencodeConfigStore`,
  `opencodeResourceStore`, `opencodeDiffStore`, `opencodeTodoStore`,
  `opencodeStatusSummary`, `opencodeSettings`, `workspaceAgentSession`,
  `workspaceAgentHydration`, `chatSessions.ts`, `chatPersistence*` (workspace),
  `chatRetention*`, `sessionManager`, `composerContext`, `composerPromptQueue`,
  `composerSelectionActions/Effects/SendActions` (workspace parts),
  `workspaceComposer`.
- OpenCode settings + Workspaces settings subtree (the workspace-sessions beta
  gate stays as the single Dev feature gate per roadmap).
- `providerSecretsStore.ts` OpenCode server-password functions.

## Relocation

Two workspace-only helpers in `ai/providers/selection.ts` move to
`ai/opencodeCatalog.ts`: `listSelectableWorkspaceModels`,
`resolveWorkspaceModelId`. Everything else in `selection.ts` is removed.

## Verification

- `npm run check`: production (non-test) errors are exactly the pre-Phase-A
  baseline (22 pre-existing errors in `+page.svelte`, `AppShellHost.svelte`,
  `AppShell.svelte`, `appShellHostTypes.ts`, `ProjectPanel.svelte`,
  `editorBookmarks.ts` — all unrelated to chat-http). The two pre-existing
  `ChatPanel.svelte` duplicate-identifier errors were incidentally resolved.
- `npm test`: 2974 pass / 5 fail. Every chat-http-affected suite passes.
  The 5 remaining failures pre-date Phase A and touch no chat-http code:
  `gitService.test.ts` (3 — git subprocess logging / `--no-index` behavior),
  `MarkdownOutlinePanel.test.ts` (1 — Svelte effect-update-depth, flake),
  `workspaceFileCatalog.integration.test.ts` (1 — extensionless `README`
  openability). They are out of Phase A scope.
- Grep of active production code for `chat-http`, `chatHttp`,
  `CHAT_HTTP_CONTEXT_ID`, `ChatProviderId`, `httpConnections`,
  `providerApiKeys`, `chat-cloud` returns no product contract (only these
  archived notes / the changelog reference them historically).

