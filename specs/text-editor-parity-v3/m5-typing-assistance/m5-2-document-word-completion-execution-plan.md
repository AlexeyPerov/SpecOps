# M5.2 — Document-Word Completion

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M5.1](./m5-1-auto-pairs-execution-plan.md) complete  
**Next:** [M6 Markdown snippets](../m6-markdown-snippets/m6-1-snippet-model-execution-plan.md)  
**Status:** Done  
**Complexity:** Medium — Score 6

How to use this plan: assign to one agent. Deliver local, privacy-preserving completion only; do not introduce LSP or workspace-content indexing.

## Goal

Offer fast completion from words already present in the active document, sufficient for repeated terminology in notes/specs and light code edits.

## Required context

1. M5.1 direct autocomplete dependency
2. M0 editor extension registry
3. M2 multi-cursor behavior
4. CodeMirror autocompletion and `completeAnyWord`
5. Editor settings and command catalog

## Task breakdown

#### Task M5.2-1: Add bounded local-word completion source [DONE] [Score:6] [Agent:medium]

- Configure CodeMirror autocompletion with an active-document word source.
- Bound scan size/candidate count for large documents.
- Deduplicate case-aware candidates and exclude the exact current token.
- Prefer nearby/recent occurrences and longer useful prefixes.
- Never read other files, AI context, or network sources.

**Acceptance checklist**

- Repeated spec terms are suggested from the current document.
- Suggestions update after edits without retaining stale document content.
- Large-document behavior is bounded and tested.
- No document text is logged.

Dependencies: M5.1.

---

#### Task M5.2-2: Trigger, settings, and completion UX [DONE] [Score:6] [Agent:medium]

- Add an Editor setting for automatic suggestions (recommended default off initially) and keep manual completion available.
- Add `editor.triggerCompletion` with `Ctrl+Space` on both platforms unless macOS system conflicts require a documented alternative.
- Configure Tab/Enter/Escape acceptance/dismissal without breaking Tab indentation, snippets, or palette shortcuts.
- Theme completion rows and selected state with existing tokens.

**Acceptance checklist**

- Manual completion works regardless of automatic-suggestion setting.
- Tab indents when no completion is active.
- Completion targets every compatible cursor or explicitly only the main cursor; choose, document, and test behavior (recommended: CodeMirror default).
- Command appears in palette/shortcuts with context availability.

Dependencies: M5.2-1.

---

#### Task M5.2-3: Validation [DONE] [Score:4] [Agent:medium]

- Test Markdown punctuation, Unicode, code identifiers, very short prefixes, multi-cursor, auto-pairs, undo, and document switching.
- Verify completion state closes on pane/context switch and does not leak words.

**Acceptance checklist**

- No stale candidates after document switch.
- Completion remains responsive at configured large-file thresholds.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M5.2-2.

## Plan exit criteria

- [x] Local document-word completion works manually.
- [x] Automatic suggestions are bounded and configurable.
- [x] Tab/indent and multi-cursor behavior are tested.
- [x] No workspace-wide or AI completion is introduced.

## Changelog instructions

Mark tasks `[DONE]`; log completion scope/defaults and validation.

