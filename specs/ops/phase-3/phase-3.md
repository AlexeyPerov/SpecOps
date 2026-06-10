# Phase 3 — OpenCode workspace UI

**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [phase-1.md](../phase-1/phase-1.md) (`WorkspaceAgentBackend` stub); phases 2 and 4 may ship in parallel but not required  
**Execution:** [execution-plan-m1.md](./execution-plan-m1.md) → [m1-5](./execution-plan-m1-5.md) → [m2](./execution-plan-m2.md) → [m3](./execution-plan-m3.md)  
**Status:** complete  
**Estimate:** ~2–3 months for MVP  
**OpenCode integration checklist (in this phase):** S1–S5 below; plan/build S6 stretch → [phase-6.md](../phase-6/phase-6.md) if using own platform later

## Goal

**SpecOps as alternative UI for OpenCode:** workspace folders use `@opencode-ai/sdk` against an OpenCode server; **remove workspace HTTP chat** when MVP criteria met (E3B).

Chat (`chat-http`) and Cloud (`chat-cloud`) lanes unchanged.

## Decisions applied

| ID | Answer | Implication |
|----|--------|-------------|
| E1 | C | Default: Tauri sidecar `opencode serve`; Settings: optional server URL + auth |
| E2 | A | No import of legacy workspace chat JSON into OpenCode sessions |
| E3 | B | MVP = stream + **tool cards** + **permission/question replies** before HTTP removal |
| B2 | A | Drop workspace HTTP only after MVP |
| B4 | A | Implement `WorkspaceAgentBackend` for `opencode` |

## Product model

| Context | Agent runtime |
|---------|----------------|
| `chat-http` | OpenAI-compatible HTTP (unchanged) |
| `chat-cloud` | Cursor cloud SDK (unchanged) |
| `ws-*` | **OpenCode** server + SDK |

OpenCode provider/API keys are configured in **OpenCode config** (surfaced via SpecOps settings / `config.patch`), not legacy GLM fields.

## Server deployment (E1C)

### Default path

1. User opens workspace folder in SpecOps.
2. SpecOps spawns or attaches to OpenCode server for that **`directory`** (`rootPath`).
3. Use `createOpencodeClient({ directory, baseUrl })` (or SDK server helper).
4. Health indicator in settings / status UI.

### Optional path

- User runs `opencode serve` (local or remote).
- SpecOps Settings: **server URL**, password if `OPENCODE_SERVER_PASSWORD` set.
- Same `directory` header / query as OpenCode expects.

## MVP scope (E3B)

Required before removing workspace `ChatProvider` HTTP:

| Capability | SpecOps UI |
|------------|------------|
| Session per agent tab | Map `agentId` ↔ OpenCode session |
| Prompt / run stream | Composer streaming text deltas |
| Tool execution | Tool start/end cards in transcript |
| Permissions | Modal → `permissions.reply()` |
| Questions | Modal → `questions.reply()` |
| Models / agents | Sidebar + settings aligned with OpenCode config |

**Not required for MVP cutover:** full migration-plan S6 (plan/build), MCP/LSP/PTY parity — follow-up within phase 3+.

## Deliverables

### `WorkspaceAgentBackend` — OpenCode

- Sidecar lifecycle (start/stop/restart, port conflict handling).
- Session CRUD, prompt, normalized event stream.
- Directory binding: workspace `rootPath` → OpenCode instance.
- Contract alignment docs for API/event/reply/error behavior:
  - [opencode-contract-freeze-m1-5.md](./opencode-contract-freeze-m1-5.md)
  - [opencode-api-mapping.md](./opencode-api-mapping.md)
  - [opencode-event-normalization-spec.md](./opencode-event-normalization-spec.md)
  - [opencode-permission-question-flow.md](./opencode-permission-question-flow.md)
  - [opencode-error-mapping.md](./opencode-error-mapping.md)
  - [opencode-m1-gap-analysis.md](./opencode-m1-gap-analysis.md)

### UI

- Workspace agent tabs use OpenCode backend only (post-cutover).
- Reuse/extend tool + permission UI from phase 4 event work where possible (D2C synergy).

### Remove workspace HTTP

- `sendChatMessage` / `ChatProvider` not used for `ws-*` contexts.
- **Breaking change (E2A):** legacy workspace thread JSON (from pre-phase-3 HTTP chat) is **not imported or migrated** to OpenCode sessions. Existing workspace chat history from the HTTP provider era will not appear in workspace agent tabs after the cutover. This is intentional — no backward-compat migration shims are added.

### Settings

- OpenCode server mode: sidecar vs URL.
- Health check; link to OpenCode provider configuration.

## Exit criteria

- [x] Open workspace → agent turn runs via OpenCode with tools on disk.
- [x] Permission prompt blocks and resolves in UI.
- [x] Workspace composer does not call HTTP `ChatProvider`.
- [x] Chat and Cloud contexts still work.
- [x] `npm test` / `npm run check`; manual smoke on real folder.

## Non-goals (phase 3 MVP)

- Cursor local backend (phase 5).
- Own agent platform ([phase-6.md](../phase-6/phase-6.md) — G2A after phase 5).

## OpenCode integration checklist (S-phases)

| S | phase 3 |
|------------------|---------|
| S1 | Server + health + client |
| S2 | Agents list, session per tab |
| S3 | Event stream in composer |
| S4 | Model/provider settings |
| S5 | Permission + question modals |
| S6 | Plan/build — stretch |

## Task outline

| ID | Task |
|----|------|
| P3-1 | OpenCode server lifecycle in Tauri |
| P3-2 | SDK client + `WorkspaceAgentBackend` implementation |
| P3-3 | Session ↔ agent tab mapping |
| P3-4 | Event stream + tool cards |
| P3-5 | Permission + question UI |
| P3-6 | Settings (server URL, OpenCode config) |
| P3-7 | Remove workspace HTTP paths + changelog |
| P3-8 | Tests + docs |

## End user summary

See [roadmap.md](../roadmap.md#end-user--opencode-workspace-e1c).

## Changelog

| Date | Change |
|------|--------|
| 2026-06-10 | Phase 3 MVP complete: all exit criteria met, workspace HTTP removed, validation gate passing |
| 2026-06-10 | Added breaking-change note for E2A: legacy workspace HTTP threads not migrated to OpenCode sessions |
| 2026-06-09 | Added M1.5 contract-alignment bridge and OpenCode integration docs |
| 2026-06-09 | Swapped with former phase 4 (OpenCode now phase 3) |
| 2026-06-04 | Initial phase 4 spec |
