# OpenCode Error Mapping (Phase 3)

**Purpose:** define deterministic mapping from OpenCode transport/API failures to `WorkspaceAgentBackendError` codes used by SpecOps UI/runtime.

## Target backend error codes

- `authFailure`
- `serverUnavailable`
- `transportError`
- `invalidDirectory`
- `invalidResponse`
- `notFound`

## HTTP status mapping

| HTTP status | Backend error code | User-facing meaning |
|---|---|---|
| 400 with directory/location validation failure | `invalidDirectory` | Workspace root path rejected by OpenCode location rules. |
| 401 / 403 | `authFailure` | OpenCode auth failed (password/token/header mismatch). |
| 404 | `notFound` | Session/request/resource not found (possibly already resolved/deleted). |
| 409 | `transportError` | Conflict (often stale state or duplicate operation). |
| 502 / 503 / 504 | `serverUnavailable` | OpenCode instance unreachable or unhealthy. |
| Other non-2xx | `transportError` | Generic OpenCode API failure. |

## Structured tag mapping

When OpenCode returns tagged API errors (`_tag`/name), refine message while keeping status-derived code:

- `SessionNotFoundError` -> `notFound`
- `PermissionNotFoundError` -> `notFound`
- `QuestionNotFoundError` -> `notFound`
- `UnauthorizedError` -> `authFailure`
- `ServiceUnavailableError` -> `serverUnavailable`
- `InvalidRequestError` + directory context -> `invalidDirectory`
- `UnknownError` -> `transportError`

## Non-HTTP failures

| Failure class | Backend error code | Notes |
|---|---|---|
| Network connect/DNS/timeout | `serverUnavailable` | Usually fetch/transport exception before response exists. |
| SSE parse failure for one frame | none (soft) | Drop frame, keep stream alive, emit diagnostics only. |
| SSE stream body missing/invalid protocol | `invalidResponse` | Hard failure for stream setup. |
| JSON payload shape mismatch for required fields | `invalidResponse` | Normalize defensively and fail only when operation cannot proceed. |

## UI behavior guidance

- `authFailure`: prompt user to re-check OpenCode URL/password settings.
- `invalidDirectory`: show workspace-path guidance and retry option.
- `serverUnavailable`: surface reconnect/retry action and health indicator.
- `notFound` during modal reply: clear stale prompt and continue.
- `invalidResponse`: capture diagnostics and suggest updating OpenCode/SpecOps compatibility.
