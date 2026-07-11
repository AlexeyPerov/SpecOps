# M8.1 — Unified Search Query Model

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** M7 complete  
**Next:** [M8.2 search UX](./m8-2-search-ux-execution-plan.md)  
**Status:** Planned  
**Complexity:** Heavy — Score 8

How to use this plan: assign to one strong editor/search agent. Replace the boolean/string search API with a tested query model shared by editor and project search where semantics match.

## Goal

Support literal/regex, case-sensitive, whole-word, selection-seeded search and correct replacements without duplicating incompatible matching engines.

## Required context

1. `editorSearchOps.ts`, `searchHighlight.ts`, and tests
2. `FindReplacePanel.svelte`
3. `projectSearch.ts`, `projectFileOps.ts`, `ProjectSearchPanel.svelte`
4. M0 editor host/chrome contracts
5. CodeMirror search `SearchQuery` semantics
6. External-file safety and project replace flow

## Task breakdown

#### Task M8.1-1: Define and validate search query contract [Score:6] [Agent:medium]

- Define query text, replacement, case sensitivity, whole word, regex, and optional scope.
- Return structured validation for invalid regular expressions.
- Specify Unicode/word-boundary behavior and zero-length regex handling.
- Specify replacement capture expansion (`$1`, named groups if supported) and literal-dollar escaping.

**Acceptance checklist**

- Query model is independent of Svelte/UI.
- Invalid regex cannot dispatch search or replacement.
- Tests document edge cases instead of relying on JavaScript defaults implicitly.

Dependencies: M7.

---

#### Task M8.1-2: Implement editor matcher/replacement semantics [Score:8] [Agent:heavy]

- Prefer `@codemirror/search` maintained primitives where they satisfy the contract; add it as a direct dependency.
- Support next/previous/wrap, all-match highlighting, current/total match info, replace current, and replace all.
- Preserve multi-selection behavior intentionally.
- Avoid full-document rebuilds for replacements; dispatch mapped CodeMirror changes.
- Handle zero-length matches without infinite loops.

**Acceptance checklist**

- Literal behavior remains backward compatible except documented bug fixes.
- Regex captures and whole-word matching are covered.
- Replace all is one undoable transaction.
- Search highlighting updates without recreating unrelated extensions.

Dependencies: M8.1-1.

---

#### Task M8.1-3: Align project search semantics safely [Score:8] [Agent:heavy]

- Reuse pure query compilation/match extraction for file contents where feasible.
- Extend project results with match length/ranges needed for regex replacement.
- Keep per-file errors isolated and report invalid query before traversal.
- Replace only the reviewed result generation; detect files changed since search using existing fingerprints or a fresh-content match policy.
- Do not silently overwrite dirty open documents; route through existing document/file safety rules.

**Acceptance checklist**

- Editor and project search agree on case/whole-word/regex semantics.
- Changed/dirty files are skipped or reconciled by a documented safe policy.
- Capture replacements work across project files.
- Tests cover mixed successes/failures and zero-length regex.

Dependencies: M8.1-2.

## Plan exit criteria

- [ ] One tested query contract drives in-file and project semantics.
- [ ] Regex/whole-word/capture replacement is correct and safe.
- [ ] Multi-selection and undo behavior are defined.
- [ ] `npm test` and `npm run check` pass.

## Risks

- Regex replacement can corrupt files if stale results are applied.
- JavaScript word boundaries are not fully Unicode-aware; choose and document semantics.
- Existing open dirty documents require explicit safety handling.

## Changelog instructions

Mark tasks `[DONE]`; log semantic changes, safety policy, dependency, and tests.

