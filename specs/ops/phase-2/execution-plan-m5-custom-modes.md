# Phase 2 Milestone 5 Execution Plan — Custom chat modes

**Spec:** [phase-2.md](./phase-2.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m4-multiple-providers.md](./execution-plan-m4-multiple-providers.md) complete (M4 connections shipped)  
**Related:** Supersedes phase-2 **C2A** (chat-http ask-only); overlaps phase-7 tier 2C (per-chat system prompt) only at the **mode template** layer — per-thread prompt override remains out of scope.

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Description

Phase 2 tier 1 and M4 ship two **fixed** chat modes — **Ask** and **Review** — with hardcoded system prompts in `app/src/lib/ai/modes/builtins.ts`. The composer injects workspace metadata and compaction summary on every send (`openAiChatMessages.ts`). **Review** is structured (required markdown sections + section cards in the message list). **chat-http** (Chats context) is restricted to **Ask** only at the UI, persistence, and send layers.

**Milestone 5 (custom modes)** extends the mode system so users can define additional modes and tune built-in behavior without code changes:

- **Built-ins (read-only in settings):** **Ask**, **Review**, and new **Raw** (Ask-like pipeline with **no default persona prompt**; **disabled by default**). Users can inspect prompts, toggles, and required sections; built-in **prompt text is not editable**; **toggles** (and Raw enable) are user-adjustable.
- **Custom modes:** user CRUD in Settings → **Chat modes** — name, prompt (with `{{workspace}}` / `{{summary}}` placeholders), enable/disable, context toggles, and **required sections** (structured UI like Review).
- **Presets:** ship a small set of enabled custom modes on first run (formal names; no “Devil’s advocate”).
- **Scope:** all enabled modes available in **Chats** and **workspace** HTTP chat (remove ask-only gating; **Review** available in Chats).
- **Lifecycle:** threads referencing deleted/disabled/missing custom modes fall back to **Ask** on load and before send.
- **Mid-thread mode switch:** unchanged (no audit system event).

This is the minimum slice for user-defined chat personas and structured response templates without per-message prompt editing or new provider protocols.

## Goal

Ship **custom chat modes** end-to-end:

1. Settings **Chat modes** tab lists built-ins (inspect) and custom modes (add / edit / remove / enable).
2. Composer mode selector shows enabled built-ins + enabled custom modes in **Chats** and **workspace** chat.
3. Send pipeline resolves mode prompt via placeholders and toggles; structured modes render section cards from **required sections**.
4. **Raw** built-in available when enabled; behaves like Ask without the default assistant persona.
5. Existing Ask/Review threads and sends keep working; chat-http Review threads no longer normalize to Ask.

## Decisions applied

| ID | Decision | Implication |
|----|----------|-------------|
| CM-1 | A | **Ask** and **Review** stay fixed built-ins; shown read-only in settings |
| CM-2 | A | No separate “Criticize” preset; **Review** unchanged |
| CM-3 | A | **Raw** is a built-in; disabled by default; empty/minimal persona prompt |
| CM-4 | A | Each mode has **includeWorkspace** / **includeSummary** toggles |
| CM-5 | A | Custom modes support **requiredSections** (structured UI); empty list = conversational |
| CM-6 | A | Missing/deleted/disabled mode on thread → fall back to **Ask** |
| CM-7 | A | Mid-thread mode switch kept; no mode-switched system event |
| CM-8 | A | All enabled modes in **Chats** and **workspace**; **Review** in Chats |
| CM-9 | A | Ship formal-name **presets** as editable custom modes |
| CM-10 | A | Prompt placeholders: `{{workspace}}`, `{{summary}}` gated by toggles |
| CM-11 | A | Built-in prompts read-only; built-in **toggles** (and Raw enable) user-editable |
| C2 | — | Supersedes phase-2 C2A ask-only for chat-http |

## Assumptions

- M4 (multiple HTTP connections) is complete.
- Implementation is agent-only; human role is approval/review.
- Breaking changes to persisted thread `mode` values are acceptable for unknown ids (fallback to Ask); no migration shims for old threads beyond fallback.
- Custom mode ids are stable strings (`custom-{uuid}` or slug); display names are user-facing only.
- HTTP and Debug providers accept all enabled mode ids in capability checks (no per-mode blocklist beyond missing mode fallback).
- Placeholder `{{workspace}}` in chat-http resolves using scope key `chat-http` unless Task 1 adds a dedicated chat scope label (document chosen format in Task 2).
- Phase 7 **per-chat system prompt override** (thread metadata `systemPrompt`) remains out of scope.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Mode plumbing exists: `ChatModeDefinition`, `resolveModeSystemPrompt`, composer mode selector, thread `metadata.mode`.
2. Review structured UI and section parsing exist (`chatReviewContent.ts`, `ChatMessageList.svelte`) — generalize rather than rewrite.
3. Settings sidebar already has a **Chats** section; add **Chat modes** tab alongside Providers.

Residual uncertainties:

1. **chat-http workspace placeholder:** `Workspace: chat-http (chat-http)` may confuse users — consider empty default for `includeWorkspace` in chat-http or a fixed label `Chats` (lock in Task 2).
2. **Preset seeding:** First-run only vs merge missing presets on upgrade — prefer first-run defaults in `defaultSettings`; no re-seed on upgrade.
3. **Required sections editor UX:** Simple ordered list with add/remove/reorder vs freeform textarea — prefer ordered list in settings panel.
4. **Provider `supportedModes`:** Dynamic list of enabled custom ids vs wildcard — prefer advertise all built-ins + enabled custom ids from resolver (Task 6).

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Mode schema, settings storage, and resolver (P2-9) [Score:8] [Agent:heavy] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — chat-http scope (C2 superseded)
2. `app/src/lib/domain/contracts.ts` — `ChatModeId`, `ChatThreadMetadata`, `AppSettingsState`
3. `app/src/lib/ai/modes/builtins.ts` — Ask/Review definitions
4. `app/src/lib/state/appState/settingsSlice.ts` — settings mutators pattern

- Widen `ChatModeId` to `"ask" | "review" | "raw" | string` (custom ids validated on load).
- Add settings types:
  - `CustomChatModeDefinition`: `id`, `name`, `prompt`, `enabled`, `includeWorkspace`, `includeSummary`, `requiredSections`, optional `sectionGuidance`
  - `ChatModesSettings`: `rawEnabled`, `builtinToggles` (per Ask/Review/Raw workspace+summary toggles), `customModes[]`
- Add `ResolvedChatMode` runtime type (`source: "builtin" | "custom"`, `editable`, `enabled`, `promptTemplate`, toggles, `requiredSections`).
- Implement `resolveChatMode(id, settings) → ResolvedChatMode | null` with **Ask fallback** when id unknown/disabled.
- Implement `listSelectableChatModes(settings) → ResolvedChatMode[]` (enabled built-ins + enabled custom).
- Seed **presets** in `defaultSettings.customModes` (formal names):
  - **Ideation** (conversational)
  - **Critical analysis** (structured: Summary, Strengths, Weaknesses, Open questions)
  - **Technical specification** (structured: Overview, Requirements, Constraints, Open questions)
  - **Executive summary** (structured: Summary, Key points, Recommendations)
- Add settings slice helpers: CRUD for custom modes, `setRawEnabled`, `updateBuiltinModeToggles`.
- Extend `chatPersistence.ts` `isChatModeId` / thread parse to accept custom ids; normalize unknown ids to `ask` on load.

**Acceptance checklist**

- Unit tests: resolver returns Ask for missing/disabled custom id.
- Unit tests: Raw omitted from selectable list when `rawEnabled === false`.
- Unit tests: presets present in default settings with expected sections.
- `normalizeSettings` (or dedicated normalizer) is single entry for chat modes load.

Dependencies: M4 complete.

---

#### Task 2: Prompt assembly — placeholders, toggles, required sections (P2-9) [Score:8] [Agent:heavy]

**Required context**

1. Task 1 resolver types
2. `app/src/lib/ai/modes/prompt.ts`
3. `app/src/lib/ai/providers/openAiChatMessages.ts`
4. `app/src/lib/ai/providers/types.ts` — `ProviderRequestPayload`

- Replace `resolveModeSystemPrompt(id)` call chain with `resolveModeSystemText(resolvedMode, context)` where context includes workspace root/name, summary, scope kind (`workspace` | `chat-http`).
- Placeholder substitution:
  - `{{workspace}}` → `Workspace: {name} ({rootPath})` when toggle on; `""` when off (strip empty lines)
  - `{{summary}}` → `Earlier conversation summary:\n{summary}` when toggle on and summary present; `""` when off or no summary
- When `requiredSections.length > 0`, append structured-output block to system text (same pattern as Review today, using mode’s section list + optional `sectionGuidance`).
- **Raw:** built-in prompt template empty or minimal; no Ask persona lines.
- Refactor `buildOpenAiChatMessages` to use **pre-resolved system text** only (remove hardcoded workspace/summary append).
- Update `buildThreadProviderRequest` / `buildProviderRequestWithMode` to pass resolved mode from settings + thread.
- Document chat-http `{{workspace}}` resolution (Task 1 uncertainty).

**Acceptance checklist**

- Unit tests: Ask with toggles off omits workspace/summary from system message.
- Unit tests: custom prompt with placeholders substitutes correctly.
- Unit tests: Review system text still includes four required sections.
- Unit tests: Raw send has no “helpful workspace assistant” string.
- Existing `builtins.test.ts` / provider payload tests updated.

Dependencies: Task 1.

---

#### Task 3: Structured message UI — generalize required sections (P2-9) [Score:6] [Agent:medium]

**Required context**

1. Task 1 `ResolvedChatMode.requiredSections`
2. `app/src/lib/ai/chatReviewContent.ts`
3. `app/src/lib/components/ChatMessageList.svelte`

- Rename/generalize `parseReviewMessageSections` → `parseStructuredMessageSections(content, requiredSections)`.
- Match section headings case-insensitively against mode’s `requiredSections` (keep `## Heading` markdown convention).
- `ChatMessageList`: use **active resolved mode’s** `requiredSections`, not `activeMode === "review"`.
- Pass resolved mode (or `requiredSections` + label) from `ChatPanel` → `ChatMessageList`.
- Streaming behavior unchanged: plain text until generation completes, then section layout.

**Acceptance checklist**

- Review messages still render section cards.
- Custom structured preset renders section cards when headings match.
- Conversational modes (Ask, Raw, Ideation) render plain markdown.
- Unit tests for parser with arbitrary section lists.

Dependencies: Task 1.

---

#### Task 4: Settings UI — Chat modes tab (P2-9) [Score:7] [Agent:medium]

**Required context**

1. Task 1 settings slice API
2. `app/src/lib/components/SettingsDialog.svelte`
3. `app/src/lib/services/settingsDialogUi.ts`

- Add settings tab `chatModes` under **Chats** sidebar section (label **Chat modes**).
- **Built-in section:** read-only cards for Ask, Review, Raw — show prompt text, required sections (if any), toggles (editable), Raw **Enable** checkbox.
- **Custom modes section:** list with add / select / remove / enable; editor panel:
  - Name, prompt (hint for `{{workspace}}` / `{{summary}}`)
  - Toggles: include workspace, include summary
  - Required sections editor (ordered list: add, remove, reorder)
  - Optional section guidance textarea
  - Enable checkbox
- Remove confirm on delete custom mode (threads fall back to Ask).
- `openSettingsDialog("chatModes")` deep link.

**Acceptance checklist**

- User can add a custom mode and see it in composer after enable.
- Built-in prompts are not editable; toggling Ask workspace off affects next send (verified manually or via test hook).
- Raw hidden from composer until enabled in settings.

Dependencies: Task 1.

---

#### Task 5: Composer and chat-http scope unification (P2-9) [Score:7] [Agent:medium]

**Required context**

1. Task 1 `listSelectableChatModes`
2. `app/src/lib/components/ChatComposer.svelte`
3. `app/src/lib/ai/providers/threadScopeNormalization.ts`
4. `app/src/lib/state/chatStore/threads.ts`, `agents.ts`
5. `app/src/lib/ai/sendChatMessage.ts`

- Remove chat-http filter limiting modes to Ask in `ChatComposer` (`availableModes`, `selectMode` guard).
- Remove `normalizeModeForScope` / `threadScopeNormalization` coercion of chat-http mode → Ask.
- Composer uses `listSelectableChatModes(settings)` intersected with provider capabilities.
- Mode labels from resolved mode `name` / built-in label.
- Update empty-state hint copy if it references ask-only.
- Ensure send path resolves mode via settings resolver (not hardcoded builtins only).

**Acceptance checklist**

- Chats composer shows Ask, Review, enabled custom modes, Raw (when enabled).
- Thread persisted with `mode: "review"` in chat-http loads and sends as Review (no normalization to Ask).
- Selecting disabled custom mode on stale thread shows Ask in UI or auto-corrects metadata to Ask.

Dependencies: Task 1, Task 2.

---

#### Task 6: Provider capabilities and Debug provider (P2-9) [Score:5] [Agent:easy]

**Required context**

1. Task 1 resolver
2. `app/src/lib/ai/providers/openAiCompatibleChatProvider.ts`
3. `app/src/lib/ai/providers/debugChatProvider.ts`
4. `app/src/lib/ai/capabilities.ts`

- Extend HTTP/Debug `supportedModes` to include `raw` and dynamic enabled custom mode ids (or validate via resolver: “mode resolves” instead of fixed list).
- Remove hardcoded `SUPPORTED_MODES: ["ask", "review"]` block for unknown custom ids when resolver succeeds.
- Update `getModeUnsupportedMessage` / preflight to reference Chat modes settings when appropriate.
- Debug simulator responses: include resolved mode id in diagnostic output (optional).

**Acceptance checklist**

- Preflight passes for enabled custom mode and Raw (when enabled).
- Preflight fails gracefully with recovery hint when mode id does not resolve.
- `openAiCompatibleChatProvider.test.ts` updated for `raw` and sample custom id.

Dependencies: Task 1, Task 2.

---

#### Task 7: Tests, validation suite, and docs (P2-9) [Score:7] [Agent:medium]

**Required context**

1. All prior tasks
2. `app/src/lib/state/chatPhase2.validation.test.ts`
3. `app/src/lib/ai/sendChatMessage.test.ts`
4. `app/src/lib/state/chatStore.test.ts` — chat-http review normalization tests (invert expectations)
5. `docs/architecture.md`, `docs/providers.md`

- Add/extend unit tests: resolver, prompt placeholders, structured parser, settings CRUD, composer mode list.
- Update chat-http tests that expect ask-only / review→ask normalization.
- Add validation test: custom mode send in chat-http; Review in chat-http; Raw disabled/enabled gating.
- Run `npm test` and `npm run check` from `app/`.
- Mark M5 exit criteria in this file; update [phase-2.md](./phase-2.md) milestone table.
- Changelog entry for M5 planning / completion as appropriate.

**Acceptance checklist**

- All M5 tasks marked `[DONE]`.
- No regressions in M4 multi-connection send, streaming, workspace Review.
- `npm test` / `npm run check` pass.

Dependencies: Tasks 1–6.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 5 → Task 7
     ↘ Task 3 ↗
     ↘ Task 4 ↗
     ↘ Task 6 ↗
```

Requires M4 (multiple providers) complete before Task 1.

## Mapping to phase-2 / phase-7 task IDs

| ID | Execution plan task |
|----|---------------------|
| P2-9 (new) | Milestone 5 — custom chat modes |
| P2-6 (update) | Supersedes chat-http ask-only portions of Task 5–7 |
| P7-2C | Partial overlap (mode templates in settings); per-thread override still phase 7 |

Phase 7 tier 2B (regenerate/edit) and tier 3 remain unchanged.

## Milestone 5 exit criteria

- [ ] Settings → Chat modes lists Ask, Review, Raw (read-only prompts) and custom modes (CRUD).
- [ ] Raw built-in disabled by default; enable toggle shows it in composer.
- [ ] Custom modes support name, prompt with `{{workspace}}` / `{{summary}}`, toggles, required sections, enable/disable.
- [ ] Formal presets seeded on first run (Ideation, Critical analysis, Technical specification, Executive summary).
- [ ] Structured custom modes and Review render section cards from required sections.
- [ ] All enabled modes available in Chats and workspace HTTP chat; Review works in Chats.
- [ ] Deleted/disabled/missing custom mode threads fall back to Ask.
- [ ] `npm test` / `npm run check` pass.

## Non-goals (M5)

- Per-thread system prompt override (phase 7 tier 2C).
- Regenerate or edit-message flows (phase 7 tier 2B).
- Import/export mode packs or marketplace.
- Non-markdown structured output formats (JSON schema mode).
- Workspace file reads beyond existing Review/HTTP policy.
- RAG, knowledge bases, Ollama UI (phase 7 tier 3).

## Key files (expected touch)

| Area | Files |
|------|--------|
| Schema | `contracts.ts`, `settingsSlice.ts`, `defaultSettings` |
| Modes | `modes/builtins.ts`, new `modes/resolve.ts`, `modes/prompt.ts` |
| Payload | `providers/openAiChatMessages.ts`, `providers/types.ts` |
| UI | `SettingsDialog.svelte`, `settingsDialogUi.ts`, `ChatComposer.svelte`, `ChatMessageList.svelte`, `ChatPanel.svelte` |
| Scope | `threadScopeNormalization.ts`, `chatStore/threads.ts`, `chatStore/agents.ts` |
| Providers | `openAiCompatibleChatProvider.ts`, `debugChatProvider.ts`, `capabilities.ts` |
| Persistence | `chatPersistence.ts` |
| Structured UI | `chatReviewContent.ts` |
| Tests | `builtins.test.ts`, `sendChatMessage.test.ts`, `chatStore.test.ts`, `chatPhase2.validation.test.ts` |
| Docs | `docs/architecture.md`, `docs/providers.md` |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-07 | Initial M5 execution plan — custom chat modes, Raw built-in, chat-http scope unification |
