# AI Chat — Milestone 2 Execution Plan (Conversation model and storage)

How to use this plan: each task lists **Required context** — read only those docs for that task. Behavior and scope come from `specs/ai-requirements.md` (source of truth).

**Status:** Delivered (one thread per workspace). **Superseded by M5.2** for multi-agent persistence (`specs/ai-m-5-2-execution-plan.md`, task M5-2-1).

## Assumptions

- Milestone 1 is complete (`specs/ai-m-1-execution-plan.md`).
- One thread per workspace for MVP.
- Chat history is stored outside `session.json` in separate per-workspace files.
- No provider integration yet — messages can be user-only stubs or mock assistant entries for persistence tests.

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Workspace path normalization exists (`normalizePathSync`, `diskFingerprint.ts`).
2. App data dir helper exists (`ensureSpecOpsDataDir`).

Residual uncertainties:

1. Exact on-disk JSON schema for chat file — define versioned codec in this milestone.
2. Thread creation timing: create metadata file on first message, not on workspace add.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog entry.

## Milestone exit criteria (from requirements)

- Workspace switch restores workspace-specific conversation.
- Restart preserves chat and metadata per workspace.

---

## Task breakdown

#### Task M2-1: Chat domain types and contracts [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/ai-requirements.md` (Workspace scoping, Modes, Providers)
2. `app/src/lib/domain/contracts.ts`

- Add types:
  - `ChatMessageRole` (`user` | `assistant` | `system`)
  - `ChatMessage`
  - `ChatModeId` (`ask` | `review`)
  - `ChatProviderId` (`glm` | `cursor` — used later; default stub ok)
  - `ChatThreadMetadata` (mode, provider, created/updated timestamps, optional summary)
  - `ChatThreadSnapshot` (metadata + messages[])
  - `ChatThreadFileSnapshot` (versioned on-disk envelope)
- Document one-thread-per-workspace invariant in type comments.

**Acceptance checklist**

- Types compile and export cleanly from domain layer.
- Message/system event shape supports future provider-switch markers.

Dependencies: M1 complete.

---

#### Task M2-2: Workspace chat path and codec [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/ai-requirements.md` (Persistence and retention)
2. `app/src/lib/services/diskFingerprint.ts`
3. `app/src/lib/services/settingsStore.ts` (JSON persistence pattern)

- Create `app/src/lib/services/chatPersistence.ts`:
  - `getWorkspaceChatFilePath(normalizedRootPath): Promise<string>`
  - hash key from normalized workspace path
  - store under app data dir (e.g. `chat/<hash>.json`)
- Implement versioned read/write codec with safe defaults for missing/corrupt files.
- Add debounced persist helper (pattern from `sessionManager.ts`).

**Acceptance checklist**

- Round-trip unit test for thread snapshot encode/decode.
- Corrupt file returns empty thread without crash.
- Two different workspace paths map to distinct files.

Dependencies: M2-1.

---

#### Task M2-3: In-memory chat store [Score:7] [Agent:heavy] [DONE]

**Required context**

1. `specs/ai-requirements.md`
2. `app/src/lib/state/appState.ts` (store patterns)

- Create `app/src/lib/state/chatStore.ts` (or service + writable store):
  - active workspace thread in memory
  - load thread by workspace root path
  - append message
  - update thread metadata (mode/provider placeholders)
  - create thread lazily on first user message
- Expose selectors for UI: messages, metadata, hasThread, isEmpty.
- Do not call providers.

**Acceptance checklist**

- Unit tests: lazy thread creation, append message, metadata update.
- Switching workspace key in store swaps active thread state.

Dependencies: M2-2.

---

#### Task M2-4: Workspace switch and restart restore [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/ai-requirements.md`
2. `app/src/routes/+page.svelte`
3. `app/src/lib/services/sessionManager.ts`

- On active workspace change, load that workspace chat file into store.
- On workspace with no file, show empty state (no thread object persisted yet).
- On app restart + workspace restore from session, reload corresponding chat file.
- Ensure Notepad context clears/unloads chat store binding.

**Acceptance checklist**

- Workspace A/B have isolated histories after switching.
- Quit/relaunch restores each workspace chat independently.
- Notepad mode does not display prior workspace messages.

Dependencies: M2-3.

---

#### Task M2-5: ChatPanel conversation UI (pre-provider) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/ai-requirements.md`
2. `app/src/lib/components/ConsolePanel.svelte`
3. Milestone 1 Chat placeholder

- Replace placeholder with message list + composer UI.
- Render roles (user/assistant/system) with distinct styling.
- Empty state: "Start chat" until first message.
- Composer submits user message locally (append to store + persist).
- Assistant responses remain unavailable/disabled until provider milestones.

**Acceptance checklist**

- User can type/send messages in workspace Chat tab.
- Messages persist across workspace switch and app restart.
- Empty state shown for workspace with no prior chat.

Dependencies: M2-4.

---

#### Task M2-6: Milestone validation [Score:3] [Agent:easy] [DONE]

**Required context**

1. `specs/ai-requirements.md`
2. `specs/archive/unit-tests.md`

- Add/extend tests for codec + store + workspace isolation.
- Run `npm test`, `npm run check`.
- Manual smoke checklist documented in changelog/spec note.

**Acceptance checklist**

- All M2 unit tests pass.
- Manual smoke confirms M2 exit criteria.

Dependencies: M2-5.

---

## Task dependency graph

```
M2-1 → M2-2 → M2-3 → M2-4 → M2-5 → M2-6
```

## Testing map

| Task | Primary tests |
|---|---|
| M2-2 | `chatPersistence.test.ts` |
| M2-3 | `chatStore.test.ts` |
| M2-4 | store + persistence integration tests |
| M2-6 | full suite + manual smoke |
