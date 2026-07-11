# M1.2 — Fuzzy File Quick Open UI

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M1.1](./m1-1-workspace-file-catalog-execution-plan.md) complete  
**Next:** [M2 multiple selections](../m2-multiple-selections/m2-1-selection-engine-execution-plan.md)  
**Status:** Planned  
**Complexity:** Medium — Score 6

How to use this plan: assign to one agent. Wire the M1.1 catalog into the shared picker shell and existing file-open pipeline.

## Goal

Add `Cmd+P` / `Ctrl+P` quick open for the active workspace, with responsive fuzzy filtering, keyboard operation, and correct pane/window routing.

## Required context

1. M0.6 picker shell
2. M1.1 catalog/ranking model
3. Command definitions/handlers/menu definitions
4. `AppShell.svelte` overlay hosts
5. `openActivePath.ts`, `openFileGate.ts`, and pane routing
6. Shortcuts settings UI/tests

## Task breakdown

#### Task M1.2-1: Add quick-open command and controller [Score:5] [Agent:medium]

- Add `app.quickOpenFile` with `Cmd+P` / `Ctrl+P`.
- Open only for an active folder-backed workspace; expose a disabled reason otherwise.
- Add route/shell controller state: open, query, active result, catalog status, and opener pane id.
- Capture the active pane at invocation and define behavior if that pane closes before selection (fall back to current active pane).

**Acceptance checklist**

- Command appears in menu/shortcuts/palette metadata.
- Repeated shortcut focuses/selects the query rather than opening duplicate overlays.
- Notepad and Chat contexts explain why the command is unavailable.

Dependencies: M1.1.

---

#### Task M1.2-2: Build and mount the file picker [Score:6] [Agent:medium]

- Render basename as primary text and relative directory as secondary text.
- Highlight fuzzy match ranges accessibly without fragmenting screen-reader labels.
- Show indexing/loading/partial-error/no-match states and total count.
- Support Enter/open, Escape/close, mouse selection, and optional refresh action.
- Open through the existing gated file path; preserve large/binary/image handling and focus the target pane.

**Acceptance checklist**

- Keyboard-only flow: invoke → type → navigate → Enter → editor focused.
- Existing open tab is focused rather than duplicated.
- Large, binary, and image candidates follow existing open behavior.
- Picker closes only after a successful handoff or explicit dismissal; failures remain visible with a status message.

Dependencies: M1.2-1.

---

#### Task M1.2-3: Validation and UX hardening [Score:4] [Agent:medium]

- Test command availability, selection routing, stale catalog updates, focus restoration, and open failures.
- Smoke test multi-pane, multi-window, workspace switch while open, and 10,000-entry filtering.
- Ensure picker does not conflict with permission/confirm/askpass overlays.

**Acceptance checklist**

- Workspace switch closes or atomically retargets the picker; choose and test one behavior (recommended: close).
- No path from another workspace can be opened after a switch.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M1.2-2.

## Plan exit criteria

- [ ] `Cmd/Ctrl+P` reliably opens active-workspace files.
- [ ] Picker is keyboard accessible and responsive at target scale.
- [ ] Existing file-open gates and pane semantics are reused.
- [ ] All validation passes.

## Changelog instructions

Mark tasks `[DONE]`; add a dated entry describing the command, UX, catalog scale, and tests.

