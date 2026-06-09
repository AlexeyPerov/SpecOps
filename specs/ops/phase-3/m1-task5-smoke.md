# Phase 3 M1 Task 5 Smoke Script

Use this quick script after `npm test`/`npm run check` to verify OpenCode connectivity paths manually.

## Prerequisites

- Build/dev app starts successfully.
- A local workspace folder is available and readable.
- OpenCode is available either as:
  - bundled/installed sidecar binary (`opencode`), or
  - reachable URL endpoint for URL mode.

## Sidecar mode smoke

1. Open app settings and set OpenCode mode to `sidecar`.
2. Open a workspace folder with a valid absolute path.
3. Confirm OpenCode health transitions from `checking` to `healthy`.
4. Open or create an Agent tab in that workspace.
5. Send a short prompt (for example: "reply with one line").
6. Confirm a streamed response appears and no sidecar launch error is shown.
7. Close and reopen the same workspace; verify health recovers and prompts still run.

Expected result:

- Sidecar starts/attaches automatically.
- Health state is stable (`healthy` or actionable `degraded/error` copy).
- Agent session remains usable after reopen.

## URL mode smoke

1. Open app settings and set OpenCode mode to `url`.
2. Enter a valid URL (for example: `http://127.0.0.1:4096`) and save.
3. Trigger a health check (or wait for automatic check).
4. Confirm health transitions from `checking` to `healthy`.
5. Open an Agent tab and send a short prompt.
6. Confirm response streaming works end-to-end.

Negative checks:

- Set URL to an invalid value (for example: `ws://localhost:4096`) and verify validation/error state is shown.
- Set URL to an unreachable host and verify `error`/`degraded` health with actionable message.

Expected result:

- URL mode uses configured endpoint without restarting the app.
- Health and error states are surfaced clearly for both valid and invalid configs.
