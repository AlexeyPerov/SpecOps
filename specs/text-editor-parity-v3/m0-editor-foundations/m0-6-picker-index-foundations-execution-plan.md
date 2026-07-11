# M0.6 — Searchable Picker and Workspace Index Foundations

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.5](./m0-5-svelte-editor-chrome-refactor-execution-plan.md) complete  
**Next:** [M1 fuzzy file open](../m1-fuzzy-file-open/m1-1-workspace-file-catalog-execution-plan.md) and [M3 command palette](../m3-command-palette/m3-1-command-catalog-execution-plan.md)  
**Status:** Planned  
**Complexity:** Heavy — Score 8

How to use this plan: assign to one agent. Build reusable picker mechanics, command availability, and workspace enumeration contracts without exposing a file picker or command palette yet.

## Goal

Avoid duplicate palette implementations and repeated full workspace walks. Establish accessible searchable-list primitives, fuzzy ranking, unified command metadata, and a cancellable workspace catalog boundary.

## Required context

1. M0.2 runtime and M0.5 overlay host
2. `DialogShell.svelte`, `SessionListPanel.svelte`, `MentionPicker.svelte`, `SlashCommandPopover.svelte`
3. Command definitions/registry/handlers/bindings
4. `folderOpenableFiles.ts`, `projectTree.ts`, `projectSearch.ts`
5. File watcher events and shell effects

## Task breakdown

#### Task M0.6-1: Implement pure fuzzy ranking and list navigation [Score:6] [Agent:medium]

- Add generic fuzzy scoring with deterministic tie-breaks and match ranges.
- Prefer contiguous, word-boundary, basename/label-start, and caller-supplied recent matches.
- Add pure active-index helpers for arrows, paging, Home/End, empty lists, and result changes.
- Bound returned results.

**Acceptance checklist**

- Tests cover paths, commands, acronyms, separators, case insensitivity, and stable ties.
- Empty query preserves caller ordering.
- Ranking logic contains no UI markup.

Dependencies: M0.5.

---

#### Task M0.6-2: Add an accessible searchable-picker shell [Score:7] [Agent:heavy]

- Build a reusable Svelte 5 shell for query, state, rows, active descendant, footer hints, and focus restoration.
- Support controlled query/index, keyboard navigation, Enter, Escape, pointer interaction, and active-row scrolling.
- Integrate with M0.5 overlay precedence; do not force destructive dialogs onto this shell.

**Acceptance checklist**

- Correct dialog/combobox/listbox semantics and stable option ids.
- Keyboard navigation retains focus in the query input.
- Consumers supply row rendering/selection without duplicating key logic.
- Theme/reduced-motion behavior is token-driven.

Dependencies: M0.6-1.

---

#### Task M0.6-3: Unify command catalog and availability [Score:7] [Agent:heavy]

- Extend command metadata with category, search terms, palette intent, and availability resolver.
- Keep handlers/dispatch separate from display.
- Use one availability/conflict policy for menu, shortcuts, and future palette.
- Add consistency tests across command ids, definitions, handlers, menus, and palette intent.

**Acceptance checklist**

- Availability distinguishes hidden, disabled-with-reason, and enabled.
- Adding a command without explicit discoverability intent fails a clear test.
- No state mutation or I/O occurs during availability resolution.

Dependencies: M0.6-1.

---

#### Task M0.6-4: Define shared workspace file catalog [Score:8] [Agent:heavy]

- Extract one traversal policy for hidden/heavy directories, symlinks, and openable files.
- Implement a workspace-scoped catalog with normalized absolute/relative paths, generation cancellation, loading/error state, disposal, and watcher invalidation.
- Let project search consume a catalog snapshot instead of initiating a duplicate tree walk.
- Do not read file contents during catalog construction.

**Acceptance checklist**

- Stale enumeration cannot overwrite a newer workspace generation.
- Workspace close/window teardown cancels and releases catalog state.
- Project tree/search/quick-open share traversal policy without sharing UI state.
- Partial unreadable-directory errors are non-fatal and tested.

Dependencies: M0.6-1.

## Plan exit criteria

- [ ] Fuzzy/list navigation is pure and tested.
- [ ] Shared picker shell is accessible.
- [ ] Command availability/discoverability is unified.
- [ ] Cancellable workspace catalog replaces duplicate enumeration boundaries.
- [ ] No quick-open or palette command is user-visible.
- [ ] `npm test`, `npm run check`, and Svelte autofixer pass.

## Changelog instructions

Mark tasks `[DONE]`; log structural foundations, scale/cancellation tests, and validation.

