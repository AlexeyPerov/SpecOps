# Refactoring R3 — Provider Abstraction and Polish (Execution Plan)

How to use this plan: each task lists **Required context** — read only those docs for that task. Scope and goals come from [refactoring-plan.md](./refactoring-plan.md).

**Prerequisite:** R0 and **R2** complete ([r0-execution-plan.md](./r0-execution-plan.md), [r2-execution-plan.md](./r2-execution-plan.md)), especially R2-6 (stable context API).

## Assumptions

- GLM remains the only **product** chat provider (`PRODUCT_CHAT_PROVIDER_IDS`); Debug stays dev-only.
- R3 generalizes **naming and registries** to add future providers without a second provider implementation being in scope.
- `glm-secrets.json` may be migrated to a provider-keyed secrets file — only if done without backward-compat shim per `AGENTS.md` (dev-only app); document breaking change in changelog.
- Svelte MCP/skills should be used when editing `.svelte` files in R3-5.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Provider plugin pattern exists: `ChatProvider`, `bootstrap.ts`, `providerModelCatalog.ts`.
2. Settings UI already has separate Debug and GLM sections.

Residual uncertainties:

1. Secrets file rename affects only local dev data — acceptable per project policy.
2. Svelte 5 migration of `+page.svelte` is large; split into sub-tasks if needed.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog entry.

## Milestone exit criteria

- Provider secrets load/save keyed by `ChatProviderId` (GLM path functional).
- Settings dialog tabs registered via a list/map, not hardcoded union growth for each vendor.
- Keymap definitions in `registry.ts` not duplicated Meta/Ctrl line-for-line.
- `DRAFT_AGENT_TITLE` used in all UI; no literal `"New agent"` in components.
- `+page.svelte`, `TabBar.svelte`, `EditorSurface.svelte` use Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`).
- `npm test` and `npm run check` pass.

---

## Task breakdown

#### Task R3-1: Provider-keyed secrets store [Score:5] [Agent:medium] [DONE]

**Required context**

1. [refactoring-plan.md](./refactoring-plan.md) (Provider-specific naming)
2. `app/src/lib/services/glmSecretsStore.ts`
3. `app/src/lib/domain/contracts.ts` (`ChatProviderId`)
4. `docs/providers.md`

- Add `app/src/lib/services/providerSecretsStore.ts`:
  - File e.g. `provider-secrets.json` version 1: `{ version: 1, keys: Partial<Record<ChatProviderId, string>> }`
  - `loadProviderApiKey(providerId)`, `saveProviderApiKey(providerId, key)`
- Replace direct `glmSecretsStore` usage with provider-keyed API; keep `loadGlmApiKey` / `saveGlmApiKey` as thin wrappers delegating to `"glm"` **or** remove wrappers and update call sites.
- Remove `glm-secrets.json` support without migration (document in changelog).
- Update `appState.setGlmApiKey` naming to `setProviderApiKey(providerId, key)` in settings slice **or** keep deprecated alias calling glm id.
- Update tests: `glmSecretsStore.test.ts` → `providerSecretsStore.test.ts`.

**Acceptance checklist**

- GLM API key persists and loads; send path still works.
- Settings dialog GLM key field saves via new store.
- `docs/providers.md` updated with new secrets path/shape.

Dependencies: R2-3 complete.

---

#### Task R3-2: Settings tab registry [Score:4] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/SettingsDialog.svelte`
2. `app/src/lib/services/settingsDialogUi.ts`
3. `app/src/lib/state/appState/` settings slice

- Define `SettingsTabDefinition` in `settingsDialogUi.ts` or colocated module:

  ```ts
  { id: SettingsDialogTab; label: string; /* optional component ref */ }
  ```

- Register tabs: `editor`, `glm` (label "GLM" or "AI Provider"), `debugAi` (label "Debug AI").
- Settings dialog renders sidebar from registry order; tab panels keyed by id.
- Rename type field `glm` → `provider-glm` only if worth breaking `openSettingsDialog("glm")` call sites — **optional**; document chosen ids.
- `ChatPanel` "open settings" CTAs still open correct tab.

**Acceptance checklist**

- All three settings tabs render and persist edits.
- Adding a mock fourth tab in registry requires no union type change in more than one place (ideally tab id union generated from registry or kept as string union extensibility note in plan).

Dependencies: R2-3.

---

#### Task R3-3: DRY command keymaps [Score:3] [Agent:easy] [DONE]

**Required context**

1. `app/src/lib/commands/registry.ts`
2. `app/src/lib/domain/contracts.ts` (`CommandBinding`, `CommandDefinition`)

- Add helper e.g. `expandPlatformKeymaps(definitions: CommandDefinition[]): Record<string, AppCommandId>` that builds `keyBindingsByPlatform` from each definition's `binding.mac` / `binding.windows`.
- Remove hand-maintained duplicate Meta/Ctrl maps (~50 lines × 2).
- Verify macOS and Windows key handling unchanged (`keymapCommandForEvent` tests if present, else add small unit test).

**Acceptance checklist**

- All documented shortcuts still dispatch correct `AppCommandId`.
- No duplicate static keymap entries remain.

Dependencies: none (can run early in R3).

---

#### Task R3-4: Shared constants and error helper [Score:2] [Agent:easy] [DONE]

**Required context**

1. `app/src/lib/services/chatAgents.ts` (`DRAFT_AGENT_TITLE`)
2. `app/src/lib/components/TabBar.svelte`, `ChatPanel.svelte`, `AgentsSidebar.svelte`
3. `app/src/lib/commands/commandErrors.ts`

- Replace hardcoded `"New agent"` in UI components with `DRAFT_AGENT_TITLE` import.
- Add `getErrorMessage(error: unknown): string` to `commandErrors.ts` (or reuse existing `summarizeError` where appropriate) and replace repeated `error instanceof Error ? error.message : "unknown error"` in hot paths (`+page.svelte`, `appShellRuntime.ts` if exists, `sessionManager.ts`) — limit scope to ~5 highest-duplication files, not entire codebase.

**Acceptance checklist**

- Grep for `"New agent"` in components returns zero (tests may still use literal).
- No behavior change in error messages shown to users.

Dependencies: none.

---

#### Task R3-5: Svelte 5 migration — EditorSurface and TabBar [Score:5] [Agent:medium] [DONE]

**Required context**

1. Svelte 5 skills / MCP for `.svelte` edits
2. `app/src/lib/components/EditorSurface.svelte`
3. `app/src/lib/components/TabBar.svelte`
4. `app/src/lib/components/TabBarContextMenu.svelte` (if extracted in R2-7)

- Migrate `EditorSurface.svelte`:
  - `export let` → `$props()`
  - `$:` → `$derived` / `$effect` as appropriate
- Migrate `TabBar.svelte` (and extracted submenu component) to `$props` / runes.
- Preserve `registerEditorCommandRunner` callback contract used by page/DocumentEditor.

**Acceptance checklist**

- Editor editing, syntax highlight, find highlight, scroll restore work.
- Tab strip selection, drag, context menu work.
- `npm run check` passes.

Dependencies: R2-7 recommended.

---

#### Task R3-6: Svelte 5 migration — +page.svelte [Score:7] [Agent:heavy] [DONE]

**Required context**

1. Svelte 5 skills / MCP
2. `app/src/routes/+page.svelte`
3. `app/src/lib/services/appShellRuntime.ts` (from R1)
4. `app/src/lib/components/DocumentEditor.svelte`, `MarkdownEditorPane.svelte`

- Migrate `+page.svelte` from legacy `$:` reactivity to runes:
  - Local UI state → `$state`
  - Store subscriptions → `$derived` from `$appState` / `$chatStore` or explicit subscribe in `$effect`
  - Side effects (persistence, project tree load, chat workspace sync) → `$effect` with clear dependencies
- Avoid `$:` entirely in finished file.
- Keep template structure; no new features.

**Acceptance checklist**

- Full manual smoke: startup, session restore, context switch, chat agent tab, markdown modes, settings, console.
- `npm run check` passes.
- No `$:` remaining in `+page.svelte`.

Dependencies: R1 complete, R3-5 recommended first (smaller components migrated before page).

---

#### Task R3-7: Provider settings naming cleanup (optional depth) [Score:4] [Agent:medium]

**Required context**

1. `app/src/lib/domain/contracts.ts` (`AppSettingsState`, `GlmProviderSettings`)
2. `app/src/lib/state/appState/settingsSlice.ts`
3. `app/src/lib/services/settingsStore.ts`

- Add generic shape e.g. `ProviderSettingsBase { enabled: boolean }` and keep `glmProvider: GlmProviderSettings` **or** introduce `providerSettings: Partial<Record<ChatProviderId, …>>` with typed narrowing helpers — choose minimal change that lets a future provider add settings without editing `AppSettingsState` core interface more than once.
- Persisted `settings.json` shape may change without migration (dev policy).
- Update normalization in `settingsStore.ts` and tests.

**Acceptance checklist**

- GLM and Debug settings still load/save.
- `ChatPanel` provider selection unchanged.
- Document final settings shape in `docs/providers.md`.

Dependencies: R3-1, R3-2.

**Note:** If R3-7 conflicts with time budget, mark as optional and skip; R3-1 + R3-2 satisfy main provider-abstraction exit criteria.

---

#### Task R3-8: Validation and docs [Score:2] [Agent:easy]

**Required context**

1. [refactoring-plan.md](./refactoring-plan.md) (R3 exit criteria)
2. `docs/architecture.md`, `docs/providers.md`

- Run `npm test`, `npm run check`.
- Update architecture doc: state module layout, secrets store, settings tab registry.
- Mark refactoring milestone series complete in changelog with summary of all R1–R3 outcomes.

**Acceptance checklist**

- Full suite green.
- Docs reflect post-refactor layout.
- R3 exit criteria verified.

Dependencies: R3-1 through R3-6 (R3-7 if executed).

---

## Task dependency graph

```
R3-3 ──┐
R3-4 ──┤
       ├──► R3-5 ──► R3-6 ──► R3-8
R3-1 ──► R3-2 ──► R3-7 ──┘
```

R3-3 and R3-4 can start immediately in parallel with R3-1.

## Testing map

| Task | Primary tests |
| --- | --- |
| R3-1 | `providerSecretsStore.test.ts`, `sendChatMessage.test.ts` smoke |
| R3-2 | Manual settings tabs; `settingsStore.test.ts` |
| R3-3 | New keymap unit test |
| R3-4 | Grep audit; existing UI tests |
| R3-5 | Manual editor + tab smoke; `npm run check` |
| R3-6 | Full manual smoke + test suite |
| R3-7 | `settingsStore.test.ts`, provider settings tests |
| R3-8 | Full suite |
