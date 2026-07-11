# M3.1 — Command Catalog and Availability

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.6](../m0-editor-foundations/m0-6-picker-index-foundations-execution-plan.md) complete  
**Next:** [M3.2 palette UI](./m3-2-command-palette-ui-execution-plan.md)  
**Status:** Planned  
**Complexity:** Medium — Score 6

How to use this plan: assign to one agent. Build a complete searchable command model before rendering the palette.

## Goal

Make the existing command registry the single source of truth for labels, categories, shortcuts, discoverability, availability, and palette dispatch.

## Required context

1. M0.6 command metadata and fuzzy ranking
2. `domain/commands.ts`
3. `commands/definitions.ts`
4. `commands/registry.ts`
5. `commands/handlers/*`
6. `commands/commandBindings.ts`
7. Native app menu definitions

## Task breakdown

#### Task M3.1-1: Complete command metadata [Score:6] [Agent:medium]

- Assign every user-invokable command a category and optional search aliases.
- Separate menu placement from palette visibility; hidden menu commands may still be palette-visible.
- Add availability resolvers using command context/state for workspace-only, editor-only, Markdown-only, git-only, and view/layout actions.
- Provide disabled reasons suitable for UI and tests.

**Acceptance checklist**

- Every registered command is intentionally visible or intentionally excluded with a reason.
- Labels and categories are SpecOps-native and do not expose internal ids.
- Availability resolution is pure and does not mutate state or perform I/O.

Dependencies: M0.6.

---

#### Task M3.1-2: Build searchable palette entries [Score:5] [Agent:medium]

- Merge effective platform bindings with command metadata.
- Rank label first, then category/aliases/id as lower-weight terms.
- Keep disabled commands searchable and sorted, but mark them non-runnable.
- Define empty-query ordering by category and practical frequency.
- Add APIs for retrieving one fresh snapshot when the palette opens and refreshing availability after a command.

**Acceptance checklist**

- Tests cover label, alias, category, shortcut display, disabled reason, hidden commands, and stable ordering.
- Customized shortcuts appear in entries immediately after settings changes.
- No handler is duplicated in the palette model.

Dependencies: M3.1-1.

---

#### Task M3.1-3: Registry consistency validation [Score:4] [Agent:medium]

- Add tests that compare `AppCommandId`, definitions, handlers, app menu inclusion policy, and palette policy.
- Fail tests for duplicate labels in the same category or duplicate default bindings.
- Document allowed exceptions.

**Acceptance checklist**

- Adding a future command without palette/menu intent fails a clear test.
- Existing intentional unbound commands remain valid.
- `npm test` and `npm run check` pass.

Dependencies: M3.1-2.

## Plan exit criteria

- [ ] A complete, tested command catalog exists.
- [ ] Availability and disabled reasons are centralized.
- [ ] Effective shortcut display is shared with Shortcuts settings.
- [ ] No visible palette ships in this plan.

## Changelog instructions

Mark tasks `[DONE]`; log catalog/availability changes and consistency-test results.

