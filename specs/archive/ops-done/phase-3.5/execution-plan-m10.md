# Phase 3.5 Milestone 10 Execution Plan — Reactive-store + backend factory

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m9.md](./execution-plan-m9.md) (M9 wire-reader
extraction lands first so the stores refactor against a clean baseline).

**Status:** DONE.

**Goal:** collapse the structural duplication identified in the review:

1. The reactive-store pattern (cache + inflight + diagnostic + never-throws
   degrade) is copy-pasted **seven** times across the workspace-agent services.
   `resolveRuntimeConfig()` / `emitDiagnostic()` / `getOrCreateStore` /
   `setState` / `clear` differ only by key arity and `kind` strings. A generic
   factory would collapse ~600 lines into one and stop drift.
2. The `resolveRuntimeConfig` + `createBackend` closure is duplicated ~10×
   across handlers and stores; M4 extracted it once
   (`opencodeConfigStore.ts:63-73`) but the other sites were never migrated.
3. The workspace-scoped stores never invalidate per-workspace on
   workspace-switch/close, and the four M5 stores share a single `emptyState`
   **by reference** in their cache snapshots — a snapshot-mutation foot-gun.
4. The M5 backend `listAndMap` template is copy-pasted 4× in
   `workspaceAgentBackend.ts`.

This is `[P2]` structural cleanup: no behaviour change at the happy path, with
two small correctness improvements (per-key invalidation, snapshot copy).

---

## Tasks

- [x] **[P2] M10-T1 — Generic reactive-store factory.** Introduce
  `createReactiveResourceStore<TState, TKey>(opts)` encapsulating the
  cache + inflight + diagnostic + degrade pattern, and migrate the seven
  existing stores onto it.
  - New helper, e.g. `app/src/lib/ai/opencodeResourceStore.ts`, exposing:
    - `emptyState` injection,
    - `keyOf(...args): string` (key arity is the only real per-store variance),
    - `kind` / diagnostic message builder,
    - `getOrCreateStore`, `setState`, `getSnapshot`, `refresh` (with inflight
      dedup), `clear`,
    - a `fetch` callback the store invokes (the only store-specific logic).
  - Migrate (verify each against its current behaviour first):
    - `app/src/lib/ai/opencodeCatalog.ts`
    - `app/src/lib/ai/opencodeConfigStore.ts`
    - `app/src/lib/ai/opencodeCommands.ts`
    - `app/src/lib/ai/opencodeTodoStore.ts`
    - `app/src/lib/ai/opencodeDiffStore.ts` (post-M7: keyed by
      `ws|session|messageId`)
    - `app/src/lib/ai/opencodeStatusSummary.ts`
    - `app/src/lib/services/fileStatusTracker.ts`
  - Preserve the existing reactivity split deliberately: the per-session stores
    (todo, diff) expose real Svelte `Readable` stores; the workspace stores
    (catalog, config, commands) are pull-only. Document this rationale in the
    factory so a future contributor doesn't reach for `.subscribe` on a
    pull-only store.
  - **Do not** unify the per-store `fetch` logic (catalog fetches 3 endpoints
    in parallel, config fetches 5, etc.) — only the skeleton is shared.

- [x] **[P2] M10-T2 — `createOpencodeBackendFromAppState()` helper.** Replace
  the ~10 duplicated `resolveRuntimeConfig` / `createBackend` closures with a
  single helper.
  - New helper (e.g. in `app/src/lib/ai/backends/opencodeBackendFactory.ts` or
    co-located with the catalog): reads
    `appState.getSnapshot().settings.opencode` once and returns a constructed
    backend (or `null` when disabled / no workspace root).
  - Adopt in:
    - `app/src/lib/services/appShellAgentHandlers.ts` (three near-identical
      closures at `:46-51`, `:175-180`, `:254-261`),
    - the seven stores above (each currently re-reads `appState` settings
      inline),
    - `opencodeSearch.ts`.
  - The helper is the single place that knows how to build a backend from app
    state; stores/handlers just receive one.

- [x] **[P2] M10-T3 — Per-key cache invalidation + snapshot-copy safety.**
  - Add `clearOpencodeCatalog(ws)` / `clearOpencodeConfigStore(ws)` /
    `clearOpencodeCommands(ws)` mirrors to the workspace stores (the per-session
    stores already have `clearSession*`). Wire them to workspace-switch /
    workspace-close so the process-lifetime cache doesn't accumulate an entry
    per workspace ever opened (slow leak in a long-running desktop app).
  - Fix the shared-`emptyState`-by-reference foot-gun in the four M5 stores:
    initialize each cache entry with a fresh copy
    (`value: { ...emptyState }`, plus `new Map()` for the fileStatus one) so a
    consumer mutating a pre-refresh snapshot can't corrupt the singleton across
    sessions/workspaces. (Current consumers treat snapshots as read-only, so
    this is preventive.)
  - Files: the seven stores; the workspace-switch/close effect (likely in
    `routes/+page.svelte` or a workspace-lifecycle effect).

- [x] **[P2] M10-T4 — `listAndMap` backend helper + factory tests.**
  - Extract the 4× copy-pasted M5 backend template
    (`workspaceAgentBackend.ts:2845-2944` — `listSessionTodos` /
    `listSessionDiffs` / `listFileStatuses` / `listLspStatuses`) into a small
    `listAndMap(client, op, mapper)` helper. The four methods become one-liners.
    Preserve the degrade-to-`[]` policy on
    `serverUnavailable | transportError | authFailure | notFound`.
  - Tests: `opencodeResourceStore.test.ts` (factory cache/inflight/diagnostic/
    clear behaviour with a fake `fetch`); existing per-store tests pass
    unchanged.

---

## Exit criteria

- One reactive-store factory; seven stores migrated; ~600 lines of skeleton
  duplication removed.
- One `createOpencodeBackendFromAppState()` helper; ~10 closure duplications
  removed.
- Workspace stores expose per-key `clear*`; wired to workspace lifecycle.
- M5 store snapshots are copy-safe.
- M5 backend `listAndMap` helper in place; four methods deduped.
- All existing tests pass (the per-store tests are the regression net);
  `npm test` / `npm run check` pass.

## Notes

- This is the largest milestone by line-count churn but the lowest risk per
  line: every store has an existing test suite that pins its behaviour. Run the
  full suite after each store migration rather than all-at-once.
- If migrating a store onto the factory would change its public accessor shape,
  stop and keep that store on its hand-rolled implementation — preserving the
  public API is more valuable than full uniformity. Note the exception in the
  changelog.
