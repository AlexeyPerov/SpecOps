# M0.5 — Svelte Editor Chrome Refactor

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.4](./m0-4-codemirror-composition-execution-plan.md) complete  
**Next:** [M0.6 picker/index foundations](./m0-6-picker-index-foundations-execution-plan.md)  
**Status:** Planned  
**Complexity:** Heavy — Score 7

How to use this plan: assign to one Svelte-focused agent. Convert touched editor wrappers to Svelte 5 and move editor-tool orchestration out of route/component prop chains without changing UX.

## Goal

Create a coherent editor-chrome controller for find, go-to, future outline/bookmarks, and focus restoration. Isolate Markdown DOM lifecycles before new panels are introduced.

## Required context

1. M0.2–M0.4 runtime/controller/action APIs
2. `DocumentEditor.svelte`
3. `MarkdownEditorPane.svelte`
4. `FindReplacePanel.svelte`
5. `EditorPaneContent.svelte`
6. `AppShell.svelte` and `+page.svelte`
7. Official Svelte runes, attachments, lifecycle, and accessibility guidance

## Task breakdown

#### Task M0.5-1: Convert legacy editor wrappers to Svelte 5 runes [Score:6] [Agent:medium]

- Convert `DocumentEditor.svelte`, `MarkdownEditorPane.svelte`, and `FindReplacePanel.svelte` from `export let` / `$:` to typed `$props`, `$derived`, and narrow lifecycle bridges.
- Keep non-reactive imperative references out of deep `$state`.
- Remove direct `appState` access from presentational find UI.

**Acceptance checklist**

- No touched editor wrapper uses legacy props/reactive statements.
- Effects invoke imperative controllers without mutating mirrored Svelte state.
- Existing Markdown edit/split/preview behavior remains unchanged.

Dependencies: M0.4.

---

#### Task M0.5-2: Isolate Markdown preview DOM lifecycles [Score:7] [Agent:heavy]

- Extract cancellable split-scroll synchronization.
- Extract local-image fallback/listener/blob-URL ownership with generation guards.
- Keep preview link handling in a focused service/attachment.
- Ensure stale `tick()`/async work cannot attach to a newer document.

**Acceptance checklist**

- All listeners/object URLs are released on document/mode/component changes.
- Rapid document/mode switching cannot attach stale handlers.
- Split scrolling and local image fallback retain current behavior.

Dependencies: M0.5-1.

---

#### Task M0.5-3: Add editor tool controller and focus-restoring host [Score:7] [Agent:heavy]

- Group active tool, find state, go-to input, and focus restoration in a window-local controller.
- Replace route-local query fields and separate global open flags.
- Introduce reusable overlay/listbox chrome for future quick-open/palette without implementing those features.
- Enforce one editor tool at a time and explicit modal precedence.

**Acceptance checklist**

- Pane/document/context switches cannot leave a tool bound to stale identity.
- Closing restores focus to the active editor.
- `AppShell.svelte`/`EditorPaneContent.svelte` do not gain one prop per future tool.
- Focus, Escape, and single-flight behavior have tests.

Dependencies: M0.5-2.

## Plan exit criteria

- [ ] Legacy editor wrappers use Svelte 5 runes.
- [ ] Markdown imperative lifecycles are cancellable and isolated.
- [ ] Editor tools use a grouped controller and shared focus host.
- [ ] No user-facing feature/persistence change.
- [ ] `npm test`, `npm run check`, and Svelte autofixer pass.

## Changelog instructions

Mark tasks `[DONE]`; add a dated structural entry with lifecycle/focus validation.

