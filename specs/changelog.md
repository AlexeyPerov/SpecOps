# Changelog

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
