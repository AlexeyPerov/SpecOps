# M4.2 — Markdown Heading Outline

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M4.1](./m4-1-code-folding-execution-plan.md) complete  
**Next:** [M5 typing assistance](../m5-typing-assistance/m5-1-auto-pairs-execution-plan.md)  
**Status:** Planned  
**Complexity:** Heavy — Score 7

How to use this plan: assign to one agent. Build heading extraction as editor-domain logic, then add a lightweight outline surface for long specs.

## Goal

Provide an always-current structural view of Markdown headings and one-click/keyboard navigation without requiring full symbol indexing or LSP.

## Required context

1. M0 editor host/chrome controller
2. M4.1 Markdown fold boundaries
3. `MarkdownEditorPane.svelte`
4. `EditorPaneContent.svelte`
5. Existing right/bottom panels and responsive layout rules
6. CodeMirror Markdown syntax tree

## Task breakdown

#### Task M4.2-1: Implement heading model and incremental updates [Score:7] [Agent:heavy]

- Extract ATX/setext headings with level, display text, document range, line, and stable-enough key.
- Prefer CodeMirror syntax tree to regex; keep a pure fallback/parser test surface.
- Ignore headings inside fenced code, HTML blocks, and escaped syntax.
- Update from editor transactions with debounce/bounded work for large documents.
- Expose heading list and jump action through the active editor host.

**Acceptance checklist**

- Tests cover nested headings, duplicates, setext, fenced code, edits, and empty documents.
- Updates cannot publish headings from a stale document/pane.
- Jump selects/reveals the heading without changing content.

Dependencies: M4.1.

---

#### Task M4.2-2: Add outline UI and commands [Score:7] [Agent:heavy]

- Add a collapsible outline panel or editor tool integrated with the grouped chrome controller.
- Render heading hierarchy with indentation, current-section highlight, and filtering.
- Add commands to toggle outline and focus outline.
- Keyboard support: Up/Down, Left/Right collapse if tree UI is used, Enter jump, Escape return to editor.
- Hide/disable outside Markdown edit-capable documents with a clear palette reason.

**Acceptance checklist**

- Outline works in Markdown edit and split mode; preview-only mode can navigate by switching/focusing edit according to a documented rule.
- Current heading tracks cursor with bounded updates.
- Responsive widths do not obscure the editor or existing AI panels.
- Screen-reader labels include heading level and text.

Dependencies: M4.2-1.

---

#### Task M4.2-3: Folding/outline integration and validation [Score:5] [Agent:medium]

- Indicate folded sections in the outline where practical.
- Jumping to a folded heading reveals/unfolds enough content to show the target.
- Validate duplicate headings, very long documents, minimap, split panes, and focus restoration.

**Acceptance checklist**

- Outline and fold state never diverge after edits.
- 2,000 synthetic headings remain responsive under an agreed test budget.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M4.2-2.

## Plan exit criteria

- [ ] Markdown heading extraction is syntax-aware and tested.
- [ ] Outline provides accessible structural navigation.
- [ ] Folding and outline cooperate.
- [ ] Validation passes.

## Changelog instructions

Mark tasks `[DONE]`; add a dated entry with parser/UI behavior and scale validation.

