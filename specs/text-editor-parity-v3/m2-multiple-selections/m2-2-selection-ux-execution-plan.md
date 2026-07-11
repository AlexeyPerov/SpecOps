# M2.2 — Multiple-Selection Commands and UX

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M2.1](./m2-1-selection-engine-execution-plan.md) complete  
**Next:** [M3 command palette](../m3-command-palette/m3-1-command-catalog-execution-plan.md)  
**Status:** DONE  
**Complexity:** Medium — Score 5

How to use this plan: assign to one agent. Expose and validate the selection engine through SpecOps commands, shortcuts, status, and discoverability.

## Goal

Make multiple selections practical for routine repeated edits without requiring users to know CodeMirror-specific gestures.

## Required context

1. M2.1 actions
2. Command definitions/handlers/bindings
3. Shortcuts settings
4. Status bar cursor rendering
5. App menu definitions/tests

## Task breakdown

#### Task M2.2-1: Register selection commands and resolve binding conflict [Score:5] [Agent:medium] [DONE]

- Add commands for select next occurrence, select all occurrences, skip occurrence, and remove last occurrence.
- Change `Cmd/Ctrl+D` from duplicate line to select next occurrence.
- Give duplicate line a non-conflicting default (`Cmd/Ctrl+Shift+D` recommended after conflict checks).
- Add platform-appropriate defaults for the remaining selection commands only where conventions are clear; otherwise leave unbound but palette-visible.

**Acceptance checklist**

- Definitions, handlers, menu, keymap, conflict detection, and shortcut settings agree.
- Existing customized user bindings continue to override defaults by command id.
- Release/changelog notes explicitly call out the changed duplicate-line default.

Dependencies: M2.1.

---

#### Task M2.2-2: Selection count and feedback [Score:4] [Agent:medium] [DONE]

- Extend editor cursor reporting with selection/range count.
- Show a compact status segment only when more than one selection exists.
- Report no-more-occurrence and unavailable-selection cases without noisy notifications on every keypress.
- Add accessible command labels and menu grouping.

**Acceptance checklist**

- Status returns to normal when secondary selections are removed.
- Inactive panes do not affect active-pane status.
- Screen-reader labels describe selection count.

Dependencies: M2.2-1.

---

#### Task M2.2-3: Cross-feature validation [Score:5] [Agent:medium] [DONE]

- Smoke test multi-cursor with Markdown split/edit modes, find panel, minimap, wrapping, tabs/panes, external reload, save, undo/redo, and snippets/completion placeholders reserved for later milestones.
- Test shortcut handling while CodeMirror has focus.
- Test IME composition and clipboard operations at multiple cursors where automatable.

**Acceptance checklist**

- Secondary selections survive ordinary editor commands unless the command intentionally replaces selection.
- Save content matches visible multi-range edits.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M2.2-2.

## Plan exit criteria

- [x] Multiple-selection commands are discoverable and correctly bound.
- [x] Status shows active selection count.
- [x] The duplicate-line binding transition is documented.
- [x] Cross-feature validation passes.

## Changelog instructions

Mark tasks `[DONE]`; add a dated entry with shortcut changes and test results.

