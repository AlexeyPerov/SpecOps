# M8.2 — Find/Replace UX and Final Validation

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M8.1](./m8-1-search-model-execution-plan.md) complete  
**Status:** Done  
**Complexity:** Heavy — Score 7

How to use this plan: assign to one Svelte-focused agent. Complete the user-facing search experience and run the roadmap-wide editor regression gate.

## Goal

Make in-file and project find/replace fast, predictable, keyboard-friendly, and consistent with the new query model.

## Required context

1. M8.1 query/matcher APIs
2. `FindReplacePanel.svelte`
3. `ProjectSearchPanel.svelte`
4. M0 editor chrome/focus controller
5. Commands/bindings/catalog
6. Full parity roadmap acceptance criteria

## Task breakdown

#### Task M8.2-1: Upgrade in-file find/replace UI [Score:7] [Agent:heavy] [DONE]

- Add match-case, whole-word, and regex toggles with accessible pressed state and tooltips.
- Seed query from a non-empty single selection on open; otherwise retain the current window-local query.
- Add “find selection/next occurrence” command where it improves repeated search.
- Show invalid regex inline; disable navigation/replacement until valid.
- Preserve Enter/Shift+Enter, F3/Shift+F3, Escape, replace-next, replace-all, and focus cycling.
- Make panel responsive rather than fixed-width overflow.

**Acceptance checklist**

- Opening Find while already open focuses/selects the query.
- Closing clears highlights and restores editor focus.
- Document/pane switch refreshes match count without acting on stale host.
- Toggles are keyboard and screen-reader accessible.

Dependencies: M8.1.

---

#### Task M8.2-2: Align project search/replace UI [Score:7] [Agent:heavy] [DONE]

- Add the same query toggles and inline regex validation.
- Show skipped/changed/dirty file counts after replace.
- Add explicit confirmation summarizing file/match counts before project replace-all.
- Keep search cancellable during workspace switch/close and prevent stale results from opening.
- Preserve grouped results and open-at-line behavior; support exact range selection after open when feasible.

**Acceptance checklist**

- Project replace cannot run on invalid or stale query results.
- Confirmation is in-app and non-destructive cancellation leaves files untouched.
- Partial failures are visible and actionable.
- Workspace switch cancels and clears scoped results.

Dependencies: M8.2-1.

---

#### Task M8.2-3: Roadmap-wide regression and documentation gate [Score:7] [Agent:heavy] [DONE]

- Run focused scenarios across quick open, command palette, multi-cursor, folding/outline, auto-pairs, completion, snippets, heading jump, bookmarks, and search.
- Validate active-pane routing, multi-window, Markdown edit/split/preview, minimap, large-file confirmation, binary/image open, external reload, save/undo, and themes.
- Update README “What works today” and stable docs for shipped editor features.
- Review all roadmap plans/statuses; mark completed items and document intentionally deferred follow-ups.

**Acceptance checklist**

- `npm test` and `npm run check` pass.
- Every touched Svelte component passes the Svelte autofixer.
- No unresolved binding conflicts or inaccessible overlays remain.
- Product-wide criteria in `specs/text-editor-parity-v3/README.md` are checked.

Dependencies: M8.2-2 and all earlier milestones.

## Plan exit criteria

- [x] In-file and project search expose consistent query controls.
- [x] Replacement safety and feedback are complete.
- [x] Roadmap-wide regression gate passes.
- [x] User-facing documentation reflects shipped behavior.

## Changelog instructions

Mark tasks `[DONE]`; add dated entries for search UX and final roadmap completion, including test counts.

