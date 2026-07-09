# Execution Plan — App Performance Optimizations

**Scope:** Startup, tab switching, workspace switching  
**Template baseline:** [phase-0-execution-plan.md](./archive/git/phase-0-execution-plan.md)

How to use this plan: each task lists **Required context** — read only those files for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Assumptions

- Implementation is agent-only; human role is approval/review.
- Perf wins should prioritize user-perceived latency (time to interactive, context switch smoothness).
- Backward-compatibility shims for persisted data are out of scope unless explicitly requested.
- Optimizations should preserve current behavior and feature flags.
- Measurements should be captured before and after each optimization batch.

## Confidence and Risks

Confidence: **Medium** (clear hotspots, but some wins depend on realistic workspace/session sizes).

Resolved constraints:

1. High-probability hotspots are identified in startup and switch paths.
2. Existing architecture already supports incremental/lazy loading patterns.

Residual uncertainties:

1. Real-world perf bottlenecks may differ from code-level expectations (requires profiling traces).
2. Session hydration changes may surface edge cases in draft/session restore ordering.
3. Parallelizing file IO must avoid resource spikes on very large session indexes.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task P1: Baseline profiling and success metrics [Score:5] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. `app/src/lib/services/appShellRuntime.ts`
2. `app/src/lib/services/appShellAgentHandlers.ts`
3. `app/src/lib/state/chatStore/sessions.ts`
4. `app/src/routes/+page.svelte`

- Add lightweight diagnostic timings around:
  - app startup phases (including external checks and project tree load),
  - workspace session restore duration,
  - tab switch side-effects cost.
- Define and document target thresholds (e.g. p50/p95 startup, workspace switch, tab switch).
- Capture before-change baseline measurements on representative workspaces.

**Acceptance checklist**

- Baseline timings are logged and reproducible.
- Perf targets are documented in this plan or linked notes.
- At least one "small" and one "large" workspace profile is captured.

Dependencies: none.

### Perf targets and baseline notes (P1)

Filter Console / plugin logs with `metadata.kind === "perf"`. Metrics:

| Metric | Where emitted |
| --- | --- |
| `startup.phase` / `startup.total` | `appShellRuntime` |
| `workspace.sessionLoad` | `chatStore/sessions.loadWorkspaceSessions` |
| `workspace.restore` | `restoreWorkspaceSession` |
| `workspace.switchRestore` | `syncSessionTabEffect` |
| `projectTree.rootLoad` | `loadProjectTreeRoot` |
| `tab.activationSideEffects` | `onTabActivated` + shell effect in `+page.svelte` |

**Success thresholds** (interactive feel; measure after each later task):

| Flow | p50 target | p95 target |
| --- | --- | --- |
| Cold startup (`startup.total`) | ≤ 1500 ms | ≤ 3000 ms |
| Workspace switch restore (`workspace.switchRestore`) | ≤ 400 ms | ≤ 1200 ms |
| Session hydration only (`workspace.sessionLoad`, ≥20 sessions) | ≤ 150 ms | ≤ 500 ms |
| Tab activation side-effects (`tab.activationSideEffects`, file tab) | ≤ 50 ms | ≤ 150 ms |
| Project tree root load (`projectTree.rootLoad`, cache miss) | ≤ 100 ms | ≤ 300 ms |

**Baseline capture (2026-07-09):** [optimizations-baseline.json](./optimizations-baseline.json)

- **Small:** `~/Documents/notes` (~17 files, 18 open tabs / 21 docs).
- **Large:** `~/Projects/Unity-AI-Hub` (~8k files, 4 open tabs).
- Host-side IO proxies recorded there; re-capture in-app `perf` diagnostics on the same two workspaces before claiming P2–P6 wins.

---

#### Task P2: Incremental workspace session hydration [Score:8] [Agent:heavy] [~1.5d] [DONE]

**Required context**

1. `app/src/lib/state/chatStore/sessions.ts` (`loadWorkspaceSessions`)
2. `app/src/lib/services/appShellAgentHandlers.ts` (`restoreWorkspaceSession`)
3. `app/src/lib/state/chatStore/threadMetadata.ts`

- Replace serial full hydration in `loadWorkspaceSessions` with incremental strategy:
  - load index first,
  - hydrate active/visible sessions first,
  - defer non-visible thread hydration in background.
- Add bounded concurrency when reading thread files to avoid long serial waits.
- Ensure draft session merge semantics stay intact.

**Acceptance checklist**

- Workspace switching is measurably faster for workspaces with many sessions.
- No regression in session list correctness, active session restoration, or draft preservation.
- Diagnostics show reduced blocking time in restore path.

Dependencies: Task P1.

---

#### Task P3: Project tree reload trigger narrowing [Score:7] [Agent:medium] [~1d] [DONE]

**Required context**

1. `app/src/lib/services/appShellEffects.ts` (`syncProjectTreeWatcherEffect`)
2. `app/src/routes/+page.svelte` (effect dependencies)
3. `app/src/lib/services/projectTreeController.ts`

- Narrow `loadProjectTreeRoot` trigger conditions so tab/session churn does not repeatedly invoke root-load path.
- Gate reloads on actual workspace-root transition, explicit refresh, or hidden/show state changes.
- Keep watcher sync behavior correct when entering/leaving workspace context.

**Acceptance checklist**

- Tab switching no longer causes redundant project-tree root load attempts.
- Workspace switch still loads the correct root exactly once per transition.
- Project tree remains correct after explicit refresh and filesystem events.

Dependencies: Task P1.

---

#### Task P4: Startup external checks deferral strategy [Score:7] [Agent:medium] [~1d] [DONE]

**Required context**

1. `app/src/lib/services/appShellRuntime.ts` (startup phase ordering)
2. `app/src/lib/services/externalFileChanges.ts` (`runStartupExternalChecks`)
3. `app/src/lib/services/externalFileChangesRuntime.ts`

- Make startup external checks non-blocking for large tab sets:
  - prioritize active tab first,
  - defer remaining checks in background batches.
- Maintain safety guarantees for dirty/deferred prompts and no dialog storms.
- Keep startup path robust when checks fail.

**Acceptance checklist**

- App reaches interactive state sooner with many restored tabs.
- External change detection remains functionally correct.
- No duplicate prompts or missed deferred checks in manual validation.

Dependencies: Task P1.

---

#### Task P5: Tab/render hot-path lookup optimization [Score:6] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. `app/src/lib/components/TabBar.svelte`
2. `app/src/lib/components/EditorPaneView.svelte`

- Replace repeated `documents.find(...)` tab lookups with precomputed map/index per render cycle.
- Reuse lookup data for visibility checks, labels, and tooltips.
- Keep drag/drop and context-menu behavior unchanged.

**Acceptance checklist**

- Tab switching and drag interactions remain functionally identical.
- Render-time work is reduced in traces for large tab counts.
- No UI regressions in tab title/tooltip/missing markers.

Dependencies: Task P1.

---

#### Task P6: External watcher sync memoization [Score:6] [Agent:medium] [~0.5d]

**Required context**

1. `app/src/lib/services/appShellHelpers.ts` (`watchedPathsFromState`)
2. `app/src/lib/services/appShellRuntime.ts` (`syncExternalFileWatcher`)
3. `app/src/routes/+page.svelte` (effect trigger breadth)

- Reduce per-update recomputation of watched paths:
  - memoize doc-id/file-path lookup,
  - trigger sync only for path-affecting state changes where possible.
- Keep dedupe key semantics stable and watcher updates correct.

**Acceptance checklist**

- Fewer watcher-sync computations during non-file-related UI updates.
- File watcher updates still react correctly to open/close/rename/path changes.
- No missed watcher subscriptions in regression tests.

Dependencies: Task P1.

---

#### Task P7: Validation pass and regression guardrails [Score:6] [Agent:medium] [~0.5d]

**Required context**

1. All modified files from P2–P6
2. Existing tests for app shell runtime, chat sessions, project tree, and external checks

- Add/extend tests for:
  - workspace restore/hydration ordering,
  - project tree load trigger behavior,
  - startup external-check deferral,
  - tab rendering lookup path.
- Compare before/after perf metrics against targets.

**Acceptance checklist**

- Tests pass with new coverage on optimized paths.
- Perf metrics show meaningful improvement vs baseline for target flows.
- No known functional regressions in startup/tab/workspace flows.

Dependencies: Tasks P2, P3, P4, P5, P6.

---

## Dependency graph

```text
Task P1 → (P2, P3, P4, P5, P6) → P7
```

## Exit criteria

- [ ] Startup path is measurably faster on representative large sessions/workspaces.
- [ ] Tab switching avoids redundant heavy side-effects and remains smooth.
- [ ] Workspace switching latency is reduced, especially with many saved sessions.
- [ ] Project tree and external change detection remain behaviorally correct.
- [ ] Regression coverage added for all optimized pathways.

**Estimate:** ~5.5 days
