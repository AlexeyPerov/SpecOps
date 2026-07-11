# M6.2 — Markdown Snippet Picker and Settings

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M6.1](./m6-1-snippet-model-execution-plan.md) complete  
**Next:** [M7 document landmarks](../m7-document-landmarks/m7-1-heading-jump-execution-plan.md)  
**Status:** Planned  
**Complexity:** Medium — Score 6

How to use this plan: assign to one Svelte-focused agent. Add discoverability and safe management around the M6.1 model.

## Goal

Let users insert snippets without remembering triggers and manage a modest set of custom Markdown templates.

## Required context

1. M6.1 model/actions
2. M0 searchable-picker shell
3. Settings view/tab patterns
4. Command catalog/availability
5. Editor focus restoration

## Task breakdown

#### Task M6.2-1: Add Insert Snippet command and picker [Score:5] [Agent:medium]

- Add `editor.insertSnippet`; leave unbound by default unless a conflict-free standard is chosen.
- Open a searchable picker containing enabled built-ins and user snippets.
- Display name, description, trigger, and source.
- Insert into the invoking editor/pane and restore focus with placeholder mode active.

**Acceptance checklist**

- Command is available only in editable Markdown.
- Empty/no-enabled state links or directs users to snippet settings.
- Selection cannot target a stale pane/document after context switch.

Dependencies: M6.1.

---

#### Task M6.2-2: Add snippet settings management [Score:6] [Agent:medium]

- Add an Editor → Markdown snippets settings section/panel.
- Enable/disable built-ins.
- Add, select, edit, duplicate, and remove user snippets.
- Provide template syntax help and inline validation; require confirmation before deleting a user snippet.
- Keep list/detail layout usable at current settings-view sizes.

**Acceptance checklist**

- Invalid edits remain local and cannot corrupt persisted settings.
- Trigger/id conflicts are shown before save.
- Built-ins cannot be overwritten or deleted.
- Keyboard and screen-reader labels cover list and editor controls.

Dependencies: M6.2-1.

---

#### Task M6.2-3: Cross-feature validation [Score:5] [Agent:medium]

- Test snippets with auto-pairs, completions, multi-cursor policy, undo/redo, Markdown split view, line endings, and custom shortcut overrides.
- Verify placeholders do not persist across tab/pane/document switches.

**Acceptance checklist**

- Snippet picker and command palette do not conflict.
- Completion list combines word/snippet entries predictably.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M6.2-2.

## Plan exit criteria

- [ ] Users can discover and insert enabled snippets.
- [ ] User snippets are safely manageable in settings.
- [ ] Placeholder/focus lifecycle is robust.
- [ ] Validation passes.

## Changelog instructions

Mark tasks `[DONE]`; add a dated entry describing built-ins, picker, settings, and tests.

