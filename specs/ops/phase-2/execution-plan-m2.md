# Phase 2 Milestone 2 Execution Plan — Chat shell, modes, debug

**Spec:** [phase-2.md](./phase-2.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m1.md](./execution-plan-m1.md) complete

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Assumptions

- Milestone 1 is complete: `chat-http` context switch, session persistence, rail gating, and `chatStore` scope by context id.
- Chat context uses **chat shell only** — no project panel, no file editor tabs, no workspace preflight (A3A).
- Sidebar title is **Chats** (C1B), not Agents.
- **ask** mode only in `chat-http` (C2A); no workspace **review** file reads.
- Debug provider available in Chat when enabled in settings (C3A).
- Workspace contexts (`ws-*`) retain existing Agents sidebar, ask/review modes, and HTTP chat (B2A) until phase 4.
- Buffered HTTP send (`stream: false`) remains acceptable in workspace; streaming is Milestone 3.
- Notepad has no AI entry points (unchanged).

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. UI components to reuse are listed in [phase-2.md](./phase-2.md) — `ChatPanel`, `ChatComposer`, chats sidebar pattern from `AgentsSidebar`.
2. Mode list comes from `listModesForProvider` in `app/src/lib/ai/modes/builtins.ts`; restriction is context-level, not provider-level.
3. `+page.svelte` already branches layout on `activeWorkspaceRoot`; `chat-http` has `null` workspace root — natural hook for chat-only layout.

Residual uncertainties:

1. Whether to parameterize `AgentsSidebar` vs extract `ChatsSidebar` — prefer minimal prop (`sidebarTitle`, `contextKind`) over duplicate component unless styling diverges heavily.
2. Agent tabs in `chat-http` may still use `SessionState.openTabs` with `kind: "agent"` only; ensure no file-tab creation paths run in chat context.
3. Debug visibility in composer provider picker may need context filter separate from workspace provider policy.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 1: Chat-only page layout (P2-4) [Score:8] [Agent:medium] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — UI shell deliverables
2. `app/src/routes/+page.svelte` — `showProjectPanel`, `showAgentsSidebar`, editor pane branches
3. `app/src/lib/state/appState/contextHelpers.ts` — `CHAT_HTTP_CONTEXT_ID` usage from M1

- Add `isChatHttpActive` derived flag (`activeContextId === "chat-http"`).
- When chat-http active:
  - Hide project panel and `ProjectTreeView` (no workspace preflight).
  - Hide file editor panes (`EditorPane`, diff/image/binary previews).
  - Show chat shell: chats sidebar + agent tabs + `ChatPanel` (reuse workspace agent-tab path).
- Ensure responsive layout rules do not force project/agents panel state for chat-http.
- Skip `loadProjectTreeRoot`, `ensureWorkspaceReadAccess`, `restoreWorkspaceAgentSession` effects when chat-http active.
- No new file editor tabs in chat-http context (A3A): guard tab-create commands / `openTabs` mutations.

**Acceptance checklist**

- Selecting Chat context shows sidebar + chat panel only; no project tree or file editor.
- Notepad and workspace layouts unchanged.
- No file tabs can be created while in `chat-http`.

Dependencies: Milestone 1 complete.

---

#### Task 2: Chats sidebar and agent tabs (P2-4, C1) [Score:7] [Agent:medium] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — Label sidebar **Chats**; reuse chats sidebar
2. `app/src/lib/components/AgentsSidebar.svelte`
3. `app/src/routes/+page.svelte` — agent tab rendering, `TabBar` usage
4. `app/src/lib/services/workspaceAgentSession.ts` — agent tab session restore (workspace)

- Add `sidebarTitle` prop to `AgentsSidebar` (default `"Agents"` for workspace); pass `"Chats"` when `chat-http` active.
- Wire chat-http sidebar to `chatStore` scope `chat-http` (from M1): agent list, new agent, select, delete.
- Agent tab bar in chat-http: agent tabs only; no file tabs; `ChatPanel` shown for selected agent tab.
- Initialize chat-http session with agent tab if empty (mirror workspace agent-first pattern without documents).
- Update aria labels/tooltips from "Agents" to "Chats" in chat context only.

**Acceptance checklist**

- Sidebar header reads **Chats** in `chat-http`; still **Agents** in workspace.
- User can create/select/delete chats (agents) in chat-http context.
- Agent tabs work; selecting tab shows `ChatPanel` with correct thread.

Dependencies: Task 1.

---

#### Task 3: Ask-only mode enforcement (C2) [Score:6] [Agent:medium] [DONE]

**Required context**

1. [phase-2.md](./phase-2.md) — ask mode only; no review file reads
2. `app/src/lib/components/ChatComposer.svelte` — mode toolbar
3. `app/src/lib/ai/modes/builtins.ts` — `listModesForProvider`
4. `app/src/lib/ai/sendChatMessage.ts` — mode in provider request

- Pass `chatContextKind: "workspace" | "chat-http"` (or `activeContextId`) into `ChatComposer` / send pipeline.
- In `chat-http`: hide or disable review mode UI; only **ask** selectable.
- On thread create/default metadata in chat-http scope, set `mode: "ask"`.
- If persisted thread has `mode: "review"`, normalize to `ask` on load in chat-http scope.
- Ensure send path does not attach workspace file context for chat-http (no `canReadWorkspaceFiles` usage).

**Acceptance checklist**

- Chat context composer shows ask mode only; review option absent or disabled.
- New and restored chat-http threads use `ask` mode.
- Workspace contexts still offer ask + review per provider capabilities.

Dependencies: Task 2.

---

#### Task 4: Debug provider in Chat context (C3) [Score:5] [Agent:medium]

**Required context**

1. [phase-2.md](./phase-2.md) — Debug available when enabled in settings
2. `app/src/lib/ai/providers/selection.ts`, `debugProviderSettings.ts`
3. `app/src/lib/components/ChatComposer.svelte` — provider picker
4. `app/src/lib/components/ChatBlockedState.svelte`

- In `chat-http`, provider picker includes **Debug** when `providerSettings.debug.enabled === true`; HTTP when configured (same as workspace product ids).
- Default provider selection in chat-http: HTTP when configured; else Debug if enabled (mirror phase-1 policy).
- Blocked states in chat-http point to Connections (HTTP) or Debug settings as appropriate.
- Debug send/stream works in chat-http scope (uses existing debug provider; no workspace file reads).

**Acceptance checklist**

- With Debug enabled in settings, user can select Debug provider in Chat context and send messages (buffered).
- With HTTP configured, HTTP is default; Debug still selectable when enabled.
- Chat blocked copy does not reference workspace-only concepts.

Dependencies: Task 3.

---

#### Task 5: Cross-context regression guards (B2A, notepad) [Score:6] [Agent:medium]

**Required context**

1. [phase-2.md](./phase-2.md) — exit criteria: notepad unchanged, workspace HTTP chat works
2. `app/src/routes/+page.svelte`, notepad routes/components
3. Workspace chat validation tests: `chatM*.validation.test.ts`

- Verify notepad has no chat/AI entry points (grep + manual checklist).
- Verify workspace HTTP chat: Agents sidebar, ask/review modes, project panel, send with buffered HTTP unchanged.
- Add regression tests: context id passed to composer; workspace send still uses workspace scope key; chat-http uses `chat-http` scope key.
- Document any intentional differences in test file headers.

**Acceptance checklist**

- Notepad: no AI/chat UI additions.
- Workspace: HTTP chat send succeeds; review mode still available when provider supports it.
- Switching chat-http → workspace restores workspace chat state without data loss.

Dependencies: Task 4.

---

#### Task 6: Milestone 2 tests and verification (P2-7 partial) [Score:6] [Agent:medium]

**Required context**

1. [phase-2.md](./phase-2.md) — exit criteria (UI/mode subset)
2. Component and store tests from Tasks 1–5
3. [execution-plan-m1.md](./execution-plan-m1.md) — M1 test baseline

- Add tests for: chat-only layout flags; Chats sidebar title; ask-only mode filter; debug provider visibility in chat-http.
- Run `npm test` and `npm run check` from `app/`.
- Manual smoke: Connections setup → Chat rail → create chat → send (buffered) → switch to workspace → send still works.

**Acceptance checklist**

- Automated tests pass for M2 behaviors.
- `npm test` and `npm run check` pass from `app/`.
- Buffered send works end-to-end in chat-http (streaming deferred to M3).

Dependencies: Task 5.

---

## Dependency graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
```

Requires Milestone 1 complete before Task 1.

## Mapping to phase-2 task IDs

| Phase-2 ID | Execution plan task |
|------------|---------------------|
| P2-1 | Milestone 1 |
| P2-2 | Milestone 1 |
| P2-3 | Milestone 1 |
| P2-4 | Tasks 1, 2 |
| P2-5 | Milestone 3 |
| P2-6 | Tasks 2, 3, 4 |
| P2-7 | Tasks 5, 6 (partial); completed in Milestone 3 |

## Milestone 2 exit criteria

- [ ] Chat context shows chat-only shell (no project panel / file editor).
- [ ] Sidebar titled **Chats**; user can manage chat threads.
- [ ] Ask mode only in Chat; Debug available when enabled.
- [ ] Notepad unchanged; workspace HTTP chat still works (B2A).
- [ ] `npm test` / `npm run check` pass.

**Next:** [execution-plan-m3.md](./execution-plan-m3.md)
