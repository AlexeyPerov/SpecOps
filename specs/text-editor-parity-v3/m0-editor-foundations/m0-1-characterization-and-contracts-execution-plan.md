# M0.1 — Editor Characterization and Contracts

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** None  
**Next:** [M0.2 pane-aware runtime](./m0-2-editor-host-refactor-execution-plan.md)  
**Status:** Done  
**Complexity:** Medium — Score 6

How to use this plan: assign the entire file to one agent. This plan adds tests and defines target contracts before production behavior moves. Do not implement parity features here.

## Goal

Establish regression coverage for the editor lifecycle, active-pane command routing, search behavior, and document synchronization. Define bounded contracts that later milestones can extend without continuing the prop/facade sprawl.

## Required context

1. `specs/text-editor-parity-v3/README.md`
2. `app/src/lib/components/EditorSurface.svelte`
3. `app/src/lib/editor/editorCommandRunner.ts`
4. `app/src/lib/types/editor.ts`
5. `app/src/lib/components/EditorPaneContent.svelte`
6. `app/src/lib/components/AppShell.svelte`
7. `app/src/lib/services/appShellPageHandlers.ts`
8. Existing `editor/*.test.ts` and command-handler tests

## Task breakdown

#### Task M0.1-1: Characterize CodeMirror integration [DONE] [Score:5] [Agent:medium]

- Add a reusable jsdom CodeMirror fixture that mounts an `EditorView` without depending on a Svelte component harness.
- Cover document edits, selection changes, external content replacement, wrap/zoom reconfiguration, search highlighting, and destruction cleanup.
- Characterize document A → B → A behavior for selection and undo history; encode the target invariant that editor session state is document-scoped and must not cross documents.
- Verify programmatic content replacement does not report a user dirty edit.
- Verify a command targets the current view after active-pane registration changes.

**Acceptance checklist**

- Tests fail if document updates are double-reported or sent to a stale editor.
- Tests expose the current pane-scoped history/selection behavior and define the document-isolation expectation for M0.3.
- Tests cover selection/cursor reporting for at least one non-empty selection.
- Fixture cleanup leaves no editor DOM or timers behind.

Dependencies: none.

---

#### Task M0.1-2: Define editor host and command capability contracts [DONE] [Score:6] [Agent:medium]

- Replace the flat conceptual model with documented types for:
  - editor host lifecycle/registration,
  - editor actions,
  - editor queries,
  - command availability/capability.
- Keep compatibility aliases or adapters only inside this refactor series; do not add persisted-data compatibility.
- Specify how commands report unavailable/disabled state instead of silently no-oping.
- Specify that all editor actions target the active pane and that editor-local CodeMirror keymaps win while focus is inside the editor.

**Acceptance checklist**

- Contract names are SpecOps-native and do not expose raw `EditorView` outside `app/src/lib/editor/`.
- Future selection, fold, completion, snippet, bookmark, and search operations have an explicit extension point.
- Existing callers can be migrated incrementally in M0.2/M0.3.

Dependencies: M0.1-1.

---

#### Task M0.1-3: Characterize global key routing and overlay precedence [DONE] [Score:5] [Agent:medium]

- Extend `appShellPageHandlers` tests for:
  - editor/contenteditable focus,
  - normal input focus,
  - global commands,
  - editor-native commands,
  - Escape and overlay-open states.
- Encode precedence: active modal/picker → focused editor keymap → permitted global command → browser/default behavior.
- Record existing binding conflicts, especially `Cmd/Ctrl+D` currently assigned to duplicate line but needed for select-next occurrence.

**Acceptance checklist**

- Tests expose key-routing decisions without requiring `+page.svelte`.
- The `Cmd/Ctrl+D` decision is documented for M2: select-next becomes the default; duplicate line receives a new default binding.
- No user-visible shortcut changes land in this plan.

Dependencies: M0.1-2.

## Plan exit criteria

- [x] Characterization tests cover editor lifecycle and active-pane routing.
- [x] New contracts are documented and typechecked.
- [x] Shortcut/overlay precedence is test-backed.
- [x] No parity feature or persistence migration is introduced.
- [x] `npm test` and `npm run check` pass.

## Changelog instructions

- Mark completed task headings `[DONE]`.
- Add a dated entry to the top of `specs/changelog.md`.
- Record test count and any intentionally deferred gaps.
