# Phase 3.5 Milestone 15 Execution Plan — OpenCode session terminology (user-facing)

**Spec:** [phase-3.5.md](./phase-3.5.md)  
**Index:** [execution-plan.md](./execution-plan.md)  
**Prerequisite:** none (optional follow-up to [execution-plan-m12.md](./execution-plan-m12.md) docs work)  
**Follow-up:** [execution-plan-m16.md](./execution-plan-m16.md) (internal rename — out of scope here)

**Status:** complete

**Goal:** align workspace UX copy with OpenCode Desktop wording:

- **Session** — a workspace conversation (sidebar row, tab, transcript, lifecycle actions).
- **Agent** — an OpenCode **persona/config** only (Settings → Agents, composer persona picker, `@agent:` mentions, Default agent).

The `chat-http` lane keeps **Chat** terminology (M13 beta surface). Internal identifiers (`agentId`, `AgentsSidebar`, disk paths) are unchanged — see M16.

How to use this plan: each task lists **Required context**. Cross-cutting **Decisions applied** below is authoritative for copy choices.

---

## Problem

Users see **Agents** in the sidebar and **Session** in the chat header for the same object. SpecOps also overloads **agent** for OpenCode personas (`build`, `plan`, custom agents). That matches implementation layers but not OpenCode's user-facing model, where a **session** is the conversation and an **agent** is the selected persona.

## Scope

### In scope

| Area | Change |
| --- | --- |
| Agents sidebar | Title **Sessions**; **New session**; search/delete/rename copy; **All sessions…** button |
| Tab bar | Conversation tab tooltip **Session** (parallel to chat-http **Chat**) |
| Chat panel | Aria labels, delete confirm, empty hint, fallback title **Session** |
| Composer | Placeholder **Message session**; empty hint distinguishes session vs persona **agent** |
| Toasts / prompts | Session-only wording in handlers (rename, fork, share, open external, …) |
| Blocked / access copy | OpenCode disabled + ready messages use **sessions** |
| Notifications | OS notification bodies: **Session finished**, **Session error**, etc. |
| Appearance | Event label **Session finished** |
| OpenCode settings | **Use OpenCode for workspace sessions** (+ helper text) |
| Ancillary UI | Todo panel aria-label, fork tooltip, MCP blurb |
| Docs | `docs/opencode-integration.md` terminology section |
| Tests | Assertions on user-visible strings (`New session`, etc.) |

### Out of scope (M16)

| Area | Reason |
| --- | --- |
| `agentId`, `AgentIndexEntry`, component/file names | Internal rename milestone |
| `chat/{hash}/agents/` disk layout | Breaking persistence change |
| Settings **Agents** tab / persona editor | Correctly keeps **Agent** |
| Composer persona picker / `@agent:` tokens | OpenCode wire format |
| `SessionState` (window tabs in `session.json`) | Unrelated concept; no rename |

## Decisions applied

| ID | Decision | Implication |
| --- | --- | --- |
| T1 | Sidebar title **Sessions** | `+page.svelte` passes `sidebarTitle: "Sessions"` for workspace |
| T2 | Extra list button → **All sessions…** | Avoid duplicate **Sessions** label; tooltip explains full OpenCode inventory |
| T3 | Tab tooltip **Session** | `TabBar.svelte` workspace branch (not **Session chat**) |
| T4 | Notifications use **session** | `osNotifications.ts` + Appearance **Session finished** |
| T5 | OpenCode toggle **workspace sessions** | `OpenCodeSettingsPanel.svelte` + `chatErrorCopy.ts` recovery lines |
| T6 | Copy-only pass | No TypeScript symbol / path renames in M15 |
| T7 | Toasts session-only | e.g. **Session renamed.**, **This session isn't linked to OpenCode yet.** |
| T8 | Draft title **New session** | `DRAFT_AGENT_TITLE` string value only (constant id unchanged until M16) |

## Agent Level Legend

- `easy`: string / aria / tooltip edits.
- `medium`: cross-file copy sweep + test updates.

## Changelog Instructions

- When a task is completed, mark it `[DONE]` in this file.
- Add changes to the top of `specs/changelog.md` with date/time.

---

## Task Breakdown

#### Task 1: Sidebar & session browser (M15-T1) [DONE] [Score:4] [Agent:easy]

**Required context:** `AgentsSidebar.svelte`, `+page.svelte`, `chatAgents.ts`

- Sidebar default / wired title: **Sessions** (workspace); **Chats** unchanged for `chat-http`.
- Plural/singular labels: **sessions** / **session** (search, empty state, context menu rename/delete).
- **New session** draft title (`DRAFT_AGENT_TITLE` value → `"New session"`).
- Header button label **All sessions…** (was **Sessions**); keep tooltip about browsing every OpenCode session for the workspace.

**Acceptance:** Sidebar reads **Sessions**; button no longer duplicates the panel title.

---

#### Task 2: Tab bar & chat panel chrome (M15-T2) [DONE] [Score:4] [Agent:easy]

**Required context:** `TabBar.svelte`, `ChatPanel.svelte`

- Tab tooltip for workspace conversation tabs: **Session**.
- Chat panel `aria-label`: **Session chat** (was **Agent chat**).
- Delete button / confirm: **session** (workspace); **chat** unchanged for `chat-http`.
- Fallback header title when no active id: **Session**.

**Acceptance:** No user-visible **Agent chat** / **Delete agent** in workspace chrome.

---

#### Task 3: Composer & onboarding copy (M15-T3) [DONE] [Score:4] [Agent:easy]

**Required context:** `ChatComposer.svelte`, `ChatPanel.svelte` empty hint

- Textarea aria/placeholder: **Message session**.
- Empty hint: prompt to **this session**; second **agent** refers to OpenCode **persona** picker only.

**Acceptance:** Composer distinguishes session (conversation) vs agent (persona).

---

#### Task 4: Session lifecycle toasts & prompts (M15-T4) [DONE] [Score:5] [Agent:easy]

**Required context:** `appShellAgentHandlers.ts`, `ChatMessageList.svelte`

- Rename prompt title: **Rename session**.
- Toasts: **Session renamed.**; **This session isn't linked to OpenCode yet.**; **Forked into a new session tab.**; **Opened session in a new tab.**; etc.
- Per-message fork tooltip: **new session tab** (not agent tab).

**Acceptance:** Handler notifications avoid mixed agent/session phrasing.

---

#### Task 5: Blocked, access & catalog hints (M15-T5) [DONE] [Score:4] [Agent:easy]

**Required context:** `chatErrorCopy.ts`, `access.ts`, `bootstrap.ts`, `McpManagementPanel.svelte`

- OpenCode disabled / recovery strings use **workspace sessions**.
- Access ready: **OpenCode workspace session is ready.**
- Model catalog recovery: **workspace session composer** (or equivalent).
- MCP panel: **workspace sessions** where applicable.

**Acceptance:** Error/blocked surfaces match sidebar terminology.

---

#### Task 6: Notifications & appearance (M15-T6) [DONE] [Score:3] [Agent:easy]

**Required context:** `osNotifications.ts`, `AppearancePanel.svelte`

- OS copy: **Session finished**, **The session completed its run.**, permission/question bodies use **session**, **Session error**.
- Appearance event label: **Session finished** (`agentDone` id unchanged until M16).

**Acceptance:** Notification settings preview matches new wording.

---

#### Task 7: OpenCode settings panel (M15-T7) [DONE] [Score:3] [Agent:easy]

**Required context:** `OpenCodeSettingsPanel.svelte`

- Toggle label/tooltip: **Use OpenCode for workspace sessions**.
- Disabled helper: folders open without **sessions**; enable to use workspace sessions.

**Acceptance:** Settings master toggle no longer says **workspace agents**.

---

#### Task 8: Documentation (M15-T8) [DONE] [Score:4] [Agent:easy]

**Required context:** `docs/opencode-integration.md`

- Add **User-facing terminology** section: Session vs Agent vs window `SessionState`.
- Update setup steps and relationship model to prefer **session** for conversations.
- Link from `docs/providers.md` if needed (already points at integration doc).

**Acceptance:** Docs teach the same vocabulary as the UI.

---

#### Task 9: Tests (M15-T9) [DONE] [Score:4] [Agent:easy]

**Required context:** `chatAgents.test.ts`, `chatPersistence.test.ts`, `chatM5-2.validation.test.ts`

- Update assertions expecting **New agent** → **New session** where user-visible.
- Leave internal test describe names optional; prefer updating string expectations.

**Acceptance:** `npm test` passes for touched suites.

---

## Exit criteria

- [x] Workspace UI uses **Session(s)** for conversations (sidebar, tab, panel, toasts).
- [x] **Agent** remains for OpenCode personas (Settings → Agents, composer picker, mentions).
- [x] **All sessions…** button distinguishes full inventory from sidebar list.
- [x] `chat-http` **Chat** wording unchanged.
- [x] No internal symbol/path renames (M16 scope).
- [x] `docs/opencode-integration.md` documents terminology.
- [x] Unit tests updated for draft title and related copy.

## Milestone status

**M15 complete** — user-facing OpenCode session terminology applied; internal rename deferred to M16.
