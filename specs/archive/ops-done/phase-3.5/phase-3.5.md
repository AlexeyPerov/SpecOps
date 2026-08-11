# Phase 3.5 — OpenCode desktop parity & richer workspace agents

**Parent:** [roadmap.md](../roadmap.md)
**Prerequisite:** [phase-3.md](../phase-3/phase-3.md) (complete) — OpenCode sidecar, session mapping, stream + tools + permissions + questions
**Execution:** [execution-plan.md](./execution-plan.md) → [m0](./execution-plan-m0.md) → [m1](./execution-plan-m1.md) → [m2](./execution-plan-m2.md) → [m3](./execution-plan-m3.md) → [m4](./execution-plan-m4.md) → [m5](./execution-plan-m5.md) → [m6](./execution-plan-m6.md)
**Gap analysis:** [gap-analysis.md](./gap-analysis.md)
**Decisions:** [questions.md](./questions.md)
**Status:** complete — M0–M6 done; post-review follow-ups tracked in M7–M11 (M7–M11 done)

## Goal

Close the feature and UX gap between SpecOps workspace agents and the OpenCode
Desktop / Web app, so that opening a workspace in SpecOps is **at least as
capable** as using OpenCode's own desktop UI — while retaining SpecOps'
advantages (multi-workspace activity rail, integrated project/editor view,
notepad/chat lanes).

Phase 3 shipped the **minimum viable OpenCode integration**: a prompt goes in,
text streams back, tools render as cards, permissions and questions modal-block
correctly. Phase 3.5 turns that into a **full-featured agent workspace**.

## What phase 3 delivered (baseline)

| Capability | Status |
|------------|--------|
| OpenCode sidecar lifecycle (sidecar / URL modes) | Done |
| Session per agent tab (create / reuse / delete) | Done |
| Prompt → streamed text deltas → completed message | Done |
| Tool start / progress / completed cards | Done |
| Permission modal (once / always / reject) | Done |
| Question modal (multi-choice reply / reject) | Done |
| Agent / provider / model catalog pickers (OpenCode-only) | Done |
| Health check + connection diagnostics | Done |
| `opencode.enabled` gating | Done |

## What's missing (phase 3.5 scope)

Organized into seven milestones (M0–M6). Full detail in [gap-analysis.md](./gap-analysis.md).

### M0 — SDK migration (do first)

SpecOps currently uses a hand-rolled HTTP client in
`workspaceAgentBackend.ts`. Migrating to the official `@opencode-ai/sdk`
(`createOpencodeClient`) reduces maintenance burden, gets automatic API
coverage as OpenCode evolves, and unlocks v2 endpoints. **Implement before M1–M5**
so new features use the SDK from the start.

- Replace `createHttpOpencodeClient` with `createOpencodeClient`.
- Map SDK types to SpecOps contract types.
- Add SDK error interceptor mapping.
- Keep the `WorkspaceAgentBackend` abstraction (needed for phase 5 Cursor local).

### M1 — Richer message rendering

SpecOps only renders flat text + tool cards. OpenCode messages carry **parts**:
reasoning blocks, subtask (subagent) invocations, step boundaries with cost /
token snapshots, file attachments, diffs (snapshot / patch), compaction
markers, and retry indicators.

- Render reasoning blocks (collapsible, dimmed).
- Render subtask parts with sub-agent name + status.
- Render step-start / step-finish with per-step cost + token counts.
- Render file attachments (images inline, other files as chips).
- Render diff / snapshot parts with a mini diff viewer.
- Render compaction markers.
- Render cost + token totals per assistant message and per session.

### M2 — Session management & history

SpecOps creates a session and streams one turn at a time but has no session
lifecycle management. OpenCode has fork, revert / undo / redo, share, summarize,
rename, archive, diff, and a full messages API that returns structured parts.

- **Session messages hydration** — call `session.messages` on load to get full
  part-structured history (not just flat text). Replaces the local-only thread
  snapshot as source of truth for workspace agents.
- **Rename** agent tab title synced to OpenCode session title.
- **Fork** — branch a session from any message; navigate parent / children.
- **Undo / redo** (`session.revert` / `session.unrevert`) with snapshot diff
  preview.
- **Share / unshare** — public URL copy-to-clipboard.
- **Summarize** — generate session summary.
- **Export** — transcript to markdown.
- **Session list per workspace** — show all OpenCode sessions for the workspace
  directory (not just the ones opened as SpecOps agent tabs), with search and
  quick-open.
- **Cost / token totals** at session level.

### M3 — Composer enhancements

SpecOps composer is a plain textarea + catalog pickers. OpenCode's prompt
input supports slash commands, @ mentions, file / image attachments, prompt
history, and queued-prompt delivery modes.

- **Slash commands** — `/` trigger opens a command list (`command.list` API);
  selecting one inserts it into the prompt. Built-in: `/init`, `/review`, plus
  config-defined and MCP-sourced commands.
- **@ mentions** — `@` trigger opens a context picker: files and agents.
  Selected mentions are appended to the prompt as context.
- **File attachments** — drag-and-drop or file-picker; images previewed inline.
- **Prompt history** — arrow-up / arrow-down cycles through previous prompts
  (frecency-ordered).
- **Queued prompts** — when a turn is running, show queued prompts with
  steer-vs-queue delivery toggle.

### M4 — Configuration management (the "better than OpenCode" stream)

OpenCode config lives in `opencode.json` / `opencode.jsonc` files with layered
discovery. OpenCode Desktop exposes some of this via settings dialogs but much
of it is JSON-only. SpecOps can provide a **visual config editor** that is more
approachable than hand-editing JSON.

- **OpenCode config panel** — read `config.get`, edit via `config.update`.
  Sections: model / small_model / default_agent, username, share mode,
  autoupdate, snapshot, compaction, tool_output truncation, experimental flags.
- **Provider management** — `provider.list` + `provider.auth` + OAuth flows.
  Connect / disconnect providers, set API keys (stored in OpenCode config, not
  SpecOps secrets), view model availability.
- **MCP server management** — `mcp.status`, `mcp.add`, `mcp.connect`,
  `mcp.disconnect`, OAuth. Add local (stdio) or remote (HTTP/SSE) MCP servers
  via a form, see connection status, enable / disable.
- **Agent management** — list built-in + custom agents (from `opencode.json`
  `agent:` key + `.opencode/agent/*.md`). Create / edit custom agents: set
  model, prompt, mode (primary / subagent), description, permission rules,
  steps limit. Optionally: AI-generate an agent from a description.
- **Permission rules editor** — visual editor for the `permission:` config
  object: per-tool allow / deny / ask with glob patterns.
- **Slash command management** — view config-defined commands; create / edit
  command templates.
- **Instructions / skills management** — view and edit `instructions:` file
  list and `skills:` paths.

### M5 — Workspace UX: terminal, diffs, status, TODO

OpenCode Desktop embeds a terminal, a diff viewer, a status popover, and a TODO
panel. SpecOps has the project tree + editor but not these agent-adjacent views.

- **TODO panel** — `session.todo` API; render the agent's TODO list (from
  `todowrite` tool) as a checklist with status (pending / in_progress /
  completed).
- **Diff viewer** — `session.diff` API; show file changes for the session with
  a side-by-side or unified diff. Clicking a file in the TODO or message opens
  its diff.
- **Status popover** — LSP count, MCP count, provider status, model info,
  permission rule count. One-click access from the title bar.
- **File change tracking** — `file.status` API; show modified / new / deleted
  files badge in the project tree for the active session.
- **Embedded terminal** — deferred; see [backlog.md](../../backlog.md).

### M6 — Appearance & feedback

- **Theme compatibility** — keep existing SpecOps themes; extend tokens only
  where new phase-3.5 UI components need styling (no new theme library).
- **Font size configuration** — adjustable font size for chat + editor; keep
  existing mono / sans font families (no font picker).
- **Keybinding customization** — editable keybinds for workspace agent actions
  (send, abort, new agent, switch agent, fork, undo).
- **Sound / OS notifications** — per-event sounds and native notifications on
  agent completion / permission / error (see [questions.md Q9](./questions.md)).

## Prioritization

| Stream | Impact | Effort | Recommended order |
|--------|--------|--------|-------------------|
| M0 SDK migration | Low user impact, high dev value | Medium | **1st** (blocking) |
| M1 Message rendering | High — users immediately notice missing reasoning | Medium | 2nd |
| M2 Session management | High — core workflow (undo, fork, history) | High | 3rd |
| M3 Composer | High — daily-use interaction surface | Medium | 4th |
| M4 Config management | High — "better than OpenCode" differentiator | High | 5th (can parallel M2/M3) |
| M5 Diffs / TODO / status | Medium — power-user features | High | 6th (terminal deferred) |
| M6 Appearance | Medium — polish | Low–Medium | Incremental (no blockers) |

## Non-goals

- Cursor local backend (phase 5).
- Own agent platform (phase 6).
- Chat HTTP / Cloud context enhancements (phase 2 / 4 / 7).
- Notepad features.
- Plugin system (SpecOps-specific plugins are a future consideration).
- Full TUI keybind parity (SpecOps is a GUI; only practical subsets apply).

## Exit criteria

- [x] Workspace agent backend uses `@opencode-ai/sdk` (M0).
- [x] Workspace agent transcript renders reasoning, subtask, step, diff, and
      attachment parts (M1; live-stream wiring closed by M8).
- [x] Session history hydrates from `session.messages` with full parts (M2).
- [x] Undo / redo, fork, rename, share, export all work from the UI (M2).
- [x] Composer supports slash commands, @ mentions, and file attachments (M3).
- [x] OpenCode config, providers, MCP, agents, and permissions are editable
      from SpecOps settings (M4).
- [x] TODO panel + diff viewer render live session data (M5; diff-store
      `messageId` correctness closed by M7-T2).
- [x] Font size configuration + keybinding customization + sound/OS
      notifications available (M6); themes remain as-is with compatibility for
      new UI.
- [x] `npm test` / `npm run check` / `cargo test` pass.

## Changelog

| Date | Change |
|------|--------|
| 2026-06-19 | Phase 3.5 marked complete: exit-criteria checklist ticked (M0–M6 done; M7–M11 post-review follow-ups done). Post-review follow-up plan (M7–M11) tracked per-milestone in `execution-plan.md`. |
| 2026-06-15 | Decisions applied; M7 → M0; execution plan split per milestone |
| 2026-06-14 | Initial draft |
