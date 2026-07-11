# M7.1 — Quick Heading Jump

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** M4.2 and M6 complete  
**Next:** [M7.2 bookmarks](./m7-2-bookmarks-execution-plan.md)  
**Status:** Planned  
**Complexity:** Medium — Score 5

How to use this plan: assign to one agent. Reuse the Markdown outline model and picker shell; do not create a second heading parser.

## Goal

Provide a fast keyboard-first heading jump for users who do not want the outline panel open.

## Required context

1. M4.2 heading model/jump action
2. M0 searchable-picker shell
3. Command catalog and active-editor availability
4. Editor chrome overlay precedence

## Task breakdown

#### Task M7.1-1: Add heading-jump command and ranking [Score:4] [Agent:medium]

- Add `editor.goToHeading`, available only for editable Markdown with headings.
- Choose a conflict-free default binding after command-catalog validation; leaving it palette-only is acceptable if no standard binding is safe.
- Rank heading text with shared fuzzy matching; use hierarchy/path and proximity to cursor as tie-breaks.
- Preserve document order for empty query and mark the current heading.

**Acceptance checklist**

- Uses the exact M4.2 heading records and jump action.
- Duplicate heading labels remain distinguishable by hierarchy/line.
- Disabled reasons cover non-Markdown and heading-free documents.

Dependencies: M4.2.

---

#### Task M7.1-2: Build heading picker and validate navigation [Score:5] [Agent:medium]

- Render heading level/hierarchy, label, and line number.
- Enter reveals/unfolds the heading and restores editor focus.
- Support edit and split modes; define preview-only behavior consistently with the outline.
- Test edits while open, stale heading generations, duplicate headings, and pane/context switches.

**Acceptance checklist**

- Picker closes on document/context switch.
- A heading edited or deleted while open cannot jump to an unrelated stale range.
- Keyboard and screen-reader semantics reuse the shared picker.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M7.1-1.

## Plan exit criteria

- [ ] Users can fuzzy-jump to any Markdown heading.
- [ ] No duplicate heading parser/model exists.
- [ ] Fold reveal and focus behavior are correct.
- [ ] Validation passes.

## Changelog instructions

Mark tasks `[DONE]`; log command/default binding decision and validation.

