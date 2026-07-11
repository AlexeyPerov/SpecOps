# M0.3 — Document-Scoped Editor Sessions

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.2](./m0-2-editor-host-refactor-execution-plan.md) complete  
**Next:** [M0.4 CodeMirror composition](./m0-4-codemirror-composition-execution-plan.md)  
**Status:** Done  
**Complexity:** Heavy — Score 8

How to use this plan: assign to one CodeMirror lifecycle agent. Preserve one mounted view per pane while making history, selection, and future extension fields document-scoped.

## Goal

Prevent undo history, selections, folds, completion sessions, and bookmarks from following a pane when its active document changes.

## Required context

1. M0.1 document-isolation characterization
2. M0.2 workbench runtime
3. `EditorSurface.svelte`
4. `domain/document.ts`
5. Document close/context lifecycle slices
6. External-file replacement and session persistence services
7. CodeMirror `EditorState` and transaction annotations

## Task breakdown

#### Task M0.3-1: Extract an imperative editor view controller [DONE] [Score:8] [Agent:heavy]

- Move `EditorView` create/destroy, document switching, content synchronization, scroll ownership, and async language-load guarding out of Svelte.
- Use one narrow Svelte lifecycle bridge; keep `EditorView`, timers, and cleanup handles as ordinary/raw references.
- Tag external/store-origin transactions so dirty synchronization cannot feedback-loop.
- Make teardown idempotent and generation-aware.

**Acceptance checklist**

- Late language loads cannot configure a newer document.
- External replacement emits no user dirty edit.
- Scroll flush/restore occurs exactly once per document switch.
- Controller tests do not require mounting the full app shell.

Dependencies: M0.2.

---

#### Task M0.3-2: Add a document editor-session cache [DONE] [Score:8] [Agent:heavy]

- Cache an `EditorState` or equivalent document-session snapshot for each open document identity.
- Save state before switching a pane’s document; restore it when returning.
- Isolate selection, undo history, fold fields, completion/snippet state, and bookmark fields by document.
- Evict on document close/context destruction/window teardown.
- Define memory bounds and eviction behavior for many open documents.
- Persist only the existing scroll field; do not serialize new editor ephemera.

**Acceptance checklist**

- A → B → A restores A selection/history; undo in B cannot mutate A.
- The same document shown in multiple panes follows a documented policy (recommended: independent view sessions unless shared editing state is explicitly designed).
- Closing a document releases its cached state.
- Cache-size tests cover deterministic eviction without losing open-document content.

Dependencies: M0.3-1.

---

#### Task M0.3-3: Integrate external changes and lifecycle validation [DONE] [Score:7] [Agent:heavy]

- Apply clean external reloads as explicit document-targeted transactions.
- Ensure inactive cached sessions receive or invalidate against the latest document content.
- Validate rapid tab/workspace switching, split panes, Markdown mode changes, and window teardown.

**Acceptance checklist**

- Returning to an inactive document never resurrects pre-reload content.
- Dirty-document safety behavior remains unchanged.
- Runtime and cache leave no registrations, timers, or retained states after teardown.
- `npm test` and `npm run check` pass.

Dependencies: M0.3-2.

## Plan exit criteria

- [x] Editor session state belongs to documents, not pane history.
- [x] One imperative controller owns CodeMirror lifecycle.
- [x] External reload and cache eviction are safe/tested.
- [x] No new persisted fields or migration paths are added.

## Risks

- Cached `EditorState` increases memory use; enforce and test bounds.
- Full document content also lives in app state; avoid uncontrolled duplicate retention.
- Shared-document-in-two-panes semantics must be explicit before implementation.

## Changelog instructions

Mark tasks `[DONE]`; log session-isolation policy, memory bounds, and validation.

## Session isolation policy (implemented)

- Sessions are keyed by `{ paneId, documentId }` — independent view sessions when the same document is open in multiple panes.
- One `EditorView` remains mounted per pane; inactive document sessions are cached as `EditorState` snapshots.
- Scroll stays in `DocumentState.scrollTop` only (no new persisted editor fields).
- Memory bound: default max **32** inactive sessions; LRU eviction.
- Pane teardown invalidates that pane’s cached states (compartments are view-bound).
- Document close / context document set retention drops orphaned sessions.
- Disk reload notifies subscribers to invalidate cached sessions for that document; restore also rejects content mismatch.
