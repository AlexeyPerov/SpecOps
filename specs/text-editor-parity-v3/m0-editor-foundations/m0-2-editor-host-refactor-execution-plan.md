# M0.2 — Pane-Aware Editor Runtime

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.1](./m0-1-characterization-and-contracts-execution-plan.md) complete  
**Next:** [M0.3 document sessions](./m0-3-document-sessions-execution-plan.md)  
**Status:** Done  
**Complexity:** Heavy — Score 8

How to use this plan: assign to one strong editor-integration agent. Replace the single mutable runner prop chain with a route/window-scoped, identity-safe runtime. Do not change editor features.

## Goal

Guarantee that editor commands target the active pane/document and that late registration or teardown cannot replace the correct editor host.

## Required context

1. M0.1 contracts/tests
2. `types/editor.ts` and `editorCommandRunner.ts`
3. `EditorSurface.svelte`
4. `DocumentEditor.svelte`
5. `MarkdownEditorPane.svelte`
6. `EditorPaneContent.svelte`
7. `AppShell.svelte`
8. `+page.svelte` and `appShellPageHandlers.ts`
9. Svelte context/lifecycle guidance

## Task breakdown

#### Task M0.2-1: Implement a route-scoped editor workbench runtime [DONE] [Score:7] [Agent:heavy]

- Create one runtime per window/route, passed directly to route-level command handlers and shared with descendants through typed Svelte context.
- Register hosts with `{ paneId, documentId, generation }` and return an idempotent unregister callback/token.
- Resolve the active host using current active pane plus matching document identity.
- Expose typed action/query/status/focus APIs; never expose raw `EditorView` outside `app/src/lib/editor/`.
- Avoid module-global runtime state so windows and SSR cannot leak into each other.

**Acceptance checklist**

- Late registration from an old document generation is rejected.
- Unregistering an inactive/stale host cannot clear the active host.
- Pane close, document switch, context switch, and window teardown release registrations.
- Unit tests cover stale register/unregister and active-pane changes.

Dependencies: M0.1.

---

#### Task M0.2-2: Replace the mutable runner prop chain [DONE] [Score:8] [Agent:heavy]

- Remove `bind:editorRunner` and `registerEditorCommandRunner` plumbing across route, shell, pane, Markdown, and document wrappers.
- Make commands resolve the active host from the runtime at execution time.
- Move cursor/selection status publication through runtime subscriptions or typed callbacks instead of direct `appState` writes in the CodeMirror component.
- Keep inactive pane hosts registered only if their mounted views are alive.

**Acceptance checklist**

- No single mutable runner is passed through Svelte component layers.
- Menu commands, global shortcuts, and project-search go-to target the same active host.
- Active status cannot be overwritten by an inactive pane.
- Existing editor command tests pass through a runtime fixture.

Dependencies: M0.2-1.

---

#### Task M0.2-3: Normalize focus and key ownership [DONE] [Score:6] [Agent:medium]

- Encode precedence: active modal/picker → editor overlay → focused CodeMirror keymap → permitted global command.
- Keep palette/quick-open chords globally available while protecting ordinary inputs and IME composition.
- Remove command-specific keydown branches where runtime availability can decide behavior.

**Acceptance checklist**

- Menu, shortcut, and future palette execution use the same active-host lookup.
- CodeMirror-native commands are not blocked by the contenteditable guard.
- Focus/keyboard routing tests cover editor, inputs, overlays, and stale hosts.

Dependencies: M0.2-2.

## Plan exit criteria

- [x] A route/window-scoped pane-aware runtime owns editor registration.
- [x] The mutable runner prop chain is removed.
- [x] Commands and status resolve by active pane/document identity.
- [x] No user-facing behavior or persistence change lands.
- [x] `npm test` and `npm run check` pass.
- [x] Touched Svelte components pass the autofixer.

## Changelog instructions

Mark tasks `[DONE]`; add a dated structural entry with routing/lifecycle tests.
