# Phase 7 — Open WebUI tier 2 / 3 (Chat context)

**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [phase-5.md](../phase-5/phase-5.md) (recommended); **requires** [phase-2.md](../phase-2/phase-2.md) (`chat-http` shipped)  
**Status:** optional / planning  
**Estimate:** tier 2: weeks; tier 3: months per feature  
**Decision:** G1E — defer until after phase 5 stabilizes, then **A → B → C**

## Goal

Extend **`chat-http`** (Open WebUI–style lane) beyond tier 1 — **not** workspace agents, **not** OpenCode/Cursor backends.

| Tier | Scope |
|------|--------|
| **Tier 2** | Multi-connection settings, regenerate/edit messages, per-chat system prompt, streaming polish |
| **Tier 3** | RAG, knowledge bases, Ollama model management, larger subsystems |

Workspace (`ws-*`) and Cloud (`chat-cloud`) are out of scope unless explicitly noted later.

## Decisions applied

| ID | Answer | Implication |
|----|--------|-------------|
| G1 | E | Start only after phase 5 |
| B5 | C | Multi-connection was deferred from phase 1 → **tier 2 here** |
| A3 | A | Still chat-only; tier 3 attachments may add files-to-message later |

## Tier 2 deliverables (order G1: A → B → C)

### A — Multi-connection settings

- Named connections (Open WebUI–style): label, base URL, API key, model catalog each.
- Composer picks **connection** then model.
- Secrets keyed by connection id.
- Replaces single-connection schema from [phase-1.md](../phase-1/phase-1.md).

### B — Regenerate / edit messages

- Regenerate assistant turn.
- Edit user message and resend (policy TBD: truncate thread after edit).

### C — Per-chat system prompt

- Thread metadata `systemPrompt` optional override.
- Settings default + per-chat override in composer or chat settings.

### Streaming polish

- Reconnection, abort, partial failure UX on HTTP SSE path.

## Tier 3 deliverables (optional sub-tracks)

| Track | Content | Notes |
|-------|---------|--------|
| **RAG** | Document ingestion, retrieval, cite in chat | New services + UI panel |
| **Knowledge bases** | Named collections per connection or global | Large scope |
| **Ollama** | Local model pull UI if targeting Ollama endpoints | Connection type variant |
| **Attach file** | Could relax A3 with explicit attach-to-message | Cross-lane concern |

Each tier-3 track is a separate mini-milestone; no commitment in roadmap until tier 2 ships.

## Non-goals

- Workspace OpenCode features (phase 3–6).
- Cursor cloud repo runs (phase 4).
- Replacing HTTP with agent harness in Chat context.

## Exit criteria (tier 2)

- [ ] Multiple connections in Settings; Chat gating uses “at least one connection configured”.
- [ ] Regenerate and edit-message flows work on `chat-http` threads.
- [ ] Per-chat system prompt applied on send.
- [ ] `npm test` / `npm run check`.

## Task outline

| ID | Task |
|----|------|
| P7-1 | Connection list schema + Settings UI |
| P7-2 | Composer connection selector + catalog per connection |
| P7-3 | Regenerate / edit message UI + thread truncation rules |
| P7-4 | System prompt metadata + UI |
| P7-5 | Tier 3 spike docs (RAG / knowledge) — optional |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-04 | Split from roadmap phase 6+; G1E ordering |
