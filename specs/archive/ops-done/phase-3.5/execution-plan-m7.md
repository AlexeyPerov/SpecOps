# Phase 3.5 Milestone 7 Execution Plan — Critical bugfixes

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m2.md](./execution-plan-m2.md) (M2 handlers/stores),
[execution-plan-m3.md](./execution-plan-m3.md) (prompt history),
[execution-plan-m5.md](./execution-plan-m5.md) (diff store)

**Status:** DONE.

**Goal:** close the correctness bugs surfaced in the phase-3.5 architecture &
code-quality review. These are isolated, low-risk fixes that unblock declaring
phase 3.5 functionally complete.

These are the highest-priority follow-ups — each task carries a `[P0]` severity
(per the review's priority framing): blocking correctness defects that ship
wrong/stale data or dead-end UX.

---

## Tasks

- [x] **[P0] M7-T1 — Fix `promptHistory.nextHistoryDown` skipping index 0.**
  Arrow-down navigation from index 1 jumps straight to the empty draft and
  skips the top (index-0) entry, because the `next <= 0` guard fires for
  `next === 0`. The intended contract (see the `nextHistoryUp` docstring)
  is: at index 0 → return empty draft (`index = -1`); from index 1 → show
  index 0.
  - Fix: only short-circuit when `currentIndex <= 0` (already at/below the
    draft); the inner `next <= 0` branch should return the index-0 prompt,
    not `null`.
  - Files: `app/src/lib/services/promptHistory.ts` (`nextHistoryDown`,
    `:285-292`).
  - Tests: extend `promptHistory.test.ts` arrow-down cases — `currentIndex = 1`
    returns the index-0 entry; `currentIndex = 0` returns empty draft;
    existing clamp-at-bottom behaviour preserved.

- [x] **[P0] M7-T2 — Key `opencodeDiffStore` cache/inflight by `messageId`.**
  `refreshSessionDiffs` accepts and forwards a `messageId`, but `stateKey`
  (and therefore `storeCache` / `inflightRequests`) is only
  `${workspaceRootPath}|${sessionId}`. A scoped refresh
  (`messageId=A`) racing or caching against another scope returns the wrong
  message's files. It is the only parameterized reactive store with this flaw.
  - Fix: fold `messageId ?? "all"` into the `stateKey`. Keep the public store
    accessors stable.
  - Files: `app/src/lib/ai/opencodeDiffStore.ts` (`stateKey` `:33`,
    `getOrCreateStore`, `refreshSessionDiffs` `:121`).
  - Tests: **`opencodeDiffStore` has no test file at all** — create
    `opencodeDiffStore.test.ts` covering: keyed-by-`messageId` cache isolation,
    inflight dedup honours `messageId`, concurrent `messageId=A`/`messageId=B`
    refreshes don't cross-resolve, snapshot reflectiveness, error degradation
    to `error` status.

- [x] **[P0] M7-T3 — Stop `loadOpencodeConfigStore` from wiping cached data
  on transient reload failure.** The error branch overwrites the previously-good
  `config` / `providers` / `mcp` / `agents` / `skills` with `emptyState`. A
  subsequent `savePermissionConfig` then returns `false` (no `current.config`),
  even though the server still holds the config.
  - Fix: on a transient `getConfig` failure during a re-load, preserve the
    prior cached slices and only flip `status` → `"error"` +
    `lastErrorMessage`. A genuinely first-load failure (no prior data) still
    produces `emptyState`.
  - Files: `app/src/lib/ai/opencodeConfigStore.ts` (`loadOpencodeConfigStore`
    error branch `:186-196`).
  - Tests: add a case — a successful load followed by a failing reload keeps
    the prior `config`/`providers` and marks `status: "error"`.

- [x] **[P0] M7-T4 — Hydrate in `handleOpenExternalSession`.** A tab opened from
  the unified session list is created with a placeholder `title: "Opened
  session"` and never hydrated — unlike `handleForkAgent`. The placeholder
  title and empty message list persist until the user reopens the tab.
  - Fix: after creating the tab, call `hydrateWorkspaceAgentMessages`
    (best-effort, wrapped in `.catch(() => {})`, matching the M2 convention);
    seed `title` from `getSessionDetails` / the list-panel entry when available.
  - Files: `app/src/lib/services/appShellAgentHandlers.ts`
    (`handleOpenExternalSession` `:586-616`).
  - Tests: extend `appShellAgentHandlers.test.ts` — opening an external session
    triggers a best-effort hydration; hydration failure does not throw.

- [x] **[P0] M7-T5 — Emit a diagnostic in `handleListWorkspaceSessions`
  instead of silently swallowing errors.** A bare `catch {}` returns `[]` with
  no diagnostic, inconsistent with every sibling handler. The consumer
  (`+page.svelte`) has its own try/catch that is now unreachable dead code.
  - Fix: emit a diagnostic (`opencode.session.list` kind, matching the
    existing `emitDiagnostic` convention) and let the existing `[]`-degrade
    stand; remove the now-dead consumer try/catch if it is genuinely
    unreachable.
  - Files: `app/src/lib/services/appShellAgentHandlers.ts`
    (`handleListWorkspaceSessions` `:636-639`);
    `app/src/lib/routes/+page.svelte` (consumer try/catch).
  - Tests: assert a diagnostic is emitted on backend failure; the degrade-to-`[]`
    contract is unchanged.

---

## Exit criteria

- Arrow-up/down prompt-history cycling visits every entry including index 0.
- The diff viewer serves the correct message's files under concurrent /
  repeated scoped refreshes; `opencodeDiffStore.test.ts` exists.
- A flaky config reload no longer clears the in-memory config that
  `savePermissionConfig` depends on.
- Opening an external session hydrates title + messages (best-effort).
- Session-list failures are observable in diagnostics.
- `npm test` / `npm run check` / `cargo test` pass.
