# Phase 3 Milestone 2 Execution Plan — Workspace stream UI, tools, permissions

**Spec:** [phase-3.md](./phase-3.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m1-5.md](./execution-plan-m1-5.md) complete (after [execution-plan-m1.md](./execution-plan-m1.md))

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Assumptions

- Milestones 1 and 1.5 are complete: sidecar/URL runtime plus OpenCode contract alignment bridge.
- MVP gate (E3B) requires: prompt/run stream, tool cards, permission replies, and question replies.
- Workspace keeps existing shell (project panel, editor tabs, agents sidebar); this milestone upgrades AI runtime/UI behavior inside that shell.
- Existing phase-4 event/presentation work can be reused where compatible (D2C synergy noted in phase spec).
- Workspace HTTP send path is still present until milestone 3 cutover.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. MVP capability set is explicit in [phase-3.md](./phase-3.md) and bounded to S1-S5.
2. Workspace agent tabs already provide transcript/composer surfaces for event rendering.
3. OpenCode API/event mapping is frozen in phase-3 contract docs and M1.5 outputs.
4. Contract-freeze baseline is explicit in `opencode-contract-freeze-m1-5.md` for all M2 implementers.

Residual uncertainties:

1. Tool event granularity may differ by provider/tool type; card timeline model should tolerate partial/missing metadata.
2. Model/provider list alignment with OpenCode config may require separate refresh/error states in workspace settings.

## Decisions applied (resolved)

1. Tool cards use idempotent state updates and synthetic placeholders for partial/missing or out-of-order events.
2. Permission/question prompts use single-active-per-session modal policy with FIFO queue.
3. Model/provider catalog uses auto-refresh on open plus manual refresh action.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Workspace composer send + stream integration (P3-4 partial) [Score:8] [Agent:medium] [DONE]

**Required context**

1. [phase-3.md](./phase-3.md) — MVP scope (prompt/run stream)
2. Workspace send pipeline modules (`sendChatMessage` and workspace runtime wiring)
3. Chat panel/composer rendering behavior during generation
4. M1 OpenCode backend event adapter

- Route workspace agent sends through OpenCode backend stream in `ws-*` contexts.
- Preserve existing turn lifecycle semantics:
  - append user message immediately
  - set/clear generating state
  - accumulate assistant deltas into active message
- Ensure stream cancellation and retry flow continue to work.
- Keep non-workspace contexts (`chat-http`, `chat-cloud`) unaffected.

**Acceptance checklist**

- Workspace prompts stream assistant text deltas in real time.
- Generation state transitions are correct on success, cancel, and error.
- No regressions in chat-only contexts.
- Re-verified against M1.5 contract-aligned backend/event mappings before starting Task 2.

Dependencies: Milestones 1 and 1.5 complete.

---

#### Task 2: Tool event timeline and cards (P3-4 partial) [Score:8] [Agent:medium]

**Required context**

1. [phase-3.md](./phase-3.md) — MVP includes tool start/end cards
2. [opencode-event-normalization-spec.md](./opencode-event-normalization-spec.md)
3. [opencode-contract-freeze-m1-5.md](./opencode-contract-freeze-m1-5.md)
4. Existing transcript message/component model for tool events
5. Any phase-4 or shared tool-card UI components for reuse

- Introduce/extend normalized tool event model for workspace transcript:
  - tool start
  - tool output/progress (optional)
  - tool success/failure end state
- Render tool cards inline with assistant transcript in chronological order.
- Add concise collapsed summary plus expandable details where metadata exists.
- Ensure card state updates are idempotent when duplicate/delayed events arrive.
- Ensure implementation follows M1.5 normalization (including out-of-order call completion safeguards).
- Create synthetic placeholder card state when terminal tool events arrive before start events.

**Acceptance checklist**

- Workspace transcript shows tool execution cards per run.
- Cards transition correctly from in-progress to success/failure.
- Re-rendering or reconnecting does not duplicate tool cards.

Dependencies: Task 1 re-verified after M1.5.

---

#### Task 3: Permission request modal + reply plumbing (P3-5 partial) [Score:9] [Agent:heavy]

**Required context**

1. [phase-3.md](./phase-3.md) — Permissions modal and `permissions.reply()`
2. [opencode-permission-question-flow.md](./opencode-permission-question-flow.md)
3. Existing modal infrastructure and run-control actions
4. OpenCode backend event/command API in M1.5 adapter

- Add workspace permission prompt handling:
  - detect permission request events
  - block run progression until user decision
  - open modal with clear action/context details
- Wire modal actions to backend permission reply API.
- Map modal decisions to canonical OpenCode reply actions (`once`, `always`, `reject`).
- Define safe default and dismissal behavior (explicit deny on close unless policy says otherwise).
- Add timeout/recovery behavior for stale permission requests.
- Enforce one active prompt per session; queue additional permission/question prompts FIFO.

**Acceptance checklist**

- Permission request interrupts run flow and surfaces modal.
- Allow/Deny responses are sent to backend and reflected in transcript/run status.
- Closing or navigating away handles pending permission safely.

Dependencies: Task 2.

---

#### Task 4: Question prompt modal + reply plumbing (P3-5 partial) [Score:8] [Agent:medium]

**Required context**

1. [phase-3.md](./phase-3.md) — Questions modal and `questions.reply()`
2. [opencode-permission-question-flow.md](./opencode-permission-question-flow.md)
3. Modal/event runtime from Task 3
4. Transcript/runtime state handling for waiting-for-user input

- Implement question request UI flow similar to permissions:
  - modal prompt with required answer format
  - answer submit/cancel states
  - run resumes after reply
- Support OpenCode question structures (single/multi select, optional fallback text handling).
- Ensure pending-question state survives transient UI rerender without losing user draft.

**Acceptance checklist**

- Question events open modal and pause run until reply.
- Submitted answers resume run and are represented in transcript state.
- Invalid/empty replies are blocked with local validation copy.

Dependencies: Task 3 (shared modal plumbing).

---

#### Task 5: Models/agents list alignment with OpenCode config (P3-6 partial) [Score:7] [Agent:medium]

**Required context**

1. [phase-3.md](./phase-3.md) — Models/agents sidebar + settings aligned with OpenCode
2. [opencode-api-mapping.md](./opencode-api-mapping.md)
3. Workspace model/provider selector and related settings panels
4. M1 settings health/runtime connectivity model

- Add OpenCode-driven model/agent options for workspace selectors using contract-aligned backend catalog calls.
- Handle loading/error/empty states with clear user guidance to OpenCode config.
- Keep thread/tab selected model metadata coherent when model disappears/changes.
- Add refresh action/path for pulling latest OpenCode model/provider list.
- Auto-refresh catalogs on workspace/composer open and keep manual refresh control in UI.

**Acceptance checklist**

- Workspace model selection reflects OpenCode-configured options.
- Misconfigured/empty OpenCode provider state surfaces actionable blocked-state copy.
- Stale selected model falls back safely (deterministic rule).

Dependencies: Task 2 and M1.5 catalog alignment outputs.

---

#### Task 6: Milestone 2 tests and verification (P3-8 partial) [Score:7] [Agent:medium]

**Required context**

1. [phase-3.md](./phase-3.md) — MVP scope checks
2. Tests for chat/workspace send pipeline and transcript components
3. Tasks 1–5 outputs
4. M1.5 verification outputs and updated smoke checklist

- Add tests for:
  - workspace streaming delta rendering
  - tool-card lifecycle updates
  - permission modal decision paths
  - question modal reply paths
  - model-selection fallback when OpenCode config changes
  - idempotent handling of duplicate/out-of-order normalized events
- Run quality gate from `app/`: `npm test` and `npm run check`.
- Manual smoke checklist on real workspace folder and OpenCode-backed tool action.

**Acceptance checklist**

- Automated coverage locks MVP interaction flows for workspace OpenCode runtime.
- `npm test` / `npm run check` pass from `app/`.
- Milestone 2 output satisfies E3B UI/runtime prerequisites for HTTP cutover.

Dependencies: Tasks 2–5.

---

## Dependency graph

```text
Task 1 (re-verified) → Task 2 → Task 6
Task 2 → Task 3 → Task 4 → Task 6
Task 2 → Task 5 → Task 6
```

## Mapping to phase-3 task IDs

| Phase-3 ID | Execution plan task |
|------------|---------------------|
| P3-4 | Tasks 1, 2 |
| P3-5 | Tasks 3, 4 |
| P3-6 | Task 5 (partial) |
| P3-8 | Task 6 (partial) |

## Milestone 2 exit criteria

- [ ] Workspace prompts run via OpenCode stream in `ws-*` contexts.
- [ ] Tool execution appears as transcript cards with correct lifecycle states.
- [ ] Permission modal blocks and resolves via backend reply path.
- [ ] Question modal blocks and resolves via backend reply path.
- [ ] Model/agent selection in workspace reflects OpenCode configuration.
- [ ] `npm test` / `npm run check` pass.

**Execution order note:** Complete [execution-plan-m1-5.md](./execution-plan-m1-5.md), then continue this milestone from Task 2.

**Next:** [execution-plan-m3.md](./execution-plan-m3.md)
