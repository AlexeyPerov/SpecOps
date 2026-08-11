# Phase 3.5 Milestone 6 Execution Plan — Appearance & feedback

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** none (can start in parallel with other milestones)

**Status:** **DONE** (2026-06-18).

**Goal:** font size, keybindings, sound/OS notifications, and theme
compatibility for new UI surfaces.

Theme scope: keep SpecOps themes as-is; extend only where new phase-3.5 UI
components need styling (see [questions.md Q8](./questions.md)).

---

## Tasks

- [x] **M6-T1 — Theme compatibility for new UI.** Audit new phase-3.5 components
  (reasoning blocks, subtask cards, config panels, etc.) against existing SpecOps
  CSS variables / theme tokens. Fix gaps; do **not** ship a new theme library or
  theme picker.
  - Outcome: the phase-3.5 components referenced structural CSS variables that
    were never defined (`--space-1/3/5/10`, `--color-border-strong`,
    `--color-selection`, `--color-surface-0/2`, `--color-danger`). Added them to
    `styles/tokens.css` for both light and dark; no new theme directory.
  - Files: `styles/tokens.css`; coverage in `styles/structuralTokens.test.ts`.

- [x] **M6-T2 — Font size configuration.** Settings for UI / editor / chat
  font size only — **do not change the current mono or sans font families** (no
  system font picker). Persist in `settings.json`.
  - Outcome: new `services/fontSettings.ts` (scale 60–200% per surface),
    `state/appState/fontSettingsSlice.ts` (writes `--font-size-ui/editor/chat`
    CSS vars), editor base size now reads `--font-size-editor` instead of a
    hardcoded 13px, and a new **Appearance** settings panel with three sliders.
  - Files: `services/fontSettings.ts`, `state/appState/fontSettingsSlice.ts`,
    `components/settings/AppearancePanel.svelte`, `editor/editorCommandRunner.ts`,
    `components/EditorSurface.svelte`, `styles/chatProse.css`, `styles/tokens.css`.

- [x] **M6-T3 — Keybinding customization.** Editable keybinds for workspace
  agent actions. Keybind editor dialog. Persist in `settings.json`.
  - Outcome: already fully implemented in prior milestones
    (`commands/commandBindings.ts` + `commandBindingRuntime.ts` act as the
    keybind store; `KeyboardShortcutsSettings.svelte` is the editor dialog;
    `commandBindingOverrides` persists via `settings.json`). This task added a
    persistence round-trip test to close M6-T6's "keybind persistence" item.
  - Files: `services/settingsStore.test.ts` (commandBindingOverrides round-trip).

- [x] **M6-T4 — Sound notifications.** Per-event sound settings (agent done,
  permission, question, error) with enable toggles and volume. See
  [questions.md Q9](./questions.md).
  - Outcome: `services/soundNotifications.ts` synthesizes a distinct two-note
    WebAudio tone per event (no asset files), gated by master enable + per-event
  toggle + 0–100 volume. Toggles live in the Appearance panel.
  - Files: `services/soundNotifications.ts`, `services/notificationSettings.ts`,
    `state/appState/notificationSettingsSlice.ts`, `components/settings/AppearancePanel.svelte`.

- [x] **M6-T5 — OS notifications.** Native notification on agent completion /
  permission / error when the window is not focused. See
  [questions.md Q9](./questions.md).
  - Outcome: `services/osNotifications.ts` uses the webview `Notification` API,
    requests permission lazily, and is gated by `document.hidden` (only fires
    when the window is not focused) plus master + per-event toggles. Wired via a
    non-intrusive observer (`services/agentNotificationObserver.ts`) that watches
    the active workspace's per-agent chatStore runtime transitions — no edits to
    `chatSendPipeline.ts`.
  - Files: `services/osNotifications.ts`, `services/agentNotificationObserver.ts`,
    `state/chatStore.ts` (`chatActiveRuntimeByAgentId` derived store),
    `routes/+page.svelte` (observer effect).

- [x] **M6-T6 — Tests.** Font size round-trip, keybind persistence, sound/OS
  notification toggles, theme token coverage for new components.
  - Outcome: 67 new tests. `fontSettings.test.ts` (scale clamp + round-trip),
    `notificationSettings.test.ts` (defaults + per-event toggles),
    `soundNotifications.test.ts` (gating + tone recipes),
    `osNotifications.test.ts` (window-focus + permission gating),
    `agentNotificationObserver.test.ts` (transition derivation + dispatch),
    `fontSettingsSlice.test.ts` (CSS-var application),
    `structuralTokens.test.ts` (token presence for both themes),
    `settingsStore.test.ts` (keybind + appearance persistence round-trips).
  - All 1655 TS tests pass; `svelte-check` reports 0 errors.

