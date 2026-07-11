# M7.2 — Document-Local Bookmarks

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M7.1](./m7-1-heading-jump-execution-plan.md) complete  
**Next:** [M8 find/replace polish](../m8-find-replace-polish/m8-1-search-model-execution-plan.md)  
**Status:** Planned  
**Complexity:** Medium — Score 6

How to use this plan: assign to one CodeMirror-focused agent. Bookmarks are ephemeral in v1; do not add session persistence.

## Goal

Let users mark and revisit important lines in any text document, complementing Markdown heading navigation.

## Required context

1. M0 editor extension/action architecture
2. M4 fold gutter integration
3. CodeMirror state fields/effects/decorations/gutters
4. Command catalog
5. M0 picker shell

## Task breakdown

#### Task M7.2-1: Implement bookmark state and markers [Score:7] [Agent:heavy]

- Add a CodeMirror state field/effects for toggling bookmark on the main cursor line, clearing one/all, and mapping bookmarks through document changes.
- Render bookmark markers in a gutter that coexists with line numbers and fold controls.
- Deduplicate multiple selections on the same line; define toggle behavior across multiple selected lines.
- Keep bookmarks per editor document view and ephemeral across app restart.

**Acceptance checklist**

- Insertions/deletions map bookmarks to the intended remaining lines.
- Deleting a bookmarked line removes or maps the mark by a documented rule.
- Markers are themed, clickable, and accessible.
- Bookmarks never cross documents/panes.

Dependencies: M7.1 and M4.

---

#### Task M7.2-2: Add commands and bookmark navigation [Score:6] [Agent:medium]

- Add toggle bookmark, next, previous, clear all, and list bookmarks commands.
- Assign conflict-free defaults only for toggle/next/previous if conventions fit; keep others palette-visible.
- Wrap next/previous within the document.
- Add a searchable/list picker showing line number and trimmed line preview.

**Acceptance checklist**

- Commands expose disabled reasons when no editable document/bookmarks exist.
- Jump reveals folded content and focuses the editor.
- Line preview is bounded and never logged.

Dependencies: M7.2-1.

---

#### Task M7.2-3: Validation [Score:5] [Agent:medium]

- Test edits, undo/redo, external replacement, folds, multi-cursor, tab/pane switch, document close, and large bookmark counts.
- Confirm no persistence/schema change.

**Acceptance checklist**

- Bookmark mapping is deterministic under transaction tests.
- Closing/reopening a file starts with no bookmarks and is documented.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M7.2-2.

## Plan exit criteria

- [ ] Any text document supports ephemeral bookmarks.
- [ ] Marker, next/previous, and list workflows work.
- [ ] Folding/multi-cursor interactions are tested.
- [ ] No persisted-data change is introduced.

## Changelog instructions

Mark tasks `[DONE]`; log ephemeral policy, commands, and validation.

