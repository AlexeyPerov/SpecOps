# SpecOps AI roadmap — clarification questionnaire (historical)

> **Superseded.** Authoritative docs: **[roadmap.md](./roadmap.md)** (index + decisions) and **[phase-1.md](./phase-1/phase-1.md)** … **[phase-7.md](./phase-7/phase-7.md)** (execution).  
> Former `migration-plan.md` is now **[phase-6.md](./phase-6/phase-6.md)** (optional own platform).  
> This file preserves the original questionnaire and answers as **history only** (2026-06-03). Do not update for new work.

---

## How to use (archive)

This document is frozen. For implementation, follow [phase-1.md](./phase-1/phase-1.md) and later phase docs.

---

## Section A — Context model & activity rail

### A1. Fixed chat context IDs

How should the two new chat contexts be named in `ContextId`?


|       | Option                                      |
| ----- | ------------------------------------------- |
| **A** | `"chat-http"` and `"chat-cloud"` (explicit) |
| **B** | `"chat"` and `"cloud"` (short)              |
| **C** | `"ai-chat"` and `"ai-cloud"`                |
| **D** | Other: _____________                        |


**Recommended: A** — clear in code and persistence paths.

**Answer: A**

**Notes:**

---

### A2. Activity rail placement

Where do Chat and Cloud buttons sit?


|       | Option                                                                |
| ----- | --------------------------------------------------------------------- |
| **A** | Notepad → Chat → Cloud → separator → workspaces → **+**               |
| **B** | Notepad → separator → Chat → Cloud → workspaces → **+**               |
| **C** | Group Chat+Cloud under a single “AI” menu on the rail                 |
| **D** | Other: Notepad → separator → Chat → Cursor Cloud → workspaces → **+** |


**Recommended: A** — three fixed “modes” at top, then folder workspaces.

**Pros / cons (A vs C)**


|       | Pros                                               | Cons                                                  |
| ----- | -------------------------------------------------- | ----------------------------------------------------- |
| **A** | One click per mode; matches “separate mode” vision | Rail gets taller/busier                               |
| **C** | Fewer rail buttons                                 | Extra click; hides distinction between HTTP and cloud |


**Answer: D. Also** Chat, Cursor Cloud should be not visible until user completed related setup

**Notes:**

---

### A3. Chat context: file tabs allowed?

Can users open **file tabs** in Chat / Cloud contexts (like notepad), or **chat-only**?


|       | Option                                                         |
| ----- | -------------------------------------------------------------- |
| **A** | Chat-only — no file editor tabs in Chat/Cloud contexts         |
| **B** | Optional file tabs (notepad-like) but no link to agent context |
| **C** | File tabs + future “attach file to message”                    |
| **D** | Other: _____________                                           |


**Recommended: A** for tier 1 — simpler; avoids “agent should see this buffer” confusion.

**Pros / cons (A vs B)**


|       | Pros                   | Cons                                                                                   |
| ----- | ---------------------- | -------------------------------------------------------------------------------------- |
| **A** | Clear product boundary | Users cannot peek at a local file while in Chat without switching to Notepad/Workspace |
| **B** | Familiar tab bar       | Blurs “WebUI chat” vs editor; more persistence rules                                   |


**Answer: A**

**Notes:**

---

### A4. Window session persistence for new contexts

How are Chat and Cloud snapshots stored in `session.json`?


|       | Option                                                          |
| ----- | --------------------------------------------------------------- |
| **A** | Two new top-level fields on window state (mirror `notepad`)     |
| **B** | Single `chatContexts: Record<ContextId, ContextSnapshot>` map   |
| **C** | Defer persistence until phase 2; in-memory only for first slice |
| **D** | Other: _____________                                            |


**Recommended: A or B** — **B** scales if more fixed contexts appear later.

**Answer: A**

**Notes:**

---

## Section B — Phase 1 (preparation)

### B1. GLM handling in phase 1


|       | Option                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Generalize to OpenAI-compatible provider **first**, then remove `glm` id and GLM UI (revise [glm-removal-plan.md](./glm-removal-plan.md)) |
| **B** | Full GLM deletion per current glm-removal-plan; re-add HTTP provider from scratch                                                         |
| **C** | Keep `glm` id as alias for one default connection preset only                                                                             |
| **D** | Other: _____________                                                                                                                      |


**Recommended: A** — preserves tests and chat stack; vendor-neutral naming.

**Answer:** `A`

**Notes:**

---

### B2. Workspace HTTP chat during phases 2–3

Before phase 4, should **workspace** agent tabs still use HTTP completions?


|       | Option                                                          |
| ----- | --------------------------------------------------------------- |
| **A** | Yes — keep workspace HTTP until phase 4 removes it              |
| **B** | No — remove workspace HTTP in phase 1; only Debug until phase 4 |
| **C** | Hide workspace agents until phase 4; only Chat context has AI   |
| **D** | Other: _____________                                            |


**Recommended: A** — avoids an AI gap in workspaces during long phase 4 work.

**Pros / cons (A vs C)**


|       | Pros                                  | Cons                                    |
| ----- | ------------------------------------- | --------------------------------------- |
| **A** | Workspace users keep current behavior | Two places with HTTP chat until phase 4 |
| **C** | Single HTTP entry (Chat context)      | Workspace feels broken for months       |


**Answer:** `A`

**Notes:** Aligns with phased OpenCode cutover (phase 4).

---

### B3. HTTP streaming in phase 1 vs 2


|       | Option                                                        |
| ----- | ------------------------------------------------------------- |
| **A** | Implement SSE streaming in phase 1 (adapter + UI path)        |
| **B** | Buffered send in phase 1; streaming required for phase 2 exit |
| **C** | Streaming optional through phase 3                            |
| **D** | Other: _____________                                          |


**Recommended: B** — tier 1 UX expects streaming by end of phase 2, not necessarily in prep.

**Answer: B**

**Notes:**

---

### B4. Foundation interface naming

Introduce a workspace agent abstraction in phase 1?


|       | Option                                                   |
| ----- | -------------------------------------------------------- |
| **A** | `WorkspaceAgentBackend` with stubs; OpenCode in phase 4  |
| **B** | Only `ChatProvider` until phase 4; refactor then         |
| **C** | Unified `AgentBackend` for chat + workspace from day one |
| **D** | Other: _____________                                     |


**Recommended: A** — small sketch avoids rework at phase 4/5.

**Pros / cons (A vs C)**


|       | Pros                                    | Cons                                                     |
| ----- | --------------------------------------- | -------------------------------------------------------- |
| **A** | Separates HTTP chat from agent runtimes | Two interfaces to maintain                               |
| **C** | One mental model                        | HTTP chat and OpenCode events are awkward to unify early |


**Answer:** `A`

**Notes:** SpecOps UI targets `@opencode-ai/sdk` client to OpenCode server via this abstraction.

---

### B5. Settings: connections model (phase 1)


|       | Option                                                                           |
| ----- | -------------------------------------------------------------------------------- |
| **A** | Single default connection (today’s GLM fields → generic base URL + key + models) |
| **B** | Multiple named connections (Open WebUI–style) in phase 1                         |
| **C** | Single connection in P1; multi-connection in phase 6 tier 2                      |
| **D** | Other: _____________                                                             |


**Recommended: C** (or **A** if you want minimum schema churn) — multi-connection is tier 2 scope.

**Answer: C**

**Notes:**

---

## Section C — Phase 2 (Chat / WebUI tier 1)

### C1. Chat context: agent naming in UI


|       | Option                                        |
| ----- | --------------------------------------------- |
| **A** | Keep “Agents” sidebar label (reuse component) |
| **B** | Rename to “Chats” in Chat/Cloud contexts only |
| **C** | User-configurable label                       |
| **D** | Other: _____________                          |


**Recommended: B** in Chat/Cloud — clearer for non-coding users.

**Answer: B**

**Notes:**

---

### C2. Modes in Chat context


|       | Option                                                                               |
| ----- | ------------------------------------------------------------------------------------ |
| **A** | **ask** only                                                                         |
| **B** | **ask** + **review** (review without workspace file reads — text-only review prompt) |
| **C** | Same modes as workspace today                                                        |
| **D** | Other: _____________                                                                 |


**Recommended: A** for tier 1.

**Answer: A**

**Notes:**

---

### C3. Debug provider in Chat context


|       | Option                                            |
| ----- | ------------------------------------------------- |
| **A** | Debug selectable in Chat when enabled in settings |
| **B** | Debug dev-only; hidden in production builds       |
| **C** | Debug only in workspace, not Chat context         |
| **D** | Other: _____________                              |


**Recommended: A** — keeps tests and offline dev without workspace.

**Answer: A**

**Notes:**

---

## Section D — Phase 3 (Cloud / Cursor cloud)

### D1. Repo configuration per chat vs global


|       | Option                                                      |
| ----- | ----------------------------------------------------------- |
| **A** | Each chat/agent stores `repoUrl` + `ref` in thread metadata |
| **B** | Global default repo in settings; per-chat override optional |
| **C** | Global only for MVP                                         |
| **D** | Other: _____________                                        |


**Recommended: B** — fewer repetitive prompts; per-chat override for power users.

**Answer: A**

**Notes:**

---

### D2. Cloud context: show tool calls in transcript?


|       | Option                                          |
| ----- | ----------------------------------------------- |
| **A** | Text assistant messages only (MVP)              |
| **B** | Tool start/end cards like OpenCode workspace UI |
| **C** | Collapsible tool detail                         |
| **D** | Other: _____________                            |


**Recommended: A** for MVP; **B** when event mapper is shared with phase 4.

**Answer: C**

**Notes:**

---

### D3. Relationship between Chat (HTTP) and Cloud contexts


|       | Option                                             |
| ----- | -------------------------------------------------- |
| **A** | Completely separate chat lists and persistence     |
| **B** | “Move chat to cloud” / link thread across contexts |
| **C** | Single list with per-thread backend type           |
| **D** | Other: _____________                               |


**Recommended: A** — simplest; different runtimes.

**Answer: A**

**Notes:**

---

## Section E — Phase 4 (OpenCode workspace)

### E1. OpenCode server deployment


|       | Option                                                            |
| ----- | ----------------------------------------------------------------- |
| **A** | Tauri spawns sidecar (`opencode serve` / SDK helper) on localhost |
| **B** | User must start server; SpecOps only connects to URL              |
| **C** | A with fallback to B in settings                                  |
| **D** | Other: _____________                                              |


**Recommended: C** — best DX; power users self-host.

**Pros / cons (A vs B)**


|       | Pros                 | Cons                                      |
| ----- | -------------------- | ----------------------------------------- |
| **A** | Works out of the box | Package `opencode` binary; port conflicts |
| **B** | Simple app bundle    | Friction for casual users                 |


**Answer:** `C`

**Notes:** SpecOps = alternative UI for OpenCode harness: `@opencode-ai/sdk` client; default local server (sidecar per workspace directory); Settings → optional server URL + auth to attach to existing `opencode serve`. Provider/API keys live in OpenCode config, not SpecOps GLM.

---

### E2. Legacy workspace chat JSON after phase 4


|       | Option                                                      |
| ----- | ----------------------------------------------------------- |
| **A** | Break — workspace threads not migrated to OpenCode sessions |
| **B** | One-time import best-effort (user messages only)            |
| **C** | Keep read-only archive of old threads in UI                 |
| **D** | Other: _____________                                        |


**Recommended: A** per `AGENTS.md` policy — document in changelog.

**Answer:** `A`

**Notes:**

---

### E3. Phase 4 MVP scope (OpenCode)

What is required before removing workspace HTTP?


|       | Option                                   |
| ----- | ---------------------------------------- |
| **A** | Prompt stream + text only (no tools UI)  |
| **B** | Stream + tool cards + permission replies |
| **C** | Full migration-plan S1–S6 parity         |
| **D** | Other: _____________                     |


**Recommended: B** — agents without permissions are fragile on real repos.

**Pros / cons (A vs B)**


|       | Pros                | Cons                                   |
| ----- | ------------------- | -------------------------------------- |
| **A** | Faster cutover      | Agent hits permission walls with no UI |
| **B** | Usable coding agent | Longer phase 4                         |


**Answer:** `B`

**Notes:** Minimum credible “OpenCode UI” before dropping workspace HTTP chat.

---

## Section F — Phase 5 (Cursor local ↔ OpenCode)

### F1. Switch granularity


|       | Option                                        |
| ----- | --------------------------------------------- |
| **A** | Per workspace (persisted on `WorkspaceEntry`) |
| **B** | Global app setting                            |
| **C** | Per agent tab                                 |
| **D** | Per message (composer toggle)                 |


**Recommended: A** — matches “this project uses Cursor vs OpenCode.”

**Answer:** `A`

**Notes:**

---

### F2. When backends differ (plan mode, MCP, tools)


|       | Option                                             |
| ----- | -------------------------------------------------- |
| **A** | Show capability badge; disable unsupported actions |
| **B** | Hide UI for unsupported features                   |
| **C** | Document only; no UI guard                         |
| **D** | Other: _____________                               |


**Recommended: A** — honest UX.

**Answer:** `A`

**Notes:**

---

### F3. Default backend for new workspaces


|       | Option                      |
| ----- | --------------------------- |
| **A** | OpenCode                    |
| **B** | Cursor local                |
| **C** | Ask on first agent use      |
| **D** | Remember last used globally |


**Recommended: A** — phase 4 establishes OpenCode as primary.

**Answer:** `A`

**Notes:**

---

## Section G — Phase 6+ (optional)

### G1. Open WebUI tier 2 priority (when optional)


|       | Option                               |
| ----- | ------------------------------------ |
| **A** | Multi-connection settings            |
| **B** | Regenerate / edit messages           |
| **C** | Per-chat system prompt               |
| **D** | All of the above in one milestone    |
| **E** | Defer until after phase 5 stabilizes |


**Recommended: E**, then **A → B → C**.

**Answer: E**

**Notes:**

---

### G2. Own OpenCode-like platform ([migration-plan.md](./migration-plan.md))


|       | Option                                                              |
| ----- | ------------------------------------------------------------------- |
| **A** | Start only after phase 5 ships                                      |
| **B** | Parallel repo extraction during phase 4 (two teams / long timeline) |
| **C** | Only if OpenCode dependency blocks shipping                         |
| **D** | Cancel — stay on OpenCode + Cursor indefinitely                     |


**Recommended: C or A** — avoid parallel build unless necessary.

**Pros / cons (B vs C)**


|       | Pros                         | Cons                                   |
| ----- | ---------------------------- | -------------------------------------- |
| **B** | Eventual independence sooner | Splits focus; SpecOps integration lags |
| **C** | Ships product faster         | Dependency risk on OpenCode            |


**Answer: A**

**Notes:**

---

## Section H — Cross-cutting

### H1. Update [glm-removal-plan.md](./glm-removal-plan.md)


|       | Option                                                     |
| ----- | ---------------------------------------------------------- |
| **A** | Rewrite as “HTTP chat generalization” aligned with phase 1 |
| **B** | Archive; tasks live only in roadmap phase 1                |
| **C** | Keep as-is (full delete)                                   |
| **D** | Other: _____________                                       |


**Recommended: A** when you confirm **B1A**.

**Answer:** `A`

**Notes:** Follows locked **B1A**.

---

### H2. `cursor` placeholder in `ChatProviderId`


|       | Option                                                    |
| ----- | --------------------------------------------------------- |
| **A** | Remove from HTTP chat types; Cursor only via SDK adapters |
| **B** | Keep for future HTTP Cursor API (unlikely)                |
| **C** | Repurpose id for cloud adapter registry key               |
| **D** | Other: _____________                                      |


**Recommended: A** — Cursor is SDK-only in this roadmap.

**Answer:**

**Notes:**

---

### H3. Multi-window behavior for Chat/Cloud contexts


|       | Option                                                      |
| ----- | ----------------------------------------------------------- |
| **A** | Each window has its own Chat/Cloud snapshots (like notepad) |
| **B** | Shared chat state across windows                            |
| **C** | Chat/Cloud only in main window                              |
| **D** | Other: _____________                                        |


**Recommended: A** — consistent with existing window/session model.

**Answer:**

**Notes:**

---

## Quick reference (final answers snapshot)

```text
A1: A   A2: D (+ gating)   A3: A   A4: A
B1: A   B2: A   B3: B   B4: A   B5: C
C1: B   C2: A   C3: A
D1: A   D2: C   D3: A
E1: C   E2: A   E3: B
F1: A   F2: A   F3: A
G1: E   G2: A
H1: A   H2: (open)   H3: (open)
```

Locked in [roadmap.md](./roadmap.md): H2A, H3A (recommended defaults applied 2026-06-04).

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-04 | Marked historical; point to roadmap + phase-1..5 |
| 2026-06-03 | Inline Answer/Notes; questionnaire completed |
| 2026-06-03 | Initial questionnaire |
