# M3.2 — Command Palette UI

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M3.1](./m3-1-command-catalog-execution-plan.md) complete  
**Next:** [M4 folding and outline](../m4-folding-markdown-outline/m4-1-code-folding-execution-plan.md)  
**Status:** Done  
**Complexity:** Medium — Score 6

How to use this plan: assign to one Svelte-focused agent. Reuse the M0.6 picker shell and dispatch through the existing registry.

## Goal

Add `Cmd/Ctrl+Shift+P` command discovery and execution across all SpecOps contexts.

## Required context

1. M0.6 picker shell
2. M3.1 command catalog
3. `AppShell.svelte`
4. `appShellPageHandlers.ts`
5. Command dispatch/context construction
6. Shortcuts settings and focus-management patterns

## Task breakdown

#### Task M3.2-1: Add palette command/controller [DONE] [Score:5] [Agent:medium]

- Add `app.openCommandPalette` with `Cmd/Ctrl+Shift+P`.
- Keep palette open/query/active-row state ephemeral and window-local.
- Snapshot the invocation context and refresh availability if active pane/context changes while open.
- Define nested invocation behavior (recommended: command palette supersedes quick open and editor tools, but never destructive/permission prompts).

**Acceptance checklist**

- Repeated shortcut focuses/selects the query.
- Escape restores focus to the invoking control/editor.
- Modal permission/confirm prompts take precedence and cannot be bypassed.

Dependencies: M3.1.

---

#### Task M3.2-2: Render and dispatch palette entries [DONE] [Score:6] [Agent:medium]

- Render label, category, effective shortcut, and disabled reason.
- Use shared fuzzy highlighting/list navigation.
- Enter dispatches enabled commands through the registry exactly once.
- Disabled rows remain navigable for explanation but cannot dispatch.
- Close before dispatch unless the chosen command explicitly needs palette feedback; document the rule.

**Acceptance checklist**

- Commands work from editor, notepad, workspace, session, settings, and VC view contexts according to availability.
- Async command rejection uses existing command error/notification handling.
- Search and keyboard navigation remain responsive across the full command set.

Dependencies: M3.2-1.

---

#### Task M3.2-3: Accessibility and integration validation [DONE] [Score:4] [Agent:medium]

- Test combobox/listbox semantics, active descendant, disabled description, focus restore, pointer selection, and shortcut display.
- Verify customized bindings and newly added M1/M2 commands.
- Run multi-window smoke tests.

**Acceptance checklist**

- Keyboard-only and screen-reader semantics are complete.
- Palette never dispatches stale or unavailable commands.
- `npm test`, `npm run check`, and Svelte autofixer pass.

Dependencies: M3.2-2.

## Plan exit criteria

- [x] `Cmd/Ctrl+Shift+P` opens a searchable command palette.
- [x] Availability and shortcuts are accurate.
- [x] Dispatch reuses the command registry.
- [x] Accessibility and validation gates pass.

## Changelog instructions

Mark tasks `[DONE]`; add a dated user-facing entry and validation details.
