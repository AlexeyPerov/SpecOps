# M5.1 — Auto-Close Pairs

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** M4 complete  
**Next:** [M5.2 document-word completion](./m5-2-document-word-completion-execution-plan.md)  
**Status:** Done  
**Complexity:** Medium — Score 5

How to use this plan: assign to one agent. Use CodeMirror language-aware close-bracket support with conservative Markdown behavior.

## Goal

Reduce routine typing friction for brackets, quotes, backticks, and Markdown delimiters without surprising users or breaking multi-cursor edits.

## Required context

1. M0 editor extension registry
2. M2 multiple selections
3. CodeMirror autocomplete `closeBrackets` APIs
4. `editorLanguage.ts`
5. Editor settings persistence/UI

## Task breakdown

#### Task M5.1-1: Add language-aware close pairs [DONE] [Score:5] [Agent:medium]

- Add `@codemirror/autocomplete` as a direct dependency.
- Enable standard close brackets and close-bracket keymap through the editor extension registry.
- Respect language data for code files.
- Define conservative Markdown pairs for brackets, parentheses, quotes, inline code, and emphasis only where CodeMirror behavior is predictable.

**Acceptance checklist**

- Typing an opener inserts the closer and leaves cursors inside.
- Typing an existing closer steps over it.
- Backspace removes an untouched empty pair.
- Multi-cursor operations behave identically at each compatible range.

Dependencies: M4 and M2.

---

#### Task M5.1-2: Configuration and edge cases [DONE] [Score:5] [Agent:medium]

- Add an Editor setting to enable auto-close pairs (default on).
- Reconfigure live without rebuilding the editor.
- Test selections, escaped characters, fenced code, mixed compatible/incompatible multi-cursors, undo, paste, IME composition, and external content replacement.
- Do not auto-wrap arbitrary selections unless CodeMirror’s standard command does so consistently; document the decision.

**Acceptance checklist**

- Setting persists through existing settings storage without migration.
- Disabled mode restores plain typing immediately.
- One typing action remains one undo step.
- No duplicate pairs during IME composition or paste.

Dependencies: M5.1-1.

## Plan exit criteria

- [x] Auto-close pairs work for routine Markdown and code typing.
- [x] Behavior is language-aware, configurable, and multi-cursor safe.
- [x] Direct dependency is declared.
- [x] `npm test` and `npm run check` pass.
- [x] Touched Svelte files pass the autofixer.

## Non-goals

- Smart Markdown block transformations.
- Emmet, tag completion, or language-server completion.
- Custom per-language pair configuration in this milestone.

## Changelog instructions

Mark tasks `[DONE]`; log defaults, dependency, settings, and validation.

