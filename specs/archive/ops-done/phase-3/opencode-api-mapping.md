# OpenCode API Mapping (Phase 3)

**Purpose:** map SpecOps workspace backend operations to canonical OpenCode APIs/SDK calls for phase-3 implementation.

**Primary references:**
- `packages/sdk/js/src/v2/client.ts`
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`
- `packages/server/src/groups/v2/session.ts`
- `packages/server/src/groups/v2/event.ts`
- `packages/server/src/groups/v2/permission.ts`
- `packages/server/src/groups/v2/question.ts`

## Canonical integration rules

- Use OpenCode SDK client creation with directory binding (`createOpencodeClient({ baseUrl, directory })`).
- Treat OpenCode as a **session + event stream** system; do not model it as `/runs`.
- Use v2 routes for prompt/events/permissions/questions, with legacy session create/list/delete where v2 create/delete are not exposed.
- **Decision A1:** Canonical stream source is native `GET /api/event` (`data` envelope). Bridged `GET /event` is non-canonical fallback only.
- **Decision A2:** No backward-compat requirement for legacy permission/question events; phase-3 implementation targets v2 event names only.

## Operation mapping table

| SpecOps backend operation | Canonical OpenCode API | SDK call target | Notes |
|---|---|---|---|
| Health check | `GET /api/health` | `client.v2.health.get()` | Preferred readiness probe for phase-3 runtime health. |
| Create session | `POST /session` | `client.session.create()` | Create remains on legacy route; bind workspace via directory/workspace location context. |
| Get session | `GET /session/{id}` | `client.session.get()` | Used for mapping reconciliation and restore checks. |
| List sessions | `GET /api/session` | `client.v2.session.list()` | Prefer v2 list with cursor support and consistent location filtering. |
| Delete session | `DELETE /session/{id}` | `client.session.delete()` | Legacy delete route. |
| Send prompt | `POST /api/session/{sessionID}/prompt` | `client.v2.session.prompt()` | Canonical run admission path; replaces `/runs` assumptions. |
| Stream events | `GET /api/event` (native) or `GET /event` (bridged) | `client.v2.event.subscribe()` or `client.event.subscribe()` | Pick one envelope and normalize once in backend adapter. |
| List pending permissions | `GET /api/session/{sessionID}/permission/request` | `client.v2.session.permission.list()` | Session-scoped source for modal recovery/reload. |
| Reply permission | `POST /api/session/{sessionID}/permission/request/{requestID}/reply` | `client.v2.session.permission.reply()` | Reply body carries action + optional message. |
| List pending questions | `GET /api/question/request` | `client.v2.question.request.list()` | Location-wide pending list; useful for recovery. |
| Reply question | `POST /api/session/{sessionID}/question/request/{requestID}/reply` | `client.v2.session.question.reply()` | Body is structured answers matrix. |
| Reject question | `POST /api/session/{sessionID}/question/request/{requestID}/reject` | `client.v2.session.question.reject()` | Explicit reject path. |
| List models | `GET /api/model` | `client.v2.model.list()` | Source of workspace model selection options. |
| List agents | `GET /api/agent` | `client.v2.agent.list()` | Source of agent list for workspace tabs/sidebar. |
| List providers | `GET /api/provider` | `client.v2.provider.list()` | Source of provider diagnostics and selector metadata. |

## Explicitly invalid assumptions to remove

The following routes are not OpenCode canonical APIs for phase-3:

- `POST /sessions/{sessionId}/runs`
- `GET /sessions/{sessionId}/runs/{runId}/events`
- Any run-id-centric lifecycle contract in workspace adapter/public backend interface.

## Required adapter corrections (implementation-facing)

1. **Prompt send contract:** migrate workspace send from run creation to `v2.session.prompt`.
2. **Stream contract:** consume OpenCode event stream and derive lifecycle from event types (`session.next.*`, `session.status`, permission/question events).
3. **Reply APIs:** add explicit permission/question reply methods to `WorkspaceAgentBackend` surface.
4. **Model identity:** store and pass provider/model pair semantics where required by OpenCode prompt/model selectors.
