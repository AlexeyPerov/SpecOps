# Phase 3.5 Milestone 3 Execution Plan — Composer enhancements

**Status:** DONE

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m0.md](./execution-plan-m0.md) M0-T1/T2

**Goal:** slash commands, @ mentions, attachments, prompt history.

Slash commands insert template into composer for user edit before send (see
[questions.md Q11](./questions.md)). @ mentions scope: files + agents (see
[questions.md Q12](./questions.md)).

---

## Tasks

- [x] **M3-T1 — Slash command popover.** When the cursor types `/` at the start
  of the input (or after whitespace), fetch `command.list` and show a filtered
  popover. Selecting a command inserts its template text. Re-fetch on workspace
  open (commands can be project-specific).
  - Files: new `SlashCommandPopover.svelte`; update `ChatComposer.svelte`;
  new `ai/backends/opencodeCommands.ts`.

- [x] **M3-T2 — @ mention picker.** When the cursor types `@`, show a context
  picker with tabs: Files (via `find.files`), Agents (from catalog). Selected
  mentions are inserted as `@name` tokens and their content is appended to the
  prompt payload. (MCP resources and symbols deferred.)
  - Files: new `MentionPicker.svelte`; update `ChatComposer.svelte`;
  new `ai/backends/opencodeSearch.ts` (wrapping `find.*`).

- [x] **M3-T3 — File attachments.** Drag-and-drop onto composer or file-picker
  button. Attachments shown as chips above the input. Images previewed. On
  send, attachments are included in the prompt payload (as file parts or
  context references).
  - Files: new `AttachmentTray.svelte`; update `ChatComposer.svelte`;
  update `WorkspaceAgentSendRequest` to carry attachments.

- [x] **M3-T4 — Prompt history.** Store per-workspace prompt history (last N
  prompts). Arrow-up / arrow-down (when input is empty or at start) cycles
  through history. Frecency ordering.
  - Files: new `services/promptHistory.ts`; update `ChatComposer.svelte`.

- [x] **M3-T5 — Queued prompts.** When a turn is running and user sends another
  prompt, queue it instead of rejecting. Show queued prompts as chips. Toggle:
  "steer" (interrupt + append) vs "queue" (deliver after completion). Calls
  `session.promptAsync` or manages client-side queue.
  - Files: update `ai/chatSendPipeline.ts`, `ChatComposer.svelte`.

- [x] **M3-T6 — Tests.** Popover filtering, mention resolution, attachment
  payload format, history ordering.
