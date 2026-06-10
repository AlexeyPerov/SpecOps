# OpenCode Contract Freeze Baseline (M1.5 Task 1)

**Purpose:** lock the canonical OpenCode API/event assumptions for phase-3 implementation work before adapter/runtime code changes.

**Consumers:** milestone 1.5 Tasks 2-6 and milestone 2/3 implementation tasks.

## Canonical contract (frozen)

1. **Session + prompt + event stream model**
   - Workspace OpenCode integration is session-centric.
   - Prompt admission uses `POST /api/session/{sessionID}/prompt`.
   - Completion/lifecycle is derived from session event types, not run-id endpoints.

2. **Canonical stream envelope**
   - Primary source: native `GET /api/event`.
   - Canonical payload field: `data`.
   - Bridged `GET /event` (`properties`) is fallback-only.

3. **Permission/question event naming**
   - Phase-3 implementation targets v2 names only:
     - `permission.v2.asked`
     - `question.v2.asked`
   - No backward-compat layer for legacy permission/question event names.

4. **Session API usage boundary**
   - Session create/get/delete use canonical SDK route coverage:
     - create/delete via legacy session surface where v2 parity is unavailable.
     - list/prompt/permission/question/model/provider/agent via v2 APIs.

## Unsupported assumptions to remove

The following assumptions are explicitly out of contract for phase-3:

- `POST /sessions/{sessionId}/runs`
- `GET /sessions/{sessionId}/runs/{runId}/events`
- Any adapter/runtime logic that treats run id as a required primary lifecycle key.
- Any legacy permission/question event compatibility mapping branch.

## Implementation guardrails

1. `WorkspaceAgentBackend("opencode")` must expose prompt + stream + reply commands using the frozen contract above.
2. Event normalization must parse native v2 envelopes first and emit stable workspace events for text/tool/permission/question/run lifecycle.
3. Restore/reconcile and cancel flows must remain session-scoped and avoid reintroducing run-centric routing.
4. Milestone 2/3 tasks should treat this file plus:
   - [opencode-api-mapping.md](./opencode-api-mapping.md)
   - [opencode-event-normalization-spec.md](./opencode-event-normalization-spec.md)
   as the implementation authority for contract behavior.

## Relationship to phase-3 docs

- Phase spec: [phase-3.md](./phase-3.md)
- Bridge plan: [execution-plan-m1-5.md](./execution-plan-m1-5.md)
- Next implementation milestones:
  - [execution-plan-m2.md](./execution-plan-m2.md)
  - [execution-plan-m3.md](./execution-plan-m3.md)
