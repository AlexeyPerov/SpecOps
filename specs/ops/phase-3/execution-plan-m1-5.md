# Phase 3 Milestone 1.5 Execution Plan — OpenCode contract alignment bridge

**Spec:** [phase-3.md](./phase-3.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m1.md](./execution-plan-m1.md) complete

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task. Milestone 2 Task 2+ depends on this milestone completing.

## Assumptions

- Milestone 1 delivered sidecar/URL/runtime foundations but adapter contracts require alignment.
- OpenCode contract for phase-3 is session + prompt + event stream (not run endpoints).
- No data migration shims are required (E2A still applies).
- Workspace HTTP cutover remains a Milestone 3 concern after M2 MVP UI work.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Backend seam exists in `workspaceAgentBackend.ts`, enabling contract changes behind a stable app boundary.
2. Sidecar + URL runtime and health model from M1 are already available.
3. M2/M3 plans can be safely re-based on a dedicated bridge milestone.

Residual uncertainties:

1. Session restore reconciliation may expose hidden assumptions in tab/runtime startup flow.

## Decisions applied (resolved)

1. Canonical stream envelope is native `GET /api/event` (`data`); bridged `/event` is fallback only.
2. No backward compatibility for legacy permission/question event names; phase-3 targets v2 event names only.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Contract freeze docs and API mapping baseline (P3-2 docs bridge) [Score:6] [Agent:medium] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — OpenCode SDK goal and MVP scope
2. [opencode-api-mapping.md](./opencode-api-mapping.md)
3. [opencode-event-normalization-spec.md](./opencode-event-normalization-spec.md)
4. OpenCode contract sources (`packages/server/src/groups/v2/*`, SDK v2 client)
5. [opencode-contract-freeze-m1-5.md](./opencode-contract-freeze-m1-5.md)

- Freeze canonical endpoint/event assumptions for implementation.
- Record unsupported legacy assumptions that must be removed from adapter/runtime.
- Link docs into phase-3 execution chain for M2/M3 consumers.

**Acceptance checklist**

- API and event mapping docs are complete and linked from phase-3 docs.
- M1.5 scope is explicit for implementers before code changes begin.

Dependencies: none.

---

#### Task 2: Backend transport contract correction (P3-2) [Score:9] [Agent:heavy] [DONE]

**Required context**

1. Task 1 output docs
2. `app/src/lib/ai/backends/workspaceAgentBackend.ts`
3. OpenCode SDK client usage (`createOpencodeClient`, v2 session/event APIs)
4. `app/src/lib/ai/chatSendPipeline.ts` workspace send loop assumptions

- Replace run-centric assumptions with canonical OpenCode prompt/stream contract.
- Align session CRUD paths with OpenCode canonical APIs.
- Ensure directory/workspace binding and auth handling remain consistent across sidecar and URL modes.
- Implement canonical stream consumption via `/api/event` envelope.

**Acceptance checklist**

- Workspace backend no longer depends on `/sessions/{id}/runs` patterns.
- Prompt send + stream path follows documented OpenCode contract.
- Existing workspace runtime can consume aligned backend responses.

Dependencies: Task 1.

---

#### Task 3: Exact event normalization rewrite (P3-4 foundation) [Score:9] [Agent:heavy]

**Required context**

1. [opencode-event-normalization-spec.md](./opencode-event-normalization-spec.md)
2. Backend stream normalization code/tests
3. Workspace transcript/runtime event consumers

- Implement deterministic normalization for text/tool/permission/question/run lifecycle events.
- Add idempotent dedup and out-of-order handling rules per spec.
- Preserve diagnostics for unknown/malformed frames without destabilizing UI flow.
- Apply v2-only permission/question event mapping (no legacy compatibility branch).

**Acceptance checklist**

- Normalized workspace events match documented mapping rules.
- Tool/permission/question events are emitted in consumable shape for M2 UI tasks.
- Duplicate/delayed events do not corrupt transcript state.

Dependencies: Task 2.

---

#### Task 4: Permission/question reply + abort backend commands (P3-5 foundation) [Score:8] [Agent:medium]

**Required context**

1. [opencode-permission-question-flow.md](./opencode-permission-question-flow.md)
2. Backend interface and command wiring
3. Existing cancel/retry controls in workspace send pipeline

- Add explicit backend methods for:
  - permission reply
  - question reply/reject
  - run/session abort semantics used by cancel UX
- Ensure command errors map via `WorkspaceAgentBackendError` rules.

**Acceptance checklist**

- Backend surface supports all modal decision paths required by M2 Task 3/4.
- Cancel action can call backend abort semantics cleanly.

Dependencies: Task 3.

---

#### Task 5: Session mapping restore/reconcile hardening (P3-3 follow-up) [Score:7] [Agent:medium]

**Required context**

1. M1 Task 4 mapping outputs
2. `workspaceAgentSession` mapping helpers
3. App shell/runtime restore flow and workspace tab hydration

- Integrate reconciliation helpers into runtime restore/startup path.
- Verify deterministic behavior when mapped sessions are missing/deleted/unavailable.
- Keep mapping strictly workspace-scoped.

**Acceptance checklist**

- Restore flow validates/reconciles mapped sessions before workspace send.
- Missing mappings recover deterministically without corrupting tabs.

Dependencies: Tasks 2, 3.

---

#### Task 6: M1.5 verification gate and handoff to M2 Task 2 (P3-8 partial) [Score:7] [Agent:medium]

**Required context**

1. Tasks 1–5 outputs
2. Existing backend/send/runtime tests
3. [m1-task5-smoke.md](./m1-task5-smoke.md)

- Extend tests for corrected contract, normalization, reply commands, and restore reconciliation.
- Re-run quality gate from `app/`: `npm test` and `npm run check`.
- Update smoke checklist to include contract-aligned prompt/tool/permission/question flows.
- Add explicit handoff note: continue M2 from Task 2.

**Acceptance checklist**

- Automated tests cover contract-aligned backend/runtime behavior.
- `npm test` / `npm run check` pass.
- M2 resume point (Task 2) is documented and unambiguous.

Dependencies: Tasks 1–5.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 6
                 ↘ Task 5 ↗
```

## Mapping to phase-3 task IDs

| Phase-3 ID | Execution plan task |
|------------|---------------------|
| P3-2 | Tasks 1, 2 |
| P3-3 | Task 5 |
| P3-4 | Task 3 (foundation) |
| P3-5 | Task 4 (foundation) |
| P3-8 | Task 6 (partial) |

## Milestone 1.5 exit criteria

- [ ] Workspace backend contract aligns with OpenCode API/event mapping docs.
- [ ] Permission/question reply and abort commands are available for workspace runtime.
- [ ] Session mapping restore/reconcile is deterministic in runtime flow.
- [ ] Contract-aligned tests and smoke checks pass.
- [ ] Milestone 2 work resumes from Task 2.

**Next:** [execution-plan-m2.md](./execution-plan-m2.md) (start from Task 2 after M1.5)
