# M2.1 — Multiple-Selection Engine

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.4](../m0-editor-foundations/m0-4-codemirror-composition-execution-plan.md) complete; recommended after M1  
**Next:** [M2.2 selection UX](./m2-2-selection-ux-execution-plan.md)  
**Status:** Planned  
**Complexity:** Heavy — Score 7

How to use this plan: assign to one CodeMirror-focused agent. Use CodeMirror selection primitives; do not build a parallel selection model.

## Goal

Enable robust multiple selections and cursors across all text/Markdown editor panes while preserving dirty tracking, undo grouping, and existing line operations.

## Required context

1. M0 editor runtime/session/action contracts
2. CodeMirror state/view/commands/search APIs
3. `editorCommandRunner.ts`, `editorLineOps.ts`
4. `EditorSurface.svelte`
5. Current command bindings, especially `edit.duplicateLine`

## Task breakdown

#### Task M2.1-1: Enable native multiple and rectangular selections [Score:6] [Agent:medium]

- Add `EditorState.allowMultipleSelections.of(true)`.
- Add CodeMirror rectangular/column-selection support and visible selection drawing if needed by the current theme.
- Verify mouse modifier behavior on macOS and Windows.
- Keep all selection state ephemeral and per mounted editor view.

**Acceptance checklist**

- Multiple cursors can be created by modifier-click and column drag.
- Typing/deleting edits every range in one undoable transaction.
- Selection visuals remain readable in all built-in themes and with minimap enabled.

Dependencies: M0.4.

---

#### Task M2.1-2: Add occurrence-selection actions [Score:7] [Agent:heavy]

- Add select-next occurrence using CodeMirror’s maintained search command.
- Define and implement select-all occurrences, skip current occurrence, and remove most recently added occurrence where supported.
- Seed from selection; when empty, select the word/token at the main cursor.
- Avoid duplicate/overlapping ranges and preserve main-selection semantics.
- Add `@codemirror/search` as a direct dependency before importing its API.

**Acceptance checklist**

- Wrap/no-more-match behavior is deterministic and communicated.
- Case behavior matches exact selected text by default.
- Unicode words and punctuation-heavy Markdown tokens have documented/tested behavior.
- Commands operate on the active pane only.

Dependencies: M2.1-1.

---

#### Task M2.1-3: Make existing line operations multi-range safe [Score:8] [Agent:heavy]

- Audit indent/outdent, move line, duplicate line, join lines, find/replace, external content replacement, and cursor status against multiple ranges.
- Replace full-document single-main-range transforms where necessary with CodeMirror transactions/change mapping.
- Deduplicate shared lines when multiple cursors touch the same line.
- Preserve one undo step per command.

**Acceptance checklist**

- No existing command silently discards secondary selections.
- Duplicate/move/indent behavior is deterministic for adjacent and duplicate line ranges.
- Search navigation may replace the main selection only, but must document whether secondary ranges are retained or cleared.
- Unit/integration tests cover multi-range edits and undo.

Dependencies: M2.1-2.

## Plan exit criteria

- [ ] Native multiple/column selections work.
- [ ] Occurrence-selection actions are available through editor actions.
- [ ] Existing editor commands are audited and multi-range safe.
- [ ] `npm test` and `npm run check` pass.

## Changelog instructions

Mark tasks `[DONE]`; log selection behavior, direct dependency addition, and validation.

