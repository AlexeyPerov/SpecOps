# Phase 1 Execution Plan

**Spec:** [phase-1.md](./phase-1.md)  
**Parent:** [roadmap.md](../roadmap.md)

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Assumptions

- Implementation is agent-only; human role is approval/review.
- Approach is **generalize-first** (B1A): keep the chat stack working while replacing GLM with an OpenAI-compatible HTTP provider; delete `glm*.ts` only after P1-1 tests pass.
- No new activity-rail modes (Chat/Cloud UI) in phase 1; workspace HTTP chat remains until [phase-4](../phase-4/phase-4.md).
- Buffered HTTP send only (`stream: false`); SSE streaming is [phase-2](../phase-2/phase-2.md).
- Single HTTP **connection** in settings (B5C); multi-connection deferred to [phase-7](../phase-7/phase-7.md).
- Breaking changes to `settings.json` / provider ids are acceptable (no data migration shims).

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Scope and exit criteria are defined in [phase-1.md](./phase-1.md) (locked decisions table).
2. GLM source files and replacement mapping are listed in phase-1 workstream 1.
3. Default provider policy: HTTP when configured; else Debug if enabled.

Residual uncertainties:

1. Exact HTTP provider id naming (`http` vs `openaiCompatible`) may touch many imports and persisted thread metadata.
2. `chatStore` scope refactor (context id vs workspace root) may need a minimal P1 hook vs full phase-2 persistence.
3. Test sweep (P1-9) may surface hidden GLM strings in validation headers and mock fixtures.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: OpenAI-compatible HTTP provider (P1-1) [Score:8] [Agent:medium] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstream 1, exit criteria, file inventory
2. [roadmap.md](../roadmap.md) — B1, B2, B3 decisions
3. `app/src/lib/ai/providers/glmChatProvider.ts`, `glmPrompt.ts`, `glmProviderSettings.ts` (+ tests)

- Add `openAiCompatibleChatProvider.ts` (or `httpChatProvider.ts`), `openAiChatMessages.ts`, `httpConnectionSettings.ts` by generalizing GLM implementations.
- POST `{baseUrl}/chat/completions` with `messages`, `model`, `stream: false`.
- Register provider id `http` or `openaiCompatible` (not `glm`); implement `checkCapabilities`, `sendMessage`; optional `streamMessage` stub for phase 2.
- Preserve `ChatProvider` registry, `sendChatMessage`, `buildThreadProviderRequest` integration.
- Port tests from `glmChatProvider.test.ts`; generalize BigModel-specific error strings.

**Acceptance checklist**

- New provider passes unit tests with mocked HTTP (parity with former GLM test coverage).
- Workspace chat send succeeds against a configured connection (manual or integration test).
- `glm*.ts` provider implementation files are **not** deleted until this task’s tests pass (delete in Task 4).

Dependencies: none.

---

#### Task 2: Connections settings and secrets (P1-2) [Score:7] [Agent:medium] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstream 2
2. `app/src/lib/settings/settingsDialogUi.ts`, `SettingsDialog.svelte`, `settingsSlice.ts`, `settingsStore.ts`
3. `app/src/lib/settings/appProviderSettings.ts`, `appShellRuntime.ts`

- Replace Settings tab **GLM** with **Connections** (single connection): `enabled`, `baseUrl`, model catalog.
- Wire secrets via connection-keyed entries in `provider-secrets.json` (reuse `providerSecretsStore`).
- Remove `glmApiKey` from `AppSettingsState`; use `providerApiKeys` or connection-specific in-memory key.
- Stop read/write of `providerSettings.glm` in `settings.json` (breaking OK).

**Acceptance checklist**

- Settings UI shows Connections tab with enable, base URL, and model catalog fields.
- API key persists via secrets store and loads on app start.
- No GLM-labeled settings tab or `glmApiKey` field in domain/settings types.

Dependencies: Task 1.

---

#### Task 3: Domain types and provider ids (P1-3) [Score:6] [Agent:medium] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — decisions (H2, default provider, legacy remap)
2. `app/src/lib/domain/contracts.ts`
3. `app/src/lib/ai/providers/appProviderSettings.ts`, `providerModelCatalog.ts`, `modelValidation.ts`

- Drop `glm` from `ChatProviderId`; remove `cursor` from `ChatProviderId` (SDK in later phases).
- Update `PRODUCT_CHAT_PROVIDER_IDS` to HTTP product id only (+ Debug when enabled in UI).
- Replace `GlmProviderSettings` / `providerSettings.glm` with HTTP connection settings types.
- Align `ProviderModelCatalogs` and validation with HTTP connection id.

**Acceptance checklist**

- `contracts.ts` has no `glm` or `cursor` in `ChatProviderId`.
- Settings snapshot types match Connections UI and HTTP provider id.
- Model catalog and validation reference HTTP connection, not GLM.

Dependencies: Task 2.

---

#### Task 4: Bootstrap, selection, and send pipeline (P1-4) [Score:7] [Agent:medium] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstreams 1 and 3
2. `app/src/lib/ai/bootstrap.ts`, `registry.ts`, `selection.ts`, `capabilityChecker.ts`
3. `app/src/lib/ai/sendChatMessage.ts`, `chatErrorCopy.ts`

- Register HTTP provider + Debug only in `bootstrap.ts`.
- Update selection and capability checks for HTTP + Debug defaults (HTTP when configured; else Debug if enabled).
- Remove GLM-specific error copy and `glm_not_configured` paths.
- **Delete** `glmChatProvider.ts`, `glmPrompt.ts`, `glmProviderSettings.ts` (+ tests) after Task 1 tests pass.

**Acceptance checklist**

- Provider registry lists HTTP and Debug only (no GLM registration).
- Send pipeline routes workspace threads to HTTP when connection configured.
- No imports from deleted `glm*.ts` files; `npm run check` clean for touched modules.

Dependencies: Task 3.

---

#### Task 5: Chat UI blocked states (P1-5) [Score:5] [Agent:medium] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstream 3
2. `app/src/lib/chat/ChatPanel.svelte`, `ChatComposer.svelte`, `ChatBlockedState.svelte`

- Update blocked-state CTAs and copy to point to **Connections** settings (not GLM).
- Ensure composer/panel provider labels match HTTP + Debug only.

**Acceptance checklist**

- No user-visible “GLM” or BigModel branding in chat UI.
- Blocked states link or describe Connections configuration path.

Dependencies: Task 4.

---

#### Task 6: Thread legacy provider normalization (P1-6) [Score:5] [Agent:medium] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — legacy `provider: "glm"` remap
2. Thread load/normalize code paths (search `provider: "glm"` in `app/src`)

- On thread/session load, remap `provider: "glm"` to HTTP provider id (or Debug per policy table in phase-1).
- Ensure persisted threads remain sendable after provider id change.

**Acceptance checklist**

- Loading a thread with `provider: "glm"` normalizes without error and uses HTTP when configured.
- No runtime path still expects `glm` as an active provider id.

Dependencies: Task 4.

---

#### Task 7: Context and session type foundations (P1-7) [Score:4] [Agent:easy] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstream 4
2. `app/src/lib/domain/contracts.ts` — `ContextId`, window session types

- Extend `ContextId`: `"notepad" | "chat-http" | "chat-cloud" | \`ws-${number}\``.
- Add/document `WindowContextState` fields: `chatHttp`, `chatCloud` snapshots (types/constants; full persistence in phase 2).
- Add design note or minimal hook for chat scope key = context id (if needed for tests).

**Acceptance checklist**

- `ContextId` includes `chat-http` and `chat-cloud` in types/constants.
- No Activity rail Chat/Cloud buttons shipped.
- Session types document planned `chatHttp` / `chatCloud` fields without requiring phase-2 UI.

Dependencies: Task 1 (can run in parallel with Tasks 2–6 after Task 1 starts).

---

#### Task 8: WorkspaceAgentBackend stub (P1-8) [Score:3] [Agent:easy] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstream 5
2. [phase-4](../phase-4/phase-4.md) — future OpenCode adapter (reference only)

- Add `app/src/lib/ai/backends/workspaceAgentBackend.ts` with `WorkspaceAgentBackendId`, `WorkspaceAgentBackend` interface, and stub factory.
- Stub returns “not implemented” for workspace agent send until phase 4.

**Acceptance checklist**

- Module exports interface and stub; no OpenCode or Cursor SDK wiring.
- Typecheck passes; no production code path depends on stub for user-visible send yet.

Dependencies: none (parallel with Task 7).

---

#### Task 9: Test and validation sweep (P1-9) [Score:8] [Agent:heavy] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstream 6
2. All `app/src/**/*.test.ts` and `chatM*.validation.test.ts` referencing `glm` / `GLM`

- Re-home send/retry/stream tests under Debug or HTTP provider mocks.
- Remove GLM-only parallel/retry suites or port to HTTP mocks.
- Update validation test file headers and fixtures.

**Acceptance checklist**

- `grep -r glm GLM` under `app/src` (tests included) shows no product-path GLM references except intentional legacy-normalize tests if any.
- `npm test` passes from `app/`.

Dependencies: Tasks 4, 5, 6; Task 7–8 should be complete or stable.

---

#### Task 10: Documentation (P1-10) [Score:3] [Agent:easy] [DONE]

**Required context**

1. [phase-1.md](./phase-1.md) — workstream 7
2. `docs/providers.md`, `docs/architecture.md`, `README.md`

- Update `docs/providers.md` for HTTP connection + Debug; link [roadmap.md](../roadmap.md).
- Update `docs/architecture.md` for Connections tab and provider pipeline.
- Update `README.md` WIP AI section to point at ops roadmap / phase 1.

**Acceptance checklist**

- Docs describe Connections settings and HTTP provider; no GLM setup instructions.
- README links to `specs/ops/roadmap.md` or phase-1 docs.

Dependencies: Task 9 (or in parallel once behavior is stable).

---

#### Task 11: Final verification and cleanup (P1-11) [Score:4] [Agent:easy]

**Required context**

1. [phase-1.md](./phase-1.md) — exit criteria
2. This file — all tasks marked DONE

- Run `npm test` and `npm run check` from `app/`.
- Repo grep for `glm`, `GLM`, `BigModel`, `glm_not_configured` in product paths.
- Confirm exit criteria in phase-1.md.

**Acceptance checklist**

- All phase-1 exit criteria checkboxes satisfied.
- `npm test` and `npm run check` pass from `app/`.
- Changelog entry added for phase-1 completion.

Dependencies: Tasks 9 and 10.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
              ∥ Task 7, Task 8 (after Task 1)
→ Task 9 → Task 10 → Task 11
```

Delete `glm*.ts` in **Task 4**, not before Task 1 tests pass.

## Mapping to phase-1 task IDs

| Phase-1 ID | Execution plan task |
|------------|---------------------|
| P1-0 | Covered in [phase-1.md](./phase-1.md) decisions (no separate task) |
| P1-1 | Task 1 |
| P1-2 | Task 2 |
| P1-3 | Task 3 |
| P1-4 | Task 4 |
| P1-5 | Task 5 |
| P1-6 | Task 6 |
| P1-7 | Task 7 |
| P1-8 | Task 8 |
| P1-9 | Task 9 |
| P1-10 | Task 10 |
| P1-11 | Task 11 |
