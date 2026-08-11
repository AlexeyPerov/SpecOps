# Phase 2 Milestone 3 Execution Plan — SSE streaming, validation, exit

**Spec:** [phase-2.md](./phase-2.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m2.md](./execution-plan-m2.md) complete

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task. This milestone closes phase-2 exit criteria.

## Assumptions

- Milestones 1–2 complete: `chat-http` context, chat shell, ask-only, debug in chat.
- Phase 2 **requires** SSE streaming for exit (B3B): `streamMessage` on HTTP provider with token deltas in UI.
- `streamProviderMessage` in `chatSend.ts` already consumes `provider.streamMessage` when present; HTTP provider currently uses buffered `sendMessage` only (`stream: false`).
- Debug provider already implements `streamMessage` — use as reference implementation and test harness.
- Workspace HTTP chat may continue buffered send in phase 2 (B2A); streaming required at minimum in `chat-http` context. Prefer shared send path if low risk.
- Cancellation/retry behavior should match existing debug streaming semantics where possible.

## Confidence and Risks

Confidence: Medium–Low.

Resolved constraints:

1. Provider interface already defines optional `streamMessage` and `ProviderStreamChunk` (`app/src/lib/ai/providers/types.ts`).
2. `sendChatMessage.ts` integrates `streamProviderMessage` with `onChunk` callback for UI updates.
3. OpenAI-compatible SSE format is well-documented (`data: {...}\n\n`, `[DONE]` terminator).

Residual uncertainties:

1. Target HTTP backends (Ollama, Open WebUI, generic OpenAI proxy) may differ in SSE JSON shape or error mid-stream handling — need tolerant parser + tests with fixtures.
2. Whether workspace chat should also stream when HTTP provider gains `streamMessage` — default: enable for all HTTP sends if `streamProviderMessage` path is already shared; document in Task 3.
3. UI flicker/latency: composer vs panel message list update strategy during deltas (likely patch assistant message in store per chunk).

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: HTTP `streamMessage` and SSE parser (P2-5) [Score:9] [Agent:heavy] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — Backend: `streamMessage` + SSE parsing
2. `app/src/lib/ai/providers/openAiCompatibleChatProvider.ts` — buffered send today
3. `app/src/lib/ai/providers/debugChatProvider.ts` — `streamMessage` reference
4. `app/src/lib/ai/providers/types.ts` — `ProviderStreamChunk`

- Implement `streamMessage` on `OpenAiCompatibleChatProvider`:
  - POST `{baseUrl}/chat/completions` with `stream: true`, `Accept: text/event-stream` (or compatible headers).
  - Parse SSE lines: `data: ` JSON chunks, handle `[DONE]`, ignore heartbeats/comments.
  - Yield `delta` from `choices[0].delta.content` (and compatible aliases if needed).
- Add `openAiSseParser.ts` (or inline module) with unit tests using recorded SSE fixtures.
- Map stream errors to `ChatProviderError` (HTTP status, malformed JSON, truncated stream).
- Keep existing `sendMessage` (`stream: false`) for fallback/tests.

**Acceptance checklist**

- Provider unit tests parse multi-chunk SSE into ordered deltas.
- Error fixtures produce typed provider errors (4xx, mid-stream failure).
- `checkCapabilities` unchanged; streaming does not bypass config gating.

Dependencies: Milestone 2 complete.

---

#### Task 2: Send pipeline streaming integration (P2-5) [Score:8] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/ai/sendChatMessage.ts` — turn lifecycle, `streamProviderMessage` usage
2. `app/src/lib/ai/chatSend.ts` — `streamProviderMessage`
3. `app/src/lib/state/chatStore` — runtime `isGenerating`, message append/patch

- Ensure send path prefers `streamProviderMessage` when HTTP provider exposes `streamMessage` (already default in `chatSend.ts` — verify wiring).
- Add `onChunk` handler in `sendChatMessage` to append/update assistant message content incrementally in `chatStore` (placeholder assistant message at turn start).
- Persist thread debounced during/after stream (reuse `scheduleAgentThreadFilePersistence`; avoid per-chunk disk writes).
- Handle `TurnCancelledError`: stop stream, finalize partial assistant content or remove placeholder per existing cancel policy.
- Retry last turn: replay streaming path.

**Acceptance checklist**

- Sending in `chat-http` uses HTTP `streamMessage` (mock/spy test asserts `stream: true` request).
- Assistant message grows incrementally in store during stream.
- Cancel mid-stream stops fetch/generator and clears `isGenerating`.
- Retry works after failed stream.

Dependencies: Task 1.

---

#### Task 3: UI token delta rendering (P2-5) [Score:7] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/ChatPanel.svelte` — message list rendering
2. `app/src/lib/components/ChatComposer.svelte` — generating state
3. `app/src/lib/state/chatStore/runtime.ts` — `isGenerating` flags

- Ensure `ChatPanel` reactively shows partial assistant content during generation (no flash on finalize).
- Composer send button / generating indicator reflects streaming state (`isGenerating`).
- Optional: streaming cursor or subtle in-progress styling on last assistant bubble.
- Verify chat-http and workspace (if shared stream path) both render deltas correctly.

**Acceptance checklist**

- User sees assistant text appear token-by-token (or chunk-by-chunk) in Chat context.
- UI returns to idle state after stream completes or errors.
- No duplicate assistant messages on stream complete.

Dependencies: Task 2.

---

#### Task 4: Stream failure, retry, and provider error copy (P2-5) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/ai/chatErrorCopy.ts`
2. `app/src/lib/ai/sendChatMessage.test.ts`, `chatSend.test.ts`
3. Task 1 error mapping

- Add user-visible copy for common stream failures (connection drop, parse error, 401/429).
- Ensure `ChatBlockedState` / turn error banner shows stream-specific messages where distinct from buffered send.
- Extend tests: abort controller / cancel; retry after stream error; partial content preserved on retry policy.
- Confirm debug provider streaming still passes existing tests (no regression).

**Acceptance checklist**

- Stream failures surface actionable error in chat UI.
- Retry last turn works after stream failure.
- Existing debug streaming tests pass.

Dependencies: Task 3.

---

#### Task 5: Validation test sweep (P2-7) [Score:8] [Agent:heavy] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — exit criteria, key files
2. All milestone 1–3 touched modules and `chatM*.validation.test.ts`
3. [phase-1 execution plan](../phase-1/execution-plan.md) — P1-9 sweep pattern

- Add HTTP SSE integration tests (mock `fetch` returning `ReadableStream` SSE body).
- Update validation suite headers for phase-2 chat-http scenarios: gating, scope, ask-only, streaming.
- Port or add tests ensuring workspace HTTP chat still works (buffered or stream per Task 2 decision).
- Grep sweep: no accidental `review` mode paths in `chat-http` scope tests.

**Acceptance checklist**

- `npm test` passes from `app/` with new streaming + chat-http coverage.
- Validation tests document phase-2 invariants.
- No GLM/workspace-only assumptions broken in chat-http tests.

Dependencies: Task 4.

---

#### Task 6: Final verification, docs, and phase-2 closure (P2-7) [Score:5] [Agent:easy] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — exit criteria (all)
2. [execution-plan-m1.md](./execution-plan-m1.md), [execution-plan-m2.md](./execution-plan-m2.md) — all tasks DONE
3. `docs/providers.md`, `docs/architecture.md` (light touch if needed)

- Run `npm test` and `npm run check` from `app/`.
- Manual exit checklist:
  - Connections setup → Chat rail appears
  - Create chats, send messages, see streamed assistant text
  - Debug works in Chat when enabled
  - Notepad has no AI entry points
  - Workspace HTTP chat still works
- Check all phase-2 exit criteria boxes in `phase-2.md`.
- Update docs only where phase-2 behavior is user-visible (Chat context, streaming note) — minimal diff.
- Changelog entry for phase-2 planning complete / implementation complete as appropriate.

**Acceptance checklist**

- All phase-2 exit criteria satisfied.
- All tasks in M1, M2, M3 execution plans marked `[DONE]`.
- `npm test` and `npm run check` pass from `app/`.
- Changelog entry added for phase-2 milestone completion.

Dependencies: Task 5.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
```

Requires Milestone 2 complete before Task 1.

## Mapping to phase-2 task IDs

| Phase-2 ID | Execution plan task |
|------------|---------------------|
| P2-1 | Milestone 1 |
| P2-2 | Milestone 1 |
| P2-3 | Milestone 1 |
| P2-4 | Milestone 2 |
| P2-5 | Tasks 1, 2, 3, 4 |
| P2-6 | Milestone 2 |
| P2-7 | Tasks 5, 6 |

## Phase 2 exit criteria (full)

- [x] User completes Connections setup → Chat appears on rail.
- [x] User creates chats, sends messages, sees streamed assistant text.
- [x] Debug works in Chat when enabled (C3A).
- [x] Notepad has no AI entry points.
- [x] Workspace HTTP chat still works (B2A).
- [x] `npm test` / `npm run check` pass.
