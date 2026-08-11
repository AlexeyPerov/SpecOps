# Phase 5 — Cursor local workspace backend

**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [phase-3.md](../phase-3/phase-3.md) (OpenCode MVP shipped)  
**Status:** planning  
**Estimate:** ~3–5 weeks after phase 3 MVP

## Goal

In **workspace** context only, let users switch agent backend **OpenCode** ↔ **Cursor local** (`@cursor/sdk` with `local: { cwd: rootPath }`). Default for new workspaces: **OpenCode** (F3A).

Chat and Cloud contexts unchanged.

## Decisions applied

| ID | Answer | Implication |
|----|--------|-------------|
| F1 | A | Persist backend choice on `WorkspaceEntry` |
| F2 | A | Capability badge; disable unsupported UI per backend |
| F3 | A | Default `opencode` for new workspaces |

## Deliverables

### Per-workspace setting

- Field on workspace entry e.g. `agentBackend: "opencode" | "cursor-local"`.
- Settings UI + optional composer indicator.
- Switching backend: document session boundary (new run / new session policy TBD in implementation notes).

### Cursor local adapter

- Implement `WorkspaceAgentBackend` for `cursor-local`.
- `cwd` = workspace `rootPath`.
- `run.stream()` → same normalized events as OpenCode path where possible.

### Capability matrix (F2A)

| Feature | OpenCode | Cursor local |
|---------|----------|--------------|
| Plan/build | Yes (when S6 / [phase-6.md](../phase-6/phase-6.md) platform) | Show badge / disable if unsupported |
| MCP / tools | Per backend | Per backend |
| Permissions | OpenCode flow | Map Cursor events or disable |

UI must not imply feature parity when backends differ.

### OpenCode remains primary

- New workspace defaults to OpenCode (F3A).
- Cursor local is opt-in per project.

## Exit criteria

- [ ] Same folder: user switches backend, sends agent message on both adapters.
- [ ] Unsupported actions show badge or disabled state (F2A).
- [ ] Chat + Cloud unaffected.
- [ ] `npm test` / `npm run check`.

## Non-goals

- Cursor **cloud** in workspace (lives in `chat-cloud` only).
- Replacing OpenCode as default.

## Task outline

| ID | Task |
|----|------|
| P5-1 | Workspace `agentBackend` persistence |
| P5-2 | Cursor local `WorkspaceAgentBackend` |
| P5-3 | Settings + composer backend selector |
| P5-4 | Capability matrix in UI |
| P5-5 | Tests + docs |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-04 | Initial phase 5 spec |
