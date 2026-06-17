# Phase 3.5 Milestone 2 Execution Plan — Session management & history

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m0.md](./execution-plan-m0.md) M0-T1/T2;
[execution-plan-m1.md](./execution-plan-m1.md) M1-T3 (hydration) recommended

**Goal:** full session lifecycle — fork, undo/redo, share, rename, export,
session list per workspace.

Fork creates a new agent tab; undo is in-place (see [questions.md Q14](./questions.md)).
Unified session list per workspace (see [questions.md Q10](./questions.md)).

---

## Tasks

- [x] **M2-T1 — Session rename.** Add rename action to agent tab context menu
  and agent sidebar. Calls `session.update({ title })`. Syncs SpecOps
  `AgentIndexEntry.title`.
  - Files: `commands/handlers/workspace.ts` (new command), `chatStore/agents.ts`,
    `AgentSidebarRow.svelte`.

- [x] **M2-T2 — Session list per workspace.** New panel or sidebar mode showing
  all OpenCode sessions for the workspace directory (`session.list` with
  `?directory=`). Search, sort by date, quick-open. Allows opening a session
  that wasn't created as a SpecOps agent tab.
  - Files: new `SessionListPanel.svelte` or extend `AgentsSidebar.svelte`;
  new `ai/backends/opencodeSessionList.ts`.

- [x] **M2-T3 — Session fork.** "Fork from here" action on any message. Calls
  `session.fork({ messageID })`. Creates a new agent tab linked to the forked
  session. Navigate parent / children.
  - Files: `ChatMessageList.svelte` (per-message action), `chatStore/agents.ts`
  (new `forkAgent` action).

- [x] **M2-T4 — Undo / redo (revert / unrevert).** "Undo to here" action on any
  message. Calls `session.revert({ messageID })`. Shows snapshot diff preview
  before confirming. Redo calls `session.unrevert`. Keyboard shortcuts.
  - Files: `ChatMessageList.svelte`, new `RevertPreviewDialog.svelte`,
    `chatStore/runtime.ts`.

- [x] **M2-T5 — Share / unshare.** "Share" button in chat header calls
  `session.share()` → copies URL to clipboard. "Unshare" calls
  `session.unshare()`. Show share status indicator.
  - Files: `ChatPanel.svelte`, new `ai/backends/opencodeSessionShare.ts`.

- [x] **M2-T6 — Summarize.** "Summarize" action calls `session.summarize()`.
  Render summary in a collapsible section at the top of the chat.
  - Files: `ChatPanel.svelte`, new `SessionSummary.svelte`.

- [x] **M2-T7 — Export transcript.** "Export" action generates a markdown file
  from `session.messages`. Save via Tauri file dialog.
  - Files: new `ai/backends/opencodeSessionExport.ts`, command handler.

- [x] **M2-T8 — Session cost / token totals.** Aggregate from message-level
  cost data (M1-T9). Display in chat header.
  - Files: `ChatPanel.svelte`.

- [x] **M2-T9 — Tests.** Session lifecycle flows, fork tree navigation, export
  format correctness.
