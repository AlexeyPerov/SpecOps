# Phase 3 M1.5 Task 6 Smoke Script

Use this quick script after `npm test`/`npm run check` to verify contract-aligned OpenCode flows manually.

## Prerequisites

- Build/dev app starts successfully.
- A local workspace folder is available and readable.
- OpenCode is available either as:
  - bundled/installed sidecar binary (`opencode`), or
  - reachable URL endpoint for URL mode.

## Sidecar mode smoke (contract-aligned)

1. Open app settings and set OpenCode mode to `sidecar`.
2. Open a workspace folder with a valid absolute path.
3. Confirm OpenCode health transitions from `checking` to `healthy`.
4. Open or create an Agent tab in that workspace.
5. Send a short prompt (for example: "reply with one line").
6. Confirm a streamed response appears and no sidecar launch error is shown.
7. Trigger a tool-capable prompt (for example: "list files in this workspace") and confirm tool activity appears without transcript corruption.
8. When a permission request appears, choose `once` and confirm the run resumes.
9. When a question prompt appears, submit an answer and verify the run resumes.
10. Re-run with question reject/cancel and verify the run exits cleanly.
11. Start a long-running prompt and trigger cancel; verify cancel completes without a stuck "running" state.
12. Close and reopen the same workspace; verify health recovers and prompts still run with deterministic session remapping.

Expected result:

- Sidecar starts/attaches automatically.
- Health state is stable (`healthy` or actionable `degraded/error` copy).
- Agent session remains usable after reopen with deterministic mapping reconciliation.

## URL mode smoke (contract-aligned)

1. Open app settings and set OpenCode mode to `url`.
2. Enter a valid URL (for example: `http://127.0.0.1:4096`) and save.
3. Trigger a health check (or wait for automatic check).
4. Confirm health transitions from `checking` to `healthy`.
5. Open an Agent tab and send a short prompt.
6. Confirm response streaming works end-to-end.
7. Validate permission and question flows again in URL mode (reply and reject paths).
8. Validate cancel/abort behavior for an active run.

Negative checks:

- Set URL to an invalid value (for example: `ws://localhost:4096`) and verify validation/error state is shown.
- Set URL to an unreachable host and verify `error`/`degraded` health with actionable message.

Expected result:

- URL mode uses configured endpoint without restarting the app.
- Health and error states are surfaced clearly for both valid and invalid configs.

## M2 handoff note

- Milestone 1.5 verification is complete when this checklist and quality gate pass.
- Continue implementation from `specs/ops/phase-3/execution-plan-m2.md` starting at **Task 2**.
