# OpenCode Event Normalization Spec (Phase 3)

**Purpose:** define exact normalization from OpenCode stream payloads into `WorkspaceAgentStreamEvent` consumed by workspace runtime/UI.

## Inputs

- Native stream route: `GET /api/event` (`data` payload field).
- Bridged stream route: `GET /event` (`properties` payload field).

Decision: canonical phase-3 source is `GET /api/event`. Bridged `GET /event` is fallback only if native stream is unavailable.

## Envelope normalization

Given raw event frame:

- Read `eventType` from `type`.
- Read `payload` from:
  - `data` (native v2), else
  - `properties` (bridged), else
  - treat as unsupported/no-op.
- Preserve `id`, `location`, and raw payload for diagnostics only; do not leak raw schema to UI layer.

## Normalized event outputs

| OpenCode event type | Normalized type | Required mapping |
|---|---|---|
| `session.next.text.delta` | `message.delta` | `delta = payload.delta` |
| `session.next.text.ended` | `message.completed` | `message = payload.text ?? ""` |
| `session.next.tool.called` | `tool.started` | `toolName = payload.tool`, `callId = payload.callID`, `input = payload.input` |
| `session.next.tool.progress` | `tool.progress` (internal optional) | Keep as optional intermediate model for richer cards; if omitted, UI updates via start/end only. |
| `session.next.tool.success` | `tool.completed` | `toolName = payload.tool`, `callId = payload.callID`, `output = payload.result ?? payload.content`, `isError = false` |
| `session.next.tool.failed` | `tool.completed` | `toolName = payload.tool`, `callId = payload.callID`, `output = payload.error ?? payload.result ?? null`, `isError = true` |
| `permission.v2.asked` | `permission.requested` | `permissionId = payload.id`, `label = payload.action ?? payload.permission`, `payload = raw payload` |
| `question.v2.asked` | `question.requested` | `questionId = payload.id`, `prompt = first question header/text fallback`, `choices = flattened option labels`, `payload = raw payload` |
| `session.status` (`status.type = idle`) or `session.idle` | `run.completed` | Run completion derived from session idle transition. |
| `session.error` or `session.next.step.failed` | `run.failed` | `message = error text fallback`, include full payload in diagnostics. |

## Ordering and dedup rules

1. Dedup key preference:
   - event frame `id` when present;
   - else composite key of `type + sessionID + callID + timestamp`.
2. Ignore duplicate ids already observed in current stream cursor.
3. Tool card reducer must be idempotent:
   - repeated `tool.started` for same `callId` updates missing metadata only;
   - repeated `tool.completed` for same `callId` overwrites terminal state with latest deterministic payload.
4. Out-of-order handling:
   - if `tool.completed` arrives before `tool.started`, create synthetic in-progress record then mark terminal immediately.
   - if `message.completed` arrives without prior delta, still emit completion with final text.

## Error and unknown-event behavior

- Unknown event types: ignore for UI state, append debug diagnostic record.
- Malformed payload for known type: skip normalized emission, append debug diagnostic.
- Stream disconnect:
  - surface transient transport error only if session remains non-idle after reconnect budget.
  - otherwise treat as recoverable and continue via reconnect path.

## Compatibility guidance for phase-3

- Use `.v2` permission/question event names only.
- Legacy permission/question names are out of phase-3 scope (active-development, no backward-compat requirement).
- Do not rely on run-id semantics; OpenCode completion is session-event-driven.
