# Phase 3.5 Milestone 8 Execution Plan — M1 live-stream parts wiring

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m1.md](./execution-plan-m1.md) (parts domain +
extractors + stream event types); [execution-plan-m7.md](./execution-plan-m7.md)
(M7 lands before this touches the pipeline).

**Status:** DONE.

**Goal:** close the headline functional gap from the review — reasoning,
subtask, and step parts render **during** a live workspace-agent turn, not only
after the turn finishes and the tab is reopened (which triggers M1-T3
`session.messages` hydration).

**Why this is a P1 functional gap, not just polish:** the M1 execution plan
(`execution-plan-m1.md:13-14, 28-33`) called for a **dual** strategy — hydrate
on load **and** extend the live stream. M1-T2 added the `reasoning.*` /
`subtask.started` / `step.*` variants to `WorkspaceAgentStreamEvent`, but the
consumer in `chatSendPipeline.ts` never turns them into parts. During a long
agentic turn the user sees flat text + tool cards only; reasoning panels, step
separators, per-step cost, and subtask cards appear only after re-opening the
tab. That is a visible regression vs. OpenCode Desktop, which is the stated goal
of phase 3.5.

**Chosen approach (per user):** handle the new event types inside the
`chatSendPipeline` stream loop and call `chatStore.updateMessageParts(...)`
incrementally — true live rendering. (End-of-turn `listMessages`
re-hydration is **not** the chosen approach; the pipeline already re-renders
text on `message.completed`, so the same incremental pattern is followed for
parts.)

---

## Tasks

- [x] **[P1] M8-T1 — Handle reasoning / subtask / step stream events in
  `chatSendPipeline`.** The `for await` loop over `backend.streamEvents(...)`
  currently handles only `message.delta`, `message.completed`, `tool.*`,
  `run.failed`, `permission.requested`, `question.requested`
  (`chatSendPipeline.ts:753-869`). The M1-T2 events fall through and are
  silently dropped. Add handling that upserts parts on the active assistant
  message via `chatStore.updateMessageParts`:
  - `reasoning.delta` → append/merge the reasoning part text (track per
    `reasoningId`), then `updateMessageParts`.
  - `reasoning.ended` → finalize the reasoning part text for `reasoningId`.
  - `subtask.started` → upsert the subtask part (keyed by `subtaskId`) with
    `status: "running"`.
  - `step.started` → upsert a `step` part (phase `start`, `index` from the
    event) for `stepId`.
  - `step.finished` → upsert the matching `step` part (phase `finish`,
    cost/tokens/reason).
  - `step.failed` → upsert the matching `step` part as failed (the
    normalization maps this to a step-finish with no token payload; ensure the
    extractor surfaces it as `status: "failed"` per `chatSteps.ts`).
  - Implementation notes:
    - Maintain a local `parts: ChatMessagePart[]` accumulator for the active
      assistant message (mirroring how `accumulated` text + `toolCalls` are
      tracked today). On each relevant event, derive the next `parts` array and
      call `chatStore.updateMessageParts(assistantMessage.id, parts,
      activeAgentId, root)`.
    - Reuse the existing pure extractors (`chatReasoning` / `chatSubtasks` /
      `chatSteps`) only where they apply to a *complete* message; the live path
      needs incremental upsert logic, which may belong in a new small helper
      (e.g. `ai/chatStreamParts.ts`) to keep the pipeline loop readable and the
      logic unit-testable.
    - Preserve the existing `message.completed` behaviour: on completion, the
      parts accumulator should be flushed once (idempotent) so the final
      message carries the structured parts. Do **not** add an end-of-turn
      `listMessages` re-hydration — keep the single live source.
    - Order parts so the renderers (`ChatMessageList.svelte`: reasoning →
      subtask → step → content) lay out correctly; match the ordering the
      `opencodeSessionMessages` mapper produces so live and hydrated views are
      visually consistent.
  - Files: `app/src/lib/ai/chatSendPipeline.ts` (stream loop `:753-869`);
    likely new `app/src/lib/ai/chatStreamParts.ts` (incremental part upsert
    helpers); `app/src/lib/domain/chat.ts` (reuse `ChatMessagePart` shapes).
  - Existing API to reuse: `chatStore.updateMessageParts(messageId, parts,
    agentId?, workspaceRoot?)` (`state/chatStore/threadMessages.ts:278-327`) —
    already implemented and tested in M1-T1 but never called by the pipeline
    for these event types.

- [x] **[P1] M8-T2 — Tests for live-stream parts.**
  - New `chatStreamParts.test.ts` (if the helper is extracted): incremental
    reasoning delta merge, reasoning-finalize, subtask upsert by id, step
    start→finish pairing, step-failed surfacing, ordering invariant, idempotent
    flush.
  - Extend `chatSendPipeline.test.ts`: a streaming turn that emits
    `reasoning.delta`/`step.*`/`subtask.started` results in an assistant
    message whose `parts` reflect all three (assert via the message snapshot
    after the run, and — where feasible — after each event).
  - Verify the live message renders reasoning/subtask/step during the run (the
    renderer path is already covered by the M1-T11 component tests; this task
    only needs to confirm parts are present on the live message, not re-test
    rendering).

---

## Exit criteria

- During a live workspace-agent turn, the assistant message accumulates
  reasoning / subtask / step parts as the corresponding stream events arrive
  (verified by inspecting the message snapshot mid-turn).
- `message.completed` flushes the final parts exactly once; no end-of-turn
  `listMessages` call is added.
- Live-rendered parts and hydrated (`session.messages`) parts are visually
  consistent (same ordering / shapes).
- New helper logic is unit-tested independently of the pipeline; the pipeline
  test asserts end-to-end part accumulation.
- `npm test` / `npm run check` pass.

## Notes

- This milestone directly satisfies the M1 exit criterion "Workspace agent
  transcript renders reasoning, subtask, step, diff, and attachment parts" for
  the **live** case (M1-T3 only covered the hydrated case).
- If implementing the incremental upsert reveals that the stream events carry
  insufficient data to build stable part ids, fall back to position-derived ids
  (matching the `opencodeSessionMessages` fallback strategy) and document it.
