# M0.4 — CodeMirror Extension and Action Composition

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.3](./m0-3-document-sessions-execution-plan.md) complete  
**Next:** [M0.5 Svelte editor chrome](./m0-5-svelte-editor-chrome-refactor-execution-plan.md)  
**Status:** Done  
**Complexity:** Heavy — Score 7

How to use this plan: assign to one editor-integration agent. Centralize instance-owned extensions and migrate full-document operations before feature extensions arrive.

## Goal

Make CodeMirror capabilities composable without adding one compartment, effect, and flat runner method per feature.

## Required context

1. M0.2 runtime and M0.3 controller/session cache
2. `EditorSurface.svelte`
3. `editorCommandRunner.ts`
4. `editorLanguage.ts`, `editorMinimap.ts`, `searchHighlight.ts`
5. `editorLineOps.ts` and tests

## Task breakdown

#### Task M0.4-1: Extract instance-owned extension assembly [DONE] [Score:7] [Agent:heavy]

- Add named extension groups for base behavior, theme, language, search, minimap, decorations, and future parity features.
- Centralize compartment ownership per view/session; remove module-global mutable compartments.
- Keep base keymaps in one ordered list and document precedence.
- Preserve line numbers, history, Tab indentation, wrap, zoom, highlighting, minimap, and plaintext decoration.

**Acceptance checklist**

- [x] `EditorSurface.svelte` no longer assembles extensions or declares compartments.
- [x] Reconfiguring one group does not rebuild unrelated groups.
- [x] Two simultaneous panes have independent search/configuration compartments.
- [x] Extension order and toggles have tests.

Dependencies: M0.3.

---

#### Task M0.4-2: Split actions and queries by editor domain [DONE] [Score:6] [Agent:medium]

- Implement grouped APIs (`history`, `selection`, `lines`, `navigation`, `search`, `view`) over the runtime host.
- Replace the conceptual flat `EditorCommandRunner`.
- Return typed availability/results instead of silent no-ops.
- Keep command handlers free of raw CodeMirror types.

**Acceptance checklist**

- [x] Existing undo/redo, indent, line, go-to, wrap/zoom, and search commands use grouped APIs.
- [x] M2/M4–M8 have reserved extension/action seams without changing this lifecycle again.
- [x] No component outside the editor layer imports `EditorView`.

Dependencies: M0.4-1.

---

#### Task M0.4-3: Replace full-document single-selection line operations [DONE] [Score:8] [Agent:heavy]

- Replace `withEditorSelection` full-document rewrites with mapped CodeMirror changes.
- Preserve all selection ranges and one undo transaction.
- Deduplicate overlapping/adjacent line ranges.
- Retain pure line-transform helpers only where they remain useful.

**Acceptance checklist**

- [x] Existing line-op edge cases pass.
- [x] Secondary selections are not discarded.
- [x] Large-document commands avoid replacing unchanged text.
- [x] Transaction tests cover adjacent and duplicate selected lines.

Dependencies: M0.4-2.

## Plan exit criteria

- [x] Extension/compartment ownership is per editor instance.
- [x] Grouped actions/queries replace flat runner growth.
- [x] Line operations are transaction-based and selection-safe.
- [x] `EditorSurface.svelte` is a thin lifecycle adapter.
- [x] `npm test` and `npm run check` pass.

## Changelog instructions

Mark tasks `[DONE]`; add a dated entry describing extension/action boundaries and tests.
