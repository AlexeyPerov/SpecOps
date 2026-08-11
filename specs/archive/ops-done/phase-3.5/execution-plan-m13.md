# Phase 3.5 Milestone 13 Execution Plan — HTTP Chat beta gate & Dev settings

**Spec:** [phase-3.5.md](./phase-3.5.md)  
**Index:** [execution-plan.md](./execution-plan.md)  
**Prerequisite:** [execution-plan-m12.md](./execution-plan-m12.md) (optional polish baseline; no hard dependency)

**Status:** completed

**Goal:** treat the dedicated **`chat-http`** context (activity-rail **Chat**, HTTP/Debug
providers, **Settings → Chats** subtree) as an **experimental beta feature** that is
**disabled by default**. Workspace agents (`ws-*`, OpenCode) remain the stable product
path and are unaffected.

When disabled:

- No **Chat** button on the activity rail.
- No **Chats** settings tabs (Providers, Chat modes, Debug Provider) — hidden entirely.
- Active `chat-http` context is evicted (reuse existing notepad fallback when rail hidden).
- Persisted provider config remains on disk but is not surfaced in UI.

When enabled (opt-in via **Settings → Dev**):

- Existing configuration gating applies (HTTP connection + model catalog, or Debug Provider).
- **Chats** settings tabs become visible under **Dev**.
- Activity rail shows **Chat (beta)** when configured.

Also: consolidate developer-facing settings — move **Logging** into a new **Dev**
section alongside the chat beta master toggle.

Relocate HTTP Chat documentation from README / main docs into `docs/beta/`.

How to use this plan: each task lists **Required context** — read only those docs for
that task. Cross-cutting **Confidence and Risks** below applies to every task.

---

## Problem

Today:

1. **`chat-http` is always eligible** once HTTP is configured or Debug Chat is enabled
   (`isChatHttpRailVisible` in `chatHttpRailGating.ts`). There is no product-level opt-in.
2. **Settings → Chats** (Providers, Chat modes, Debug Provider) is always visible in the
   sidebar (`settingsDialogUi.ts`).
3. **README** and **`docs/providers.md`** present HTTP Chat alongside stable workspace
   agents, implying equal maturity.
4. **Logging** settings live in a standalone **Logging** sidebar section — developer
   tooling scattered across the dialog.

Workspace agents already have a master toggle pattern (`opencode.enabled` in
`OpenCodeSettingsPanel.svelte`). HTTP Chat needs the same shape, inverted default
(stable path on by default; experimental path off by default).

## Scope

### In scope

| Area | Change |
| --- | --- |
| `chat-http` activity rail | Hidden unless feature enabled **and** configured |
| Settings sidebar | New **Dev** section: Chat (beta) master toggle + nested Chats tabs when on; **Logs** moved here |
| Persisted settings | New `chatHttp.enabled: boolean`, default `false` |
| Docs | Move HTTP Chat content to `docs/beta/`; trim README |
| Error copy / CTAs | Retarget `Settings → Dev → …` paths |

### Out of scope

| Area | Reason |
| --- | --- |
| Workspace agents (`ws-*`) | Stable product path; no beta gate |
| `opencode.enabled` | Already shipped (phase-3 M3.5) |
| **Appearance → Chat font scale** | Used by workspace agent messages too |
| Log setting **defaults** | Move UI only; keep `canOpenLogsPanel` / `verboseProviderLogging` defaults unless explicitly changed |
| Workspace **Debug Provider** | Stays under **Workspaces** |
| Data migrations / upgrade shims | Per AGENTS.md — existing installs with HTTP configured must re-enable in Dev |
| `chat-cloud` | Future phase; untouched |

## Assumptions

- Phase 3.5 workspace-agent work is complete; this milestone is product positioning for
  the legacy HTTP Chat lane, not new chat functionality.
- Default `chatHttp.enabled: false` applies to **all** installs (no inference from
  existing provider config).
- Persisted HTTP provider settings, API keys, and chat thread data remain on disk when
  the feature is disabled — only UI and rail access are gated.
- **Dev** is the user-facing section label (not "Developer Settings" in code identifiers).

## Confidence and Risks

Confidence: High.

Resolved constraints:

1. Master-toggle + nested-settings pattern exists (`opencode.enabled`).
2. Rail eviction when chat hidden already works (`syncAgentTabEffect` in
   `appShellEffects.ts`).
3. Settings sidebar is data-driven (`SETTINGS_SIDEBAR` in `settingsDialogUi.ts`).

Residual uncertainties:

1. **`openSettingsDialog("connections")` deep links** when chat disabled — redirect to
   Dev master toggle or no-op with updated copy (prefer redirect + explanation).
2. **Dynamic sidebar filtering** vs static registry — prefer a derived sidebar builder
   so hidden tabs are not reachable from measure/layout code paths unexpectedly.
3. **Existing users** lose the Chat rail until they opt in — intentional breaking UX;
   document in changelog.

## Decisions applied

| ID | Decision | Implication |
| --- | --- | --- |
| B1 | `chatHttp.enabled: boolean`, default `false` | Persisted in `settings.json` under `chatHttp` |
| B2 | Hide all Chats settings until enabled | Providers, Chat modes, Debug Provider tabs absent from sidebar |
| B3 | Master toggle in **Dev** section top | Visible even when Chats tabs hidden; label **Chat (beta)** |
| B4 | Move **Logs** to **Dev** | Remove standalone **Logging** section |
| B5 | Rail gating = `chatHttp.enabled &&` existing config check | Extend `isChatHttpRailVisible` |
| B6 | Docs → `docs/beta/` | e.g. `docs/beta/chat-http-providers.md`; README links there |
| B7 | No migration shim | Legacy configured users re-enable manually in Dev |
| B8 | Workspace agents unchanged | `opencode.enabled` independent of `chatHttp.enabled` |

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

---

## Task Breakdown

#### Task 1: Settings schema and persistence (M13-T1) [DONE] [Score:5] [Agent:easy]

**Required context**

1. `app/src/lib/domain/settings.ts` — `OpencodeSettings` (precedent)
2. `app/src/lib/services/opencodeSettings.ts` — normalize/defaults pattern
3. `app/src/lib/services/settingsStore.ts` — persisted settings load/save
4. `app/src/lib/state/appState/settingsSlice.ts` — apply persisted patches

- Add `ChatHttpSettings { enabled: boolean }` to domain types.
- Add `chatHttp: ChatHttpSettings` to `AppSettingsState` and `PersistedSettings`.
- Default: `{ enabled: false }`.
- Normalize: missing/invalid → `false` (opt-in only).
- Export helper `isChatHttpEnabled(settings)` for runtime gates.
- Wire through `defaultPersistedSettings`, `normalizePersistedSettings`, `toPersistedSettings`.
- Update `settingsStore.test.ts` and add `chatHttpSettings.test.ts` if split out.

**Acceptance checklist**

- Fresh install defaults to `chatHttp.enabled: false`.
- Legacy settings without `chatHttp` normalize to `false`.
- Typecheck and unit tests pass.

Dependencies: none.

---

#### Task 2: Gate activity rail and runtime (M13-T2) [DONE] [Score:6] [Agent:medium]

**Required context**

1. Task 1 output
2. `app/src/lib/ai/providers/chatHttpRailGating.ts` — `isChatHttpRailVisible`
3. `app/src/lib/services/appShellEffects.ts` — `syncAgentTabEffect` eviction
4. `app/src/routes/+page.svelte` — `chatHttpRailVisible` derived wiring
5. `app/src/lib/state/appState/workspaceContextsSlice.ts` — context snapshot

- Extend `isChatHttpRailVisible` (or wrapper) to require `isChatHttpEnabled(settings)`
  **before** existing HTTP/Debug configuration checks.
- Pass `chatHttp.enabled` from app state into all call sites of rail gating.
- Verify `syncAgentTabEffect` still switches to notepad when rail becomes invisible
  (including toggle-off while active).
- Optional: beta label on rail tooltip (`ActivityRail.svelte` — "Chat (beta)").

**Acceptance checklist**

- With `chatHttp.enabled: false`, Chat rail never appears even if HTTP fully configured.
- With `chatHttp.enabled: true` and valid HTTP/Debug config, rail appears (unchanged behavior).
- Toggling off while in `chat-http` returns user to notepad.
- `chatHttpRailGating.test.ts` and phase-2 validation tests updated.

Dependencies: Task 1.

---

#### Task 3: Dev settings section and sidebar restructure (M13-T3) [DONE] [Score:8] [Agent:medium]

**Required context**

1. Task 1 output
2. `app/src/lib/services/settingsDialogUi.ts` — `SETTINGS_SIDEBAR`, tab ids
3. `app/src/lib/components/SettingsDialog.svelte` — panel rendering
4. `app/src/lib/components/settings/OpenCodeSettingsPanel.svelte` — master toggle UX
5. `app/src/lib/components/settings/LogsSettingsPanel.svelte`

- Replace **Logging** section with **Dev** section in sidebar registry.
- Add **Dev** master panel (new `DevSettingsPanel.svelte` or section header panel) with:
  - **Chat (beta)** master toggle bound to `chatHttp.enabled`.
  - Short note: experimental HTTP chat context; workspace agents unaffected.
- When `chatHttp.enabled`:
  - Show nested Chats tabs under **Dev**: Providers (`connections`), Chat modes
    (`chatModes`), Debug Provider (`debugAi`).
- When disabled:
  - Hide those three tabs from sidebar and panel switcher.
  - Do not render their panels even if `activeTab` was previously one of them (reset to
    Dev panel on open or on toggle-off).
- Move **Logs** tab (`logs`) under **Dev** (always visible).
- Update `settingsDialogUi.test.ts` expected section/tab labels.
- Update `SettingsDialogMeasure.svelte` / chrome if tab list is dynamic.

**Acceptance checklist**

- Settings sidebar shows **Dev** with Logs always; **Chats** subtree only when enabled.
- No standalone **Logging** or **Chats** top-level sections remain.
- Master toggle matches OpenCode panel UX (explanation when off, nested content when on).
- Dialog measure/layout still works with dynamic tab count.

Dependencies: Task 1.

---

#### Task 4: Deep links, error copy, and blocked-state CTAs (M13-T4) [DONE] [Score:6] [Agent:medium]

**Required context**

1. Tasks 2–3 output
2. `app/src/lib/ai/chatErrorCopy.ts` — settings path strings
3. `app/src/lib/components/ChatBlockedState.svelte` — `openSettingsDialog` calls
4. `app/src/lib/services/settingsDialogUi.ts` — `openSettingsDialog`
5. Provider tests referencing `Settings → Chats → …`

- Retarget user-facing copy from `Settings → Chats → …` to `Settings → Dev → …`.
- When chat feature disabled, blocked/setup CTAs should open **Dev** (or Dev chat toggle)
  with message like "Enable Chat (beta) in Settings → Dev first."
- Guard `openSettingsDialog("connections" | "chatModes" | "debugAi")` when chat disabled:
  open Dev panel instead (or extend opener to accept fallback).
- Update tests: `chatErrorCopy` consumers, `retryChatTurn.test.ts`, provider error tests,
  `ChatBlockedState` if covered.

**Acceptance checklist**

- No user-facing string references **Settings → Chats** (grep clean or documented exceptions).
- CTAs work when chat disabled (land on Dev toggle, not broken/missing tab).
- Unit tests pass.

Dependencies: Task 3.

---

#### Task 5: Documentation relocation (M13-T5) [DONE] [Score:5] [Agent:easy]

**Required context**

1. `README.md` — chat-http bullets and context table
2. `docs/providers.md` — HTTP Chat provider doc
3. `docs/architecture.md` — settings sidebar references
4. `docs/opencode-integration.md` — scope boundary note

- Create `docs/beta/` directory.
- Move `docs/providers.md` → `docs/beta/chat-http-providers.md` (or equivalent name).
- Add short `docs/beta/README.md` index explaining beta/experimental features.
- Trim README:
  - Remove or demote dedicated **Chat** (`chat-http`) from "What works today" primary list.
  - Keep workspace agents / OpenCode as the main AI story.
  - Add one-line pointer: experimental HTTP Chat → `docs/beta/…`.
- Update `docs/architecture.md` settings tab list and any **Chats** section references.
- Update internal doc cross-links (`specs/`, `chatErrorCopy` comments if any).
- Leave `docs/opencode-integration.md` as stable-path doc; add cross-link to beta folder
  for HTTP Chat only.

**Acceptance checklist**

- `docs/beta/chat-http-providers.md` contains former `providers.md` content (updated paths).
- README no longer implies HTTP Chat is a default/on-by-default feature.
- No broken links from README or architecture doc.

Dependencies: Task 3 (settings path names should match docs).

---

#### Task 6: Index update and validation (M13-T6) [DONE] [Score:4] [Agent:easy]

**Required context**

1. All prior tasks
2. `specs/ops/phase-3.5/execution-plan.md`
3. `app/src/lib/state/chatPhase2.validation.test.ts`

- Add M13 row to `execution-plan.md` under a new "Post-M12" or "Product positioning"
  subsection.
- Run full validation: `npm test`, `npm run check`, `cargo test`.
- Update or add integration test documenting the full gate chain:
  `chatHttp.enabled` → config → rail visible.
- Mark tasks DONE in this file; changelog entry at milestone completion.

**Acceptance checklist**

- `execution-plan.md` indexes M13.
- Full test suite green.
- Phase-2 chat-http validation test expectations aligned with beta gate.

Dependencies: Tasks 1–5.

---

## Exit criteria

- `chatHttp.enabled` defaults to `false`; persisted and normalized correctly.
- Activity rail Chat button hidden unless feature enabled and configured.
- **Dev** settings section contains Chat (beta) master toggle and **Logs**; Chats subtabs
  hidden until enabled.
- User-facing copy and CTAs reference **Settings → Dev**, not **Settings → Chats**.
- HTTP Chat docs live under `docs/beta/`; README focuses on stable features.
- Workspace agents (`opencode.enabled`, agent UI, OpenCode settings) unchanged.
- `npm test` / `npm run check` / `cargo test` pass.

## Notes

- This milestone is **product positioning**, not new chat capability. It mirrors phase-3
  M3.5 (OpenCode opt-in) but for the inverse default on the HTTP Chat lane.
- **Appearance → Chat font scale** intentionally stays in **Appearance** — it affects
  workspace agent transcript rendering.
- If dynamic settings sidebar proves fragile in `SettingsDialogMeasure`, a minimal
  alternative is keep all tabs in the measure pass but filter visibility only in the
  live sidebar — document whichever approach is chosen in the changelog.
