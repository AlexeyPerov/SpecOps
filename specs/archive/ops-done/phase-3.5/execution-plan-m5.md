# Phase 3.5 Milestone 5 Execution Plan — Workspace UX

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m1.md](./execution-plan-m1.md) (cost/token data);
[execution-plan-m2.md](./execution-plan-m2.md) (session APIs)

**Goal:** agent-adjacent surfaces that OpenCode Desktop has.

Embedded terminal (M5-T6) is **deferred** to a later phase per
[questions.md Q7](./questions.md).

---

## Tasks

- [x] **M5-T1 — TODO panel.** Fetch `session.todo` for the active session.
  Render as a checklist with statuses (pending / in_progress / completed).
  Auto-refresh on `todowrite` tool events. Clickable items scroll to the
  relevant message.
  - Files: new `TodoPanel.svelte`; integrate into `AppShell.svelte` layout.

- [x] **M5-T2 — Diff viewer (session-level).** Fetch `session.diff` for all
  file changes in the session. Side-by-side or unified view. File list
  sidebar. Filter: modified / added / deleted. Syntax highlighting.
  - Files: new `DiffViewerPanel.svelte`, new `DiffViewer.svelte`;
  integrate as a tab or panel.

- [x] **M5-T3 — File change tracking in project tree.** Call `file.status` for
  the workspace. Badge modified / new / deleted files in `ProjectTreeView`.
  Scope to session changes when a session is active.
  - Files: update `ProjectTreeView.svelte`; new
  `services/fileStatusTracker.ts`.

- [x] **M5-T4 — Status popover.** Button in title bar opens a popover showing:
  LSP servers (`lsp.status`), MCP servers (`mcp.status`), providers
  (`provider.list` auth status), permission rule count, model info. Quick links
  to relevant settings panels.
  - Files: new `StatusPopover.svelte`; update `TitleBar.svelte`.

- [x] **M5-T5 — Session timeline.** Dialog showing a scrollable list of all
  messages with timestamps. Click to jump to a message in the transcript.
  Search/filter.
  - Files: new `SessionTimelineDialog.svelte`.

- [x] **M5-T6 — Embedded terminal (deferred).** xterm.js panel connected via
  `pty.create` + `pty.connect`. Runs in the workspace directory. Toggleable
  panel (like ConsolePanel). May require Tauri permissions adjustments.
  **Not in phase 3.5 scope** — track in backlog if revisited.
  - Files: new `TerminalPanel.svelte`; new `ai/backends/opencodePty.ts`.

- [x] **M5-T7 — Tests.** TODO rendering, diff format parsing, file status
  badge logic, status popover data aggregation.
