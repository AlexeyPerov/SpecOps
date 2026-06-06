# Phase 2 Milestone 4 Execution Plan — Multiple HTTP providers (connections)

**Spec:** [phase-2.md](./phase-2.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m3.md](./execution-plan-m3.md) complete (phase-2 tier 1 shipped)  
**Related:** Pulls forward [phase-7.md](../phase-7/phase-7.md) **Tier 2 → A (Multi-connection)** into phase 2; does **not** include regenerate/edit messages, system prompt, or tier 3 (RAG/Ollama UI).

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Description

Phase 2 tier 1 ships a **single** OpenAI-compatible HTTP connection (`providerSettings.http`, one API key, one model catalog). Users cannot add separate endpoints (e.g. OpenRouter, local proxy, company gateway) without overwriting that slot.

**Milestone 4** replaces the singleton with a **named connection list** (Open WebUI–style **Providers** settings):

- Each connection has: `id`, `label`, `enabled`, `baseUrl`, and its own model catalog.
- API keys live in `provider-secrets.json`, keyed by **connection id** (not `ChatProviderId`).
- Chat threads store which connection they use (`connectionId` on thread metadata).
- Composer in **Chats** and **workspace HTTP chat** picks **connection → model** (Debug Provider remains a separate dev-only option per scope).

This is the minimum slice to “use various providers in chat” without new protocol adapters — all connections remain **OpenAI-compatible HTTP** (phase-1 contract).

## Goal

Ship **multi-connection HTTP providers** for chat send paths:

1. Settings **Providers** tab manages a list of connections (add / edit / remove / enable).
2. Composer shows selectable **connections** (configured + enabled) plus scoped **Debug Provider** when enabled.
3. Rail gating and context restore use **“at least one fully configured connection”** (or Debug Provider enabled in Chats).
4. Existing tier-1 chat-http and workspace HTTP flows keep working after schema change.

## Decisions applied

| ID | Decision | Implication |
|----|----------|-------------|
| M4-1 | A | **Connection id** on thread metadata; keep `provider: "http"` for HTTP sends |
| M4-2 | A | Shared connection pool for **Chats** and **workspace** HTTP chat (one settings list) |
| M4-3 | B | Settings UI label **Providers**; panel is a **connection list**, not a single form |
| M4-4 | A | OpenAI-compatible only in M4; no Anthropic/Google native adapters |
| M4-5 | C | On settings load, normalize legacy singleton `http` block → one default connection (codec only; no dual-schema persistence) |
| M4-6 | A | Debug Provider (`debug-chat` / `debug-workspace`) stays outside the connection list |
| B5 | C | Supersedes phase-1/2 deferral; aligns with phase-7 tier 2A scope only |

## Assumptions

- Milestones 1–3 are complete: `chat-http` context, streaming, debug split, provider terminology fixes.
- Implementation is agent-only; human role is approval/review.
- Breaking changes to persisted settings shape are acceptable; prefer **load-time normalization** of legacy `http` → default connection, not long-lived compatibility shims.
- Connection ids are stable strings (e.g. `conn-{uuid}` or slug); labels are user-facing only.
- Removing a connection that threads still reference falls back to first configured connection on read/send (document fallback in Task 2).
- Workspace **review** mode continues to use the selected connection’s HTTP adapter (file reads unchanged).
- Phase 7 items **B** (regenerate/edit) and **C** (system prompt) remain out of scope for M4.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. HTTP client, SSE streaming, and secrets file separation already exist (`openAiCompatibleChatProvider.ts`, `providerSecretsStore.ts`).
2. Composer already has provider + model selectors; extend to connection-aware catalog resolution.
3. Settings sidebar already exposes **Chats → Providers** tab id `connections` (rename panel content only).

Residual uncertainties:

1. **Workspace vs Chats UX:** Same connection list everywhere vs Chats-only picker — default M4-2A (shared pool); revisit if workspace should hide unused connections.
2. **Default connection policy:** New threads pick default connection (first enabled + configured, or explicit `defaultConnectionId` in settings) — lock in Task 1.
3. **Catalog storage:** Per-connection catalogs in `providerModelCatalogs` keyed by connection id vs nested on connection object — prefer nested on `HttpConnection` to avoid orphan catalogs when deleting a connection.
4. **Registry pattern:** Single HTTP `ChatProvider` with per-send `connectionId` resolution vs N registered providers — prefer single adapter + resolver (less registry churn).

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Connection schema and load-time normalization (P2-8) [Score:8] [Agent:heavy] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — chat-http scope
2. [phase-7.md](../phase-7/phase-7.md) — Tier 2 A (multi-connection)
3. `app/src/lib/domain/contracts.ts` — `HttpConnectionSettings`, `ChatThreadMetadata`, `AppProviderSettings`
4. `app/src/lib/ai/providers/appProviderSettings.ts` — `normalizeAppProviderSettings`

- Introduce `HttpConnection` (or equivalent) type: `id`, `label`, `enabled`, `baseUrl`, `modelCatalog: ProviderModelCatalog`.
- Replace singleton `providerSettings.http` with `providerSettings.httpConnections: HttpConnection[]` (name TBD; document in contracts).
- Add optional `defaultConnectionId` on settings bundle (or derive default = first valid connection).
- Extend `ChatThreadMetadata` with `connectionId?: string` for `provider === "http"` threads.
- Load-time normalization: if persisted data has legacy `http` object only, synthesize one connection (`id: "default"`, label `"HTTP"`, fields from legacy block) and map legacy `providerModelCatalogs.http` onto it.
- Remove or deprecate top-level `providerModelCatalogs["http"]` after normalization (catalogs live on connection records).
- Update `PRODUCT_CHAT_PROVIDER_IDS` / selection types only as needed; HTTP product provider id stays `"http"`.

**Acceptance checklist**

- Unit tests: legacy settings blob → normalized connection array + default id.
- Unit tests: thread without `connectionId` resolves to default connection on read helpers.
- `normalizeAppProviderSettings` remains the single entry point for provider settings load.

Dependencies: Milestone 3 complete.

---

#### Task 2: Connection resolver and secrets by connection id (P2-8) [Score:7] [Agent:medium] [DONE]

**Required context**

1. Task 1 types
2. `app/src/lib/services/providerSecretsStore.ts`
3. `app/src/lib/ai/providers/httpConnectionSettings.ts`
4. `app/src/lib/state/appState/settingsSlice.ts`

- Add `resolveHttpConnection(settings, connectionId?)` → `{ connection, apiKey } | null` with fallback when id missing or stale.
- Extend secrets file schema to `keys: Record<string, string>` keyed by **connection id** (keep reading legacy `keys.http` once at load → assign to default connection id).
- Add settings slice helpers: `addHttpConnection`, `updateHttpConnection`, `removeHttpConnection`, `setDefaultConnectionId`, `setConnectionApiKey`.
- Implement `isHttpConnectionConfigured(connection, apiKey)` and `listConfiguredHttpConnections(settings, apiKeys)`.
- Wire `appShellRuntime` / bootstrap to load all connection keys on startup.

**Acceptance checklist**

- Secrets round-trip per connection id; legacy `http` key migrates on read.
- Removing a connection drops its secret and catalog; threads with stale id fall back per M4 policy.
- Tests cover missing key, disabled connection, invalid baseUrl.

Dependencies: Task 1.

---

#### Task 3: HTTP provider send path uses connection resolver (P2-8) [Score:8] [Agent:medium]

**Required context**

1. Task 2 resolver
2. `app/src/lib/ai/providers/openAiCompatibleChatProvider.ts`
3. `app/src/lib/ai/providers/bootstrap.ts`
4. `app/src/lib/ai/sendChatMessage.ts`

- Change HTTP settings reader to accept **active connection** resolved from thread metadata `connectionId` (and app settings).
- Update `validateProviderSend` / capability checks to validate the **resolved connection**, not global singleton.
- Ensure `switchThreadProvider` to `http` sets `connectionId` to default configured connection when unset.
- Add `switchThreadConnection(connectionId)` (or extend model switch path) with system-event audit entry if desired (`connection-switched` optional; minimum: persist metadata).
- Default new threads in chat-http and workspace to default connection when HTTP is default provider.

**Acceptance checklist**

- Send with connection A uses A’s baseUrl and key; switching thread to connection B uses B’s credentials.
- Streaming (`streamMessage`) works per connection (same SSE path).
- Workspace review mode still blocked when connection cannot read files (HTTP policy unchanged).

Dependencies: Task 2.

---

#### Task 4: Settings UI — Providers connection list (P2-8) [Score:7] [Agent:medium]

**Required context**

1. Task 1–2 settings slice API
2. `app/src/lib/components/SettingsDialog.svelte` — `connectionsSettingsPanel`
3. `app/src/lib/services/settingsDialogUi.ts`

- Replace single-connection form with **connection list** UI:
  - Add connection (label, baseUrl, enabled)
  - Select connection row to edit API key and model catalog
  - Remove connection (confirm if last configured connection)
  - Optional: mark default connection
- Panel title/copy: **Providers** / “HTTP (OpenAI-compatible) connections”.
- Deep links (`openSettingsDialog("connections")`) unchanged.
- Reuse existing model catalog editor scoped to selected connection.

**Acceptance checklist**

- User can create two connections with different base URLs and keys.
- Enable/disable per connection affects composer availability only for that connection.
- Empty list shows setup empty-state with link from Chat blocked state.

Dependencies: Task 2.

---

#### Task 5: Composer and provider selection — connection picker (P2-8) [Score:8] [Agent:medium]

**Required context**

1. Task 3 send path
2. `app/src/lib/ai/providers/selection.ts`
3. `app/src/lib/components/ChatComposer.svelte`
4. `app/src/lib/components/ChatPanel.svelte`

- Extend selectable options for HTTP: list **enabled + configured** connections by **label** (not raw id in UI).
- Composer flow: **Connection** (HTTP connections + Debug Provider when applicable) → **Model** (catalog for selected connection or debug catalog).
- When user picks a different connection, update thread `connectionId` and model default for that connection.
- Update `listSelectableChatProviders` / gating: HTTP appears when **any** connection is configured (chat-http and workspace).
- Update error copy to reference Providers list, not singular connection.
- Chat-http: Debug Provider remains separate entry; never mixed into HTTP connection list.

**Acceptance checklist**

- Chats composer shows multiple HTTP connections when configured.
- Model dropdown updates when connection changes.
- Invalid/stale connection auto-fallback with inline notice or silent default (behavior documented in Task 2).

Dependencies: Task 3, Task 4.

---

#### Task 6: Rail gating, restore, and blocked states (P2-8) [Score:6] [Agent:easy]

**Required context**

1. Task 2 `listConfiguredHttpConnections`
2. `app/src/lib/ai/providers/chatHttpRailGating.ts`
3. `app/src/routes/+page.svelte` — context restore
4. `app/src/lib/components/ChatBlockedState.svelte`

- `isChatHttpRailVisible`: true when Debug Provider (chat) enabled **or** ≥1 configured enabled connection with resolvable default model.
- Context restore: entering `chat-http` when no connections configured falls back to `notepad` (extend existing policy).
- Blocked-state buttons deep-link to Providers settings.

**Acceptance checklist**

- Rail appears when any valid connection exists (not only “default”).
- Restore tests updated for multi-connection and zero-connection cases.

Dependencies: Task 2, Task 5.

---

#### Task 7: Tests, validation suite, and docs (P2-8) [Score:7] [Agent:medium]

**Required context**

1. All prior tasks
2. `app/src/lib/state/chatPhase2.validation.test.ts`
3. `app/src/lib/ai/providers/selection.test.ts`
4. `app/src/lib/services/providerSecretsStore.test.ts`
5. `docs/architecture.md` (minimal update if user-visible)

- Add/extend unit tests for connection resolver, settings normalization, composer selection, send per connection.
- Update validation suites (phase-2, M5/M6 if touched) for multi-connection gating.
- Run `npm test` and `npm run check` from `app/`.
- Mark M4 exit criteria in this file and update [phase-2.md](./phase-2.md) milestone table.
- Changelog entry for M4 planning / completion as appropriate.

**Acceptance checklist**

- All M4 tasks marked `[DONE]`.
- No regressions in chat-http streaming, debug provider split, workspace HTTP send.
- `npm test` / `npm run check` pass.

Dependencies: Tasks 1–6.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 3 → Task 5 → Task 7
              ↘ Task 4 ↗
Task 2 → Task 6 → Task 7
```

Requires Milestone 3 complete before Task 1.

## Mapping to phase-2 / phase-7 task IDs

| ID | Execution plan task |
|----|---------------------|
| P2-8 (new) | Milestone 4 — multiple HTTP providers |
| P7-1 | Tasks 1, 2, 4 |
| P7-2 | Tasks 3, 5, 6 |

Phase 7 tier 2B–C (regenerate/edit, system prompt) remain in [phase-7.md](../phase-7/phase-7.md).

## Milestone 4 exit criteria

- [ ] User can add multiple named HTTP connections in Settings → Providers.
- [ ] Each connection has its own API key (secrets file) and model catalog.
- [ ] Chats composer picks connection then model; sends use the correct base URL and key.
- [ ] Workspace HTTP chat uses the same connection list.
- [ ] Chat rail visible when ≥1 connection is configured (or Debug Provider enabled in Chats).
- [ ] Legacy single `http` settings normalize to one default connection on load.
- [ ] `npm test` / `npm run check` pass.

## Non-goals (M4)

- Regenerate or edit-message flows (phase 7 tier 2B).
- Per-chat system prompt (phase 7 tier 2C).
- RAG, knowledge bases, Ollama pull UI (phase 7 tier 3).
- Non–OpenAI-compatible provider protocols.
- Workspace OpenCode / phase 6 agent platform.

## Key files (expected touch)

| Area | Files |
|------|--------|
| Schema | `contracts.ts`, `appProviderSettings.ts`, `settingsSlice.ts` |
| Secrets | `providerSecretsStore.ts`, `appShellRuntime.ts` |
| Runtime | `openAiCompatibleChatProvider.ts`, `bootstrap.ts`, `sendChatMessage.ts`, `httpConnectionSettings.ts` |
| Selection | `selection.ts`, `chatHttpRailGating.ts` |
| UI | `SettingsDialog.svelte`, `ChatComposer.svelte`, `ChatPanel.svelte`, `ChatBlockedState.svelte` |
| State | `chatStore/threads.ts`, `chatPersistence.ts` |
| Tests | `selection.test.ts`, `providerSecretsStore.test.ts`, `chatPhase2.validation.test.ts`, `sendChatMessage.test.ts` |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-06 | Initial M4 execution plan — multiple HTTP providers (phase 7 tier 2A pulled into phase 2) |
