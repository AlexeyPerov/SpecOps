# Phase 3 Milestone 3 Execution Plan — Workspace HTTP removal, cleanup, closure

**Spec:** [phase-3.md](./phase-3.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m1-5.md](./execution-plan-m1-5.md) and [execution-plan-m2.md](./execution-plan-m2.md) complete

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task. This milestone closes phase-3 MVP.

## Assumptions

- Milestones 1, 1.5, and 2 complete and satisfy MVP gate E3B (stream + tools + permission/question replies).
- Workspace contexts (`ws-*`) are now OpenCode-driven by design.
- Chat (`chat-http`) and Cloud (`chat-cloud`) remain unchanged and must not regress.
- Breaking documentation update is required: legacy workspace HTTP thread/session paths are no longer active and are not migrated (E2A).
- No backward-compat migration shims should be added unless explicitly requested.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Cutover trigger is explicit in [phase-3.md](./phase-3.md): remove workspace HTTP only after MVP criteria.
2. Workspace backend abstraction allows context-based routing without changing chat/cloud lanes.
3. Exit criteria already define required post-cutover validation and test gates.
4. M1.5 contract docs freeze OpenCode API/event/reply semantics before HTTP path removal.
5. M1.5 contract-freeze baseline doc is the authoritative cutover reference.

Residual uncertainties:

1. Removing HTTP branches may affect persisted metadata assumptions in workspace tabs.

## Decisions applied (resolved)

1. Execute full workspace-lane audit before closure (runtime paths, settings/help copy, docs, and tests).
2. Hidden `sendChatMessage`/`ChatProvider` dependencies are treated as blockers for Task 1/2 completion.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Workspace context send-path cutover to OpenCode only (P3-7) [Score:8] [Agent:medium] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — Remove workspace HTTP deliverable
2. Workspace composer/send runtime and context routing modules
3. Provider-selection logic used by workspace contexts
4. [execution-plan-m1-5.md](./execution-plan-m1-5.md) outputs
5. [opencode-contract-freeze-m1-5.md](./opencode-contract-freeze-m1-5.md)

- Remove or bypass workspace usage of HTTP `ChatProvider` in `ws-*` contexts.
- Ensure workspace send dispatch always resolves through `WorkspaceAgentBackend("opencode")` for this phase.
- Keep `chat-http` context fully on HTTP provider path.
- Remove remaining workspace preflight coupling to HTTP provider validation and rely on OpenCode health/backend readiness.
- Add explicit guard assertions/logging if a workspace flow attempts HTTP provider send.

**Acceptance checklist**

- No workspace send path invokes HTTP `ChatProvider`.
- Workspace prompts continue functioning via OpenCode backend.
- `chat-http` send behavior remains unchanged.
- Workspace send path no longer depends on HTTP provider validation prerequisites.

Dependencies: Milestones 1.5 and 2 complete.

---

#### Task 2: Remove stale workspace HTTP branches and dead code (P3-7) [Score:7] [Agent:medium] [DONE]

**Required context**

1. Task 1 output
2. Workspace/provider helpers, feature flags, and blocked-state components
3. Existing tests that encode workspace HTTP assumptions
4. [opencode-api-mapping.md](./opencode-api-mapping.md)

- Remove obsolete workspace-only HTTP checks, fallback branches, and unreachable UI states.
- Keep shared provider modules used by `chat-http`; remove only workspace coupling.
- Clean up stale types/flags/comments that imply workspace HTTP is still active.
- Update developer-facing diagnostics/log messages to reflect OpenCode-first workspace runtime.
- Remove obsolete run-id/run-endpoint adapter assumptions superseded by M1.5 alignment.
- Treat any remaining workspace-lane HTTP coupling as a blocker; do not defer to follow-up.

**Acceptance checklist**

- Workspace code paths no longer include dead HTTP-branch logic.
- No behavior change in Chat/Cloud contexts due to cleanup.
- Typecheck and tests remain green after removals.
- Workspace adapter/runtime surface reflects OpenCode session/event terminology rather than run endpoints.

Dependencies: Task 1.

---

#### Task 3: Breaking-change docs and user-facing notes (P3-7, E2A) [Score:6] [Agent:easy] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — E2A no migration note
2. [roadmap.md](../roadmap.md) — lane/runtime description
3. Relevant user docs/settings copy referencing workspace backend behavior
4. M1.5 contract docs (`opencode-*`)

- Update phase 3 spec/checklists if needed to mark cutover complete.
- Add clear note in docs: legacy workspace HTTP thread JSON is not imported/migrated to OpenCode sessions.
- Ensure settings/help copy differentiates:
  - Chat lane uses HTTP connections
  - Workspace lane uses OpenCode backend in phase 3
- Reference contract docs as implementation authority for API/event semantics.
- Include full copy audit for workspace lane in the done criteria (no stale HTTP messaging).

**Acceptance checklist**

- Cutover and no-migration policy is documented in specs/docs.
- User-facing copy does not imply workspace HTTP remains supported.

Dependencies: Tasks 1, 2.

---

#### Task 4: Regression and validation sweep (P3-8) [Score:8] [Agent:heavy]

**Required context**

1. [phase-3.md](./phase-3.md) — Exit criteria
2. Validation tests for chat, cloud, and workspace contexts
3. Tasks 1–3 outputs
4. M1.5 verification baseline

- Extend/refresh tests for:
  - workspace send routing (OpenCode only)
  - explicit non-regression for `chat-http` and `chat-cloud`
  - session restore behavior post-cutover
  - tool/permission/question flows in workspace
  - OpenCode contract-aligned event normalization and reply paths
- Run full quality gate from `app/`: `npm test` and `npm run check`.
- Perform manual smoke script on real workspace folder:
  - run with sidecar mode
  - run with URL mode
  - validate permission/question/tool interactions

**Acceptance checklist**

- Test suite covers cutover invariants and cross-context regressions.
- `npm test` / `npm run check` pass from `app/`.
- Manual smoke confirms workspace OpenCode flow works end-to-end.

Dependencies: Task 3.

---

#### Task 5: Phase-3 closure updates (P3-8) [Score:5] [Agent:easy]

**Required context**

1. [phase-3.md](./phase-3.md) — exit criteria and checklist
2. [execution-plan-m1.md](./execution-plan-m1.md), [execution-plan-m1-5.md](./execution-plan-m1-5.md), [execution-plan-m2.md](./execution-plan-m2.md) — completion state
3. `specs/changelog.md`

- Mark phase-3 exit criteria completed in `phase-3.md` when validation is done.
- Mark done statuses in execution plans as tasks are finished.
- Add final changelog entry for phase-3 MVP cutover completion.
- Add concise handoff notes for phase-5 (cursor-local backend addition) assumptions.
- Ensure M1.5 bridge and M2 resume-order notes remain reflected in closure docs.

**Acceptance checklist**

- Phase-3 docs reflect completed MVP status and completed execution tasks.
- Changelog contains clear cutover entry with date/time.
- Follow-up work boundaries (phase 5/6/7) remain clear.

Dependencies: Task 4.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```

## Mapping to phase-3 task IDs

| Phase-3 ID | Execution plan task |
|------------|---------------------|
| P3-7 | Tasks 1, 2, 3 |
| P3-8 | Tasks 4, 5 |

## Phase 3 exit criteria (full)

- [ ] Open workspace -> agent turn runs via OpenCode with tools on disk.
- [ ] Permission prompt blocks and resolves in UI.
- [x] Workspace composer does not call HTTP `ChatProvider`.
- [ ] Chat and Cloud contexts still work.
- [ ] `npm test` / `npm run check`; manual smoke on real folder.

