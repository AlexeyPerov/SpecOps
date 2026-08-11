# Phase 4 — Cloud context (Cursor SDK cloud)

**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [phase-2.md](../phase-2/phase-2.md) (shared chat shell)  
**Status:** planning  
**Estimate:** ~3–5 weeks after phase 2

## Goal

Ship **`chat-cloud`** context: same chat shell as phase 2, backend = **Cursor SDK cloud agents** on a **remote git repository** (not local `cwd`, not notepad files).

## Decisions applied

| ID | Answer | Implication |
|----|--------|-------------|
| A1 | A | Context id `chat-cloud` |
| A2 | D | Rail: Cloud after Chat; **gating**: show when `CURSOR_API_KEY` set |
| A3 | A | Chat-only (no file tabs) |
| A4 | A | `chatCloud` top-level session field |
| D1 | A | Each chat stores `repoUrl` + `ref` in thread metadata |
| D2 | C | **Collapsible** tool detail in transcript |
| D3 | A | Separate lists/persistence from `chat-http` |
| C1 | B | Sidebar **Chats** in Cloud context too |

## Gating

| Layer | Rule |
|-------|------|
| **Rail** | Show **Cloud** when `CURSOR_API_KEY` is non-empty (trimmed) |
| **Send** | Require `repoUrl` + `ref` on thread (D1A) before `agent.send` / cloud run |

## Deliverables

### Context & session

- `chat-cloud` snapshot in `session.json` (mirror `chatHttp`).
- Separate `chatStore` scope and persistence root from `chat-http` (D3A).

### Activity rail

- Cloud button with gating; order per A2D.

### Shared chat shell

- Reuse phase 2 layout; Cloud-specific composer chrome:
  - Repo URL, ref (per thread — D1A)
  - Model selection (Cursor SDK)
  - Run status, PR link when available
- Sidebar label **Chats**.

### Backend — `@cursor/sdk` cloud

- `Agent.create` with `cloud: { repos: [{ url, startingRef }] }`.
- `agent.send` + `run.stream()` → normalize events to UI message model.
- **Collapsible tool blocks** in transcript (D2C) — share components with phase 3 where possible.
- Resume/follow-up via `Agent.getRun` / subsequent `send`.

### Settings

- `CURSOR_API_KEY` in secrets (never `settings.json`).
- Optional: recent repos list (UX helper; D1A still stores per-thread).

### Copy / UX

- Agent operates on **cloned remote repo**, not SpecOps notepad/workspace files.
- Clear distinction from Chat (HTTP) and Workspace (OpenCode/local).

## Exit criteria

- [ ] Cloud rail visible after API key configured.
- [ ] User starts cloud run with repo+ref, sees streamed messages + collapsible tools.
- [ ] Chat (`chat-http`) unchanged and independent.
- [ ] `npm test` / `npm run check` pass for adapter + UI tests.

## Non-goals

- Cursor **local** `cwd` (phase 5, workspace only).
- OpenCode integration (phase 3).
- Global default repo only without per-chat metadata (rejected D1 vs B).

## Key files (expected touch)

- New: `cursorCloudBackend.ts` (or under `ai/backends/`)
- `ActivityRail.svelte`, session/context state
- `ChatMessageList.svelte` — tool collapsible UI
- Composer fields for repo/ref/model/run
- Settings panel for Cursor API key

## Task outline

| ID | Task |
|----|------|
| P4-1 | `chat-cloud` session + persistence scope |
| P4-2 | Rail gating + context switch |
| P4-3 | Cursor cloud adapter + event mapper |
| P4-4 | Composer repo/ref + send validation |
| P4-5 | Collapsible tool UI (D2C) |
| P4-6 | Settings + blocked states |
| P4-7 | Tests |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-09 | Swapped with former phase 3 (Cloud now phase 4) |
| 2026-06-04 | Initial phase 3 spec |
