# M4.1 — Code and Document Folding

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** M0–M3 complete  
**Next:** [M4.2 Markdown outline](./m4-2-markdown-outline-execution-plan.md)  
**Status:** Done  
**Complexity:** Heavy — Score 7

How to use this plan: assign to one CodeMirror-focused agent. Prefer language-provided fold services and add a narrowly scoped Markdown fallback only where required.

## Goal

Let users collapse long Markdown sections and code structures with standard gutter and keyboard controls.

## Required context

1. M0 editor extension/action architecture
2. `editorLanguage.ts` language support
3. CodeMirror language `foldGutter`, fold service, and fold commands
4. Editor settings and command catalog
5. Markdown parser/highlighting behavior

## Task breakdown

#### Task M4.1-1: Add folding extension and commands [DONE] [Score:6] [Agent:medium]

- Add fold gutter and fold keymap through the editor extension registry.
- Add commands: toggle fold, fold current, unfold current, fold all, unfold all.
- Make gutter visibility a global editor setting (default on) if the gutter materially changes width; otherwise ship always on and document the decision.
- Theme fold markers with tokens and accessible titles.

**Acceptance checklist**

- Supported code languages fold syntax-tree regions.
- Commands target active pane and appear in palette/menu/shortcuts.
- Fold markers remain usable with line numbers, minimap, wrapping, and zoom.

Dependencies: M0–M3.

---

#### Task M4.1-2: Add Markdown heading-section folding [DONE] [Score:8] [Agent:heavy]

- Verify CodeMirror Markdown fold behavior; add a fold service for ATX and setext headings if native behavior is insufficient.
- Fold from a heading to the next heading of equal/higher level.
- Keep fenced code blocks governed by language syntax rather than heading fallback.
- Handle front matter, blockquotes, nested lists, and final sections conservatively.

**Acceptance checklist**

- Heading fold boundaries are covered by pure tests.
- Folding never deletes/changes document content.
- Nested section folds map correctly after edits.
- Preview/split mode content remains unaffected.

Dependencies: M4.1-1.

---

#### Task M4.1-3: Fold lifecycle and validation [DONE] [Score:6] [Agent:medium]

- Decide/document ephemeral fold policy: folds persist while a pane/editor view remains mounted but are not written to session storage.
- Verify tab/pane switching, document external replacement, language change, undo/redo, and multi-cursor.
- Add direct dependency only if a CodeMirror package is imported that is currently transitive.

**Acceptance checklist**

- Stale folds are safely mapped or dropped after document replacement.
- Fold state cannot cross documents.
- `npm test` and `npm run check` pass.

Dependencies: M4.1-2.

## Plan exit criteria

- [x] Standard folding works for supported code and Markdown sections.
- [x] Commands and gutter are discoverable/accessibly styled.
- [x] Fold lifecycle is tested and non-persistent.
- [x] Validation passes.

## Changelog instructions

Mark tasks `[DONE]`; log folding scope, settings/default decision, and tests.
