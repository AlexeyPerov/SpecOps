# Phase 3.5 Milestone 1 Execution Plan — Richer message rendering

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m0.md](./execution-plan-m0.md) M0-T1/T2 complete

**Goal:** workspace agent transcripts render all OpenCode message part types,
not just flat text + tool cards.

**Why next:** missing reasoning blocks are the most immediately noticeable gap.
Users coming from OpenCode Desktop expect to see the model's thinking.

Hydration strategy: dual — hydrate from `session.messages` on load + extend live
stream normalization (see [questions.md Q2, Q3](./questions.md)).

---

## Tasks

- [x] **M1-T1 — Extend `ChatMessage` domain for parts.** Add a `parts` field to
  the workspace-agent message shape: `text`, `reasoning`, `subtask`, `step`,
  `file`, `diff`, `compaction`, `cost`. Keep flat `content` as a fallback /
  summary. Update `ChatThreadSnapshot` codec (bump version if needed; no
  backward-compat per AGENTS.md).
  - Files: `domain/chat.ts`, `services/chatPersistenceCodec.ts`,
  `state/chatStore/threadMessages.ts`.

- [x] **M1-T2 — Extend stream normalization for reasoning + subtask + step.**
  Map `session.next.reasoning.delta` / `.ended` → `reasoning` part events.
  Map `session.next.subtask.`* → `subtask` part events. Map
  `session.next.step.started` / `.finished` → `step` part events with cost /
  token payload. Add these to `WorkspaceAgentStreamEvent`.
  - Files: `ai/backends/workspaceAgentBackend.ts` (`mapStreamFrame`).

- [x] **M1-T3 — Hydrate session history from `session.messages`.** On agent
  tab open (when `opencodeSessionId` exists), call `session.messages` to fetch
  the full part-structured message list. Map to SpecOps `ChatMessage[]` with
  parts. Replace reliance on local-only thread snapshot as the display source
  for workspace agents (keep local snapshot as offline cache / fallback).
  - Files: new `ai/backends/opencodeSessionMessages.ts`; integration in
    `ai/chatSendPipeline.ts` or a new `restoreWorkspaceAgentSession` path.

- [x] **M1-T4 — Render reasoning blocks.** Collapsible section under each
  assistant message; dimmed / italic; toggle per-message and global
  (show/hide all reasoning). Animate expand/collapse.
  - Files: new `ReasoningBlock.svelte`; update `ChatMessageList.svelte`.

- [x] **M1-T5 — Render subtask (subagent) parts.** Inline panel showing
  sub-agent name, model, status (running/completed/failed), and output summary.
  Expandable to show full sub-agent transcript (collapsible).
  - Files: new `SubtaskCard.svelte`; update `ChatMessageList.svelte`.

- [x] **M1-T6 — Render step boundaries with cost / tokens.** Thin separator
  between agentic steps showing step number, token count (input/output/cache),
  and cost. Running total in message footer.
  - Files: new `StepSeparator.svelte`; update `ChatMessageList.svelte`.

- [x] **M1-T7 — Render file attachments.** Images inline (with click-to-zoom);
  other files as downloadable chips with filename + size.
  - Files: new `FileAttachmentChip.svelte`, `ImageAttachment.svelte`;
  update `ChatMessageList.svelte`.

- [x] **M1-T8 — Render diff / snapshot parts.** Mini unified diff viewer inline
  in the message. Full diff viewer is M5-T2; this is the inline preview.
  - Files: new `InlineDiff.svelte` (reuse a diff library like `diff` or
    `diff2html`); update `ChatMessageList.svelte`. First check whether there is already diff-viewer code in app that can be used here too.

- [x] **M1-T9 — Render cost / token totals.** Per-message footer: tokens
  (input/output/cache) + cost. Session total in chat header or sidebar.
  - Files: update `ChatMessageList.svelte`, `ChatPanel.svelte`.

- [x] **M1-T10 — Markdown rendering for text parts.** Replace plain-text
  rendering with a markdown renderer (e.g. `marked` + `DOMPurify`, or
  `markdown-it`). Syntax-highlighted code blocks. Currently workspace agent
  messages render as plain text. First check whether there is already markdown viewer code in app that can be used here too.
  - Files: new `MarkdownRenderer.svelte`; update `ChatMessageList.svelte`.
  - Implementation: `marked` (GFM + breaks) parses → `highlight.js` (common
    languages) decorates code blocks → `DOMPurify` sanitizes. Memoized via
    `app/src/lib/ai/chatMarkdown.ts`. Assistant non-streaming messages render
    markdown; user messages stay verbatim. Prose styles in
    `app/src/lib/styles/chatProse.css`, token colors reuse `--syntax-*`
    palette. Test environment switched to `jsdom` (DOMPurify mXSS detection
    needs prototype-chain property descriptors that happy-dom doesn't
    expose).

- [ ] **M1-T11 — Tests.** Unit tests for part mapping, stream normalization,
  codec round-trip. Component tests for each new renderer. Run full suite.
