# Phase 2 — Chat context (Open WebUI tier 1)

**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [phase-1.md](../phase-1/phase-1.md)  
**Execution:** [execution-plan-m1.md](./execution-plan-m1.md) → [m2](./execution-plan-m2.md) → [m3](./execution-plan-m3.md) → [m4 multiple providers](./execution-plan-m4-multiple-providers.md)  
**Status:** tier 1 done; **M4** (multiple providers) done  
**Estimate:** tier 1 ~2–3 weeks after phase 1; M4 ~1 week incremental

## Goal

Ship **`chat-http`** as a dedicated activity-rail context: chat-first UI (no project panel), OpenAI-compatible HTTP backend from phase 1, **SSE streaming** required for exit (B3B).

## Decisions applied

| ID | Answer | Implication |
|----|--------|-------------|
| A1 | A | Context id `chat-http` |
| A2 | D | Rail after Notepad separator; **gating**: show Chat when HTTP connection configured |
| A3 | A | No file editor tabs in Chat context |
| A4 | A | `chatHttp` (or similar) top-level field in window session snapshot |
| C1 | B | Sidebar title **Chats** (not Agents) |
| C2 | A | **ask** mode only |
| C3 | A | Debug available when enabled in settings |
| B2 | A | Workspace still uses HTTP agents until phase 4 |

## Gating (Chat rail button)

Show **Chat** when:

- Connection `enabled === true`
- Non-empty trimmed API key (secrets)
- Valid `baseUrl`
- Default model resolvable from catalog

Otherwise hide button (or show disabled with link to Settings → Connections).

## Deliverables

### Context & session

- `ContextId` includes `chat-http`; switching context loads `chatHttp` snapshot.
- Persist `chatHttp` in `session.json` (mirror `notepad` structure).
- `chatStore` (or successor) scoped by `chat-http` — not `activeWorkspaceRoot`.

### Activity rail

- New rail button (icon + tooltip distinct from Cloud/Notepad).
- Wire `onSelectContext("chat-http")`.
- Implement gating visibility per [roadmap.md](./roadmap.md#activity-rail-gating-a2d).

### UI shell

- Reuse/adapt: chats sidebar, agent/chat tabs, `ChatPanel`, `ChatComposer`.
- Label sidebar **Chats** (C1B).
- No `AgentsSidebar` / project panel / workspace preflight.
- **ask** mode only; no workspace **review** file reads.

### Backend

- Phase 1 OpenAI-compatible provider.
- Implement **`streamMessage`** + SSE parsing; composer shows token deltas (B3B exit).

### Persistence

- App data: `chat/chat-http/` (or `chat/{scopeId}/`) for agent index + threads.
- Debounced writes consistent with workspace chat patterns.

### Notepad

- Unchanged — no AI, no chat entry from notepad.

## Exit criteria

- [x] User completes Connections setup → Chat appears on rail.
- [x] User creates chats, sends messages, sees streamed assistant text.
- [x] Debug works in Chat when enabled (C3A).
- [x] Notepad has no AI entry points.
- [x] Workspace HTTP chat still works (B2A).
- [x] `npm test` / `npm run check` pass.

## Non-goals (tier 1 — M1–M3)

- `chat-cloud` context (phase 3).
- OpenCode workspace agents.

## Milestone 4 — Multiple providers (extension)

See [execution-plan-m4-multiple-providers.md](./execution-plan-m4-multiple-providers.md).

Named **HTTP (OpenAI-compatible) connections** in Settings → Providers; composer picks **connection → model**. Pulls forward phase-7 tier 2A only (not regenerate/edit, system prompt, or RAG).

| Exit (M4) | |
|-----------|--|
| [x] | Multiple connections in Settings |
| [x] | Per-connection API key and model catalog |
| [x] | Composer connection picker in Chats and workspace HTTP chat |
| [x] | Rail gating: ≥1 configured connection (or Debug Provider in Chats) |

## Key files (expected touch)

- `ActivityRail.svelte`, `+page.svelte` (context switch, layout)
- `appState` / `contextHelpers.ts`, `contracts.ts` (`WindowContextState`)
- `chatStore/*`, `chatPersistence.ts`
- `ChatPanel.svelte`, `ChatComposer.svelte`, `AgentsSidebar.svelte` (labels)
- HTTP provider streaming implementation

## Task outline

| ID | Task |
|----|------|
| P2-1 | Session snapshot + context switch for `chat-http` |
| P2-2 | `chatStore` scope by context id + persistence path |
| P2-3 | Activity rail button + gating helper |
| P2-4 | Chat-only layout (no project panel) |
| P2-5 | SSE streaming end-to-end |
| P2-6 | Chats label, ask-only modes, Debug in Chat |
| P2-7 | Tests + validation suite updates |
| P2-8 | Multiple HTTP providers (M4) — [execution-plan-m4](./execution-plan-m4-multiple-providers.md) |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-06 | Added M4 execution plan — multiple HTTP providers (connections list) |
| 2026-06-05 | Added milestone execution plans (m1–m3) |
| 2026-06-04 | Initial phase 2 spec |
