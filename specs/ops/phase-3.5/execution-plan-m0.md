# Phase 3.5 Milestone 0 Execution Plan — SDK migration

**Status:** DONE

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** phase 3 complete (OpenCode sidecar, raw HTTP client)

**Goal:** replace the hand-rolled HTTP client with `@opencode-ai/sdk`.

Do this milestone first so M1–M5 build on the SDK from the start (see
[questions.md Q1, Q13, Q15](./questions.md)).

Can be done incrementally — one endpoint group at a time — or as a single
sweep. M0-T1/T2 are blocking for M1 and M2.

---

## Tasks

- [x] **M0-T1 — Add `@opencode-ai/sdk` dependency.** Install the package.
  Verify it works against the bundled sidecar version.
  - Files: `app/package.json`.

- [x] **M0-T2 — Create SDK client factory.** Replace `createHttpOpencodeClient`
  internals with `createOpencodeClient({ baseUrl, directory, headers })`. Keep
  the same `RawOpencodeClient` interface so the rest of the backend doesn't
  change yet.
  - Files: `ai/backends/workspaceAgentBackend.ts`.

- [x] **M0-T3 — Extend `WorkspaceAgentBackend` interface.** Add methods for
  session messages, fork, revert, share, diff, todo, config, mcp, provider,
  command, etc. (progressively as M1–M5 features are implemented).
  - Files: `ai/backends/workspaceAgentBackend.ts`.

- [x] **M0-T4 — Error mapping.** Map SDK `OpencodeClientError` to
  `WorkspaceAgentBackendError` with existing error codes.
  - Files: `ai/backends/workspaceAgentBackend.ts`.

- [x] **M0-T5 — Remove raw HTTP client.** Once all endpoints go through the
  SDK, remove the hand-rolled `fetch`-based code.
  - Files: `ai/backends/workspaceAgentBackend.ts`.

- [x] **M0-T6 — Tests.** Verify all existing workspace agent tests pass against
  the SDK-backed client. Mock the SDK at the transport level.
