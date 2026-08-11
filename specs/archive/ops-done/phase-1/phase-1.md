# Phase 1 — Preparation

**Parent:** [roadmap.md](../roadmap.md)  
**Execution:** [execution-plan.md](./execution-plan.md)  
**Status:** planning  
**Estimate:** ~1–2 weeks  
**Replaces:** `glm-removal-plan.md` (archived into this doc per H1A)

## Goal

Prepare SpecOps for multi-context AI **without** shipping Chat/Cloud activity-rail modes yet:

- Generalize GLM into a **vendor-neutral OpenAI-compatible** HTTP chat provider.
- Remove GLM/BigModel branding and `glm` provider id.
- Keep **Debug** and **workspace HTTP chat** until phase 3 (B2A).
- Introduce **foundation types** for `chat-http`, `chat-cloud`, and `WorkspaceAgentBackend`.

## Non-goals

- Activity rail Chat button (phase 2); Cloud button (phase 4).
- OpenCode or Cursor SDK integration (phase 3–5).
- SSE streaming in UI (phase 2 exit; buffered OK in P1 per B3B).
- Multi-connection settings ([phase-7.md](../phase-7/phase-7.md) tier 2 per B5C).

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| B1 | Generalize first, then remove GLM — do **not** delete chat stack |
| B2 | Workspace keeps HTTP until phase 3 |
| B3 | Buffered send in P1; streaming in phase 2 |
| B4 | `WorkspaceAgentBackend` interface + stub |
| B5 | Single HTTP **connection** in settings |
| H2 | Remove `cursor` from `ChatProviderId` (SDK only later) |
| Default provider | HTTP when configured; else Debug if enabled |
| Legacy `provider: "glm"` | Remap on load per table above |

## Exit criteria

- [x] OpenAI-compatible provider registered; workspace send works with configured connection.
- [x] No GLM-specific UI, settings keys, or `glm` provider id in product paths.
- [x] `ContextId` includes `chat-http` \| `chat-cloud` (types/constants; no rail UI).
- [x] `WorkspaceAgentBackend` stub exists; no OpenCode wiring yet.
- [x] `npm test` and `npm run check` pass from `app/`.
- [x] `docs/providers.md`, `docs/architecture.md`, README updated for HTTP connection + Debug.

---

## Workstreams

### 1. OpenAI-compatible HTTP provider (from GLM)

**Source files to generalize (then remove GLM names):**

| GLM file | Becomes |
|----------|---------|
| `glmChatProvider.ts` | `openAiCompatibleChatProvider.ts` (or `httpChatProvider.ts`) |
| `glmPrompt.ts` | `openAiChatMessages.ts` |
| `glmProviderSettings.ts` | `httpConnectionSettings.ts` |

**Behavior:**

- POST `{baseUrl}/chat/completions`, `messages`, `model`, `stream: false` in P1.
- Provider id e.g. `http` or `openaiCompatible` (not `glm`).
- `checkCapabilities`, `sendMessage`; optional `streamMessage` stub for phase 2.
- Preserve `ChatProvider` registry, `sendChatMessage`, `buildThreadProviderRequest`.

**Acceptance:** Tests ported from `glmChatProvider.test.ts`; BigModel-specific error strings generalized.

---

### 2. Settings & secrets (B5C)

- Replace Settings tab **GLM** with **Connections** (single connection): `enabled`, `baseUrl`, model catalog.
- Secrets: connection-keyed in `provider-secrets.json` (reuse `providerSecretsStore`).
- Remove `glmApiKey` from `AppSettingsState`; use `providerApiKeys` or connection-specific in-memory key.
- Normalize: drop read/write of `providerSettings.glm` in `settings.json` (breaking OK).

**Files:** `settingsDialogUi.ts`, `SettingsDialog.svelte`, `settingsSlice.ts`, `settingsStore.ts`, `appShellRuntime.ts`, `contracts.ts`, `appProviderSettings.ts`.

---

### 3. Remove GLM branding (after generalization works)

- Delete old `glm*.ts` files once replacements land.
- Update `bootstrap.ts`: register HTTP provider + Debug only.
- Update `selection.ts`, `capabilityChecker.ts`, `chatErrorCopy.ts` — no GLM copy or `glm_not_configured`.
- Update `ChatPanel`, `ChatComposer`, `ChatBlockedState` CTAs → Connections settings.
- `PRODUCT_CHAT_PROVIDER_IDS` → HTTP product id only (+ Debug when enabled in UI).

---

### 4. Context & scope foundations (A1, A4 — types only)

- Extend `ContextId`: `"notepad" | "chat-http" | "chat-cloud" | \`ws-${number}\``.
- Document/plan `WindowContextState` fields: `chatHttp`, `chatCloud` snapshots (mirror `notepad`) — implement persistence in phase 2.
- Refactor `chatStore` design note: scope key = context id (not only `activeWorkspaceRoot`); minimal hook if needed for tests.

**No** Activity rail buttons in phase 1.

---

### 5. `WorkspaceAgentBackend` stub (B4A)

Add e.g. `app/src/lib/ai/backends/workspaceAgentBackend.ts`:

```ts
// Illustrative — final names in implementation
export type WorkspaceAgentBackendId = "opencode" | "cursor-local";

export interface WorkspaceAgentBackend {
  readonly id: WorkspaceAgentBackendId;
  // phase 3/5: sendPrompt, streamEvents, replyPermission, ...
}
```

Stub factory returns “not implemented” for workspace agent send until phase 3.

---

### 6. Tests & validation (P1-8, P1-9)

Update all `glm`/`GLM` references in `*.test.ts` and `chatM*.validation.test.ts` headers.

- Re-home send/retry/stream tests under Debug or HTTP provider.
- Remove GLM-only parallel/retry suites or port to HTTP mocks.

---

### 7. Documentation (P1-10)

- `docs/providers.md` — HTTP connection + Debug; link [roadmap.md](../roadmap.md).
- `docs/architecture.md` — Connections tab, provider pipeline.
- `README.md` — WIP AI points to ops roadmap.

---

## Task list (execution order)

| ID | Task | Agent |
|----|------|-------|
| P1-0 | Record GR-0 defaults in code comments or `phase-1` decisions (done above) | easy |
| P1-1 | Add OpenAI-compatible provider + tests (generalize from GLM) | medium |
| P1-2 | Connections settings + secrets; remove GLM settings UI | medium |
| P1-3 | Domain/types: drop `glm`, HTTP id, `providerApiKeys` | medium |
| P1-4 | Bootstrap, selection, send pipeline, error copy | medium |
| P1-5 | Chat UI blocked states → Connections | medium |
| P1-6 | Thread normalize `provider: "glm"` on load | medium |
| P1-7 | `ContextId` + session shape types (no rail) | easy |
| P1-8 | `WorkspaceAgentBackend` stub | easy |
| P1-9 | Test sweep + validation comments | heavy |
| P1-10 | Docs + changelog | easy |
| P1-11 | `npm test` / `npm run check` / grep cleanup | easy |

```text
P1-1 → P1-2 → P1-3 → P1-4 → P1-5 → P1-6
    ∥ P1-7, P1-8
→ P1-9 → P1-10 → P1-11
```

Delete GLM files **after** P1-1 passes tests (not before).

---

## File inventory

**Remove after generalization**

- `app/src/lib/ai/providers/glmChatProvider.ts` (+ `.test.ts`)
- `app/src/lib/ai/providers/glmPrompt.ts`
- `app/src/lib/ai/providers/glmProviderSettings.ts` (+ `.test.ts`)

**Edit (representative)**

- `contracts.ts`, `appProviderSettings.ts`, `bootstrap.ts`, `registry.ts`
- `sendChatMessage.ts`, `selection.ts`, `capabilityChecker.ts`, `modelValidation.ts`
- `providerModelCatalog.ts`, `settingsStore.ts`, `settingsDialogUi.ts`
- `ChatPanel.svelte`, `ChatComposer.svelte`, `ChatBlockedState.svelte`, `SettingsDialog.svelte`
- All chat `*.test.ts` / `chatM*.validation.test.ts`

---

## Relationship to later phases

| Phase | Depends on P1 |
|-------|----------------|
| [phase-2.md](../phase-2/phase-2.md) | HTTP provider, connection settings, `chat-http` type |
| [phase-3.md](../phase-3/phase-3.md) | `WorkspaceAgentBackend` → OpenCode adapter |
| [phase-4.md](../phase-4/phase-4.md) | Chat shell patterns; `chat-cloud` type |
| [phase-6.md](../phase-6/phase-6.md) | Optional → own platform adapter (after phase 5) |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-04 | Created from glm-removal-plan; B1A generalize-first scope |
