# OpenCode Permission and Question Flow (Phase 3)

**Purpose:** pin modal and reply behavior for workspace runtime so M2 Task 3/4 implementation is deterministic.

## Permission flow

### Sources

- Pending list: `GET /api/session/{sessionID}/permission/request`
- Interactive ask event: `permission.v2.asked` (legacy compatibility: `permission.asked`)
- Reply: `POST /api/session/{sessionID}/permission/request/{requestID}/reply`

### Runtime sequence

1. Stream receives permission ask event.
2. Backend emits normalized `permission.requested`.
3. UI opens modal and pauses run-control actions for this workspace turn.
4. User chooses action:
   - Allow once
   - Always allow (save)
   - Deny
5. UI submits backend reply command.
6. Backend call success closes modal and run stream continues.

### Reply payload contract

Preferred v2 reply body:

```json
{
  "reply": "once",
  "message": "optional user note"
}
```

Allowed values:
- `once`
- `always`
- `reject`

### Recovery and stale handling

- On reconnect/app restore, fetch pending list and reopen unresolved permission requests.
- Closing modal without explicit action defaults to deny (`reject`) unless future policy explicitly changes.
- If request no longer exists on submit, treat as already resolved and clear modal.

## Question flow

### Sources

- Pending list: `GET /api/question/request` (location scope) and/or session-scoped query when needed.
- Interactive ask event: `question.v2.asked` (legacy compatibility: `question.asked`)
- Reply: `POST /api/session/{sessionID}/question/request/{requestID}/reply`
- Reject: `POST /api/session/{sessionID}/question/request/{requestID}/reject`

### Runtime sequence

1. Stream receives question ask event.
2. Backend emits normalized `question.requested`.
3. UI opens question modal and pauses run progression until resolved.
4. User submits answers (or rejects).
5. Backend posts reply/reject and modal closes.
6. Stream resumes; transcript shows decision outcome.

### Reply payload contract

```json
{
  "answers": [
    ["choice A"],
    ["choice B", "choice C"]
  ]
}
```

- Outer array order must match backend question order.
- Inner arrays contain selected labels per question.

### Validation rules

- Required question with no answer blocks submit.
- Multi-select questions may return multiple labels; single-select must return one label.
- Preserve user draft selections through transient rerenders.

## Unified queue policy

- Decision: only one blocking prompt (permission/question) is active per session at a time.
- Additional prompts queue FIFO by event time.
- Active prompt ownership is session-scoped to prevent cross-tab bleed.
