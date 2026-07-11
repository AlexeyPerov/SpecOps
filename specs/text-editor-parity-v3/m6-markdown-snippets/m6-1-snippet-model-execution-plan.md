# M6.1 — Markdown Snippet Model and Insertion

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** M5 complete  
**Next:** [M6.2 snippet UX](./m6-2-snippet-ux-execution-plan.md)  
**Status:** Planned  
**Complexity:** Medium — Score 6

How to use this plan: assign to one agent. Build a safe snippet domain model and CodeMirror insertion path before adding management UI.

## Goal

Support reusable Markdown/spec templates with placeholders and tab stops, using the completion/snippet engine already introduced in M5.

## Required context

1. M5 autocomplete configuration
2. CodeMirror `snippet` / `snippetCompletion` APIs
3. Settings domain/store/normalization tests
4. Editor action/query contracts
5. Existing command and picker infrastructure

## Task breakdown

#### Task M6.1-1: Define snippet schema and built-in catalog [Score:5] [Agent:medium]

- Define stable id, name, description, trigger, body/template, scope, and source (`builtin`/`user`).
- Scope v1 to Markdown documents.
- Seed a small SpecOps-native catalog: front matter, requirements section, acceptance checklist, decision record, callout, fenced block, and table.
- Validate unique ids/triggers, lengths, placeholder syntax, and non-empty body.

**Acceptance checklist**

- Catalog content is useful for specs/notes and contains no reference-project terminology.
- Built-ins are immutable data; users may disable but not mutate them.
- Validation is pure and well tested.

Dependencies: M5.

---

#### Task M6.1-2: Add user snippet settings and normalization [Score:6] [Agent:medium]

- Add snippet settings with enabled built-in ids and user snippet records.
- Normalize malformed entries by dropping invalid records and resolving duplicates deterministically.
- Add state CRUD methods and persistence through existing settings.
- Do not migrate or preserve hypothetical older snippet formats.

**Acceptance checklist**

- Fresh settings receive documented defaults.
- Add/update/remove/enable flows have public-store tests.
- Invalid placeholders cannot crash the editor.
- No snippet body enters logs.

Dependencies: M6.1-1.

---

#### Task M6.1-3: Implement snippet insertion/completion source [Score:6] [Agent:medium]

- Expose enabled Markdown snippets as completion entries and as a direct insertion action.
- Support numbered tab stops, final cursor, selected-text placeholder if safely supported, and indentation adaptation.
- Define multi-cursor behavior (recommended: insert the same snippet at each cursor only if CodeMirror supports coherent tab-stop navigation; otherwise main selection only with clear status).
- Keep snippet sessions ephemeral.

**Acceptance checklist**

- Tab advances placeholders and exits at final cursor.
- Undo removes the whole insertion in one step.
- Indentation and line endings follow the document.
- Non-Markdown documents expose a disabled reason.

Dependencies: M6.1-2.

## Plan exit criteria

- [ ] Built-in/user snippet schemas and validation exist.
- [ ] Snippet settings persist without migration code.
- [ ] CodeMirror insertion/tab stops work and are tested.
- [ ] `npm test` and `npm run check` pass.

## Changelog instructions

Mark tasks `[DONE]`; log schema/defaults/insertion behavior and validation.

