# Phase 3.5 — Questions

Questions about scope, priority, and design decisions for phase 3.5. Each
question has numbered answer options with a **[Recommended]** marker.

**Status:** Decisions applied 2026-06-15 (Q8 and Q9 had pre-existing custom answers).

---

## Q1 — SDK migration timing

When should we migrate from the hand-rolled HTTP client to `@opencode-ai/sdk`?

1. **Before anything else** — install SDK first, build all new features on top
   of it. Prevents writing more raw-fetch code that'll be thrown away.
   **[Recommended]**
2. **Incrementally** — new features use the SDK; old endpoints migrate
   opportunistically. Less upfront work but two HTTP paths coexist.
3. **Last** — build all features with the current raw client, then migrate in
   one sweep at the end. Highest rework risk.
4. **Skip** — keep the raw client indefinitely. Lowest dependency risk but
   highest maintenance as OpenCode API evolves.

**Decision:** **1** — SDK migration is milestone **M0**; do M0-T1/T2 before M1/M2.

---

## Q2 — Message rendering: hydration strategy

How should we get structured message parts (reasoning, subtask, step, diff)?

1. **Dual: hydrate from `session.messages` on load + extend live stream
   normalization for new parts.** Load full history from the API when opening
   an agent tab; extend the SSE normalizer to emit new part types during live
   streaming. Most robust. **[Recommended]**
2. **Stream-only** — extend the SSE normalizer to carry all part types; rely
   on it for both live and restored sessions (re-stream from the start).
   Simpler but re-streaming history is fragile and slow.
3. **API-only** — always fetch `session.messages` and never trust the stream
   for parts; use the stream only as a "something changed" signal to re-fetch.
   Most accurate but chattier.

**Decision:** **1** — dual hydration + live stream normalization.

---

## Q3 — Local thread snapshot vs OpenCode as source of truth

Currently SpecOps stores its own thread JSON per agent. Should OpenCode
sessions become the source of truth?

1. **Yes — OpenCode is source of truth; local snapshot is cache only.**
     `session.messages` hydrates the UI; local JSON is an offline cache /
     fallback. Cleaner, avoids drift. **[Recommended]**
2. **No — keep local snapshot as source of truth; OpenCode is ephemeral.**
     Continue current model; don't call `session.messages`. Simpler but
     reasoning/subtask/diff parts are lost on reload.
3. **Hybrid — local for text + tools, OpenCode for rich parts.** Only fetch
     `session.messages` for part types not in the local snapshot. Complex
     merge logic.

**Decision:** **1** — OpenCode is source of truth; local snapshot is cache/fallback.

---

## Q4 — Markdown rendering

Should workspace agent messages render as markdown (like OpenCode Desktop)?

1. **Yes — full markdown with syntax highlighting.** Use a library (marked +
   DOMPurify, or markdown-it). Code blocks get syntax highlighting. Matches
   OpenCode Desktop. **[Recommended]**
2. **Yes — basic markdown only (bold, italic, code, lists, headings).**
   Lightweight renderer, no external deps. Misses tables, nested code, etc.
3. **No — keep plain text.** Avoids rendering complexity and XSS surface.

**Decision:** **1** — full markdown with syntax highlighting (M1-T10).

---

## Q5 — Config editor depth

How deep should the visual config editor (M4) go?

1. **Full visual editor for all major config sections.** Forms for model,
   agents, providers, MCP, permissions, commands, instructions, compaction,
   experimental. Plus raw JSON tab. Most work but biggest differentiator.
   **[Recommended]**
2. **Priority sections only.** Providers, MCP, agents, permissions (the four
   most-used). Skip compaction, experimental, tool_output, instructions for
   now. Faster to ship.
3. **Raw JSON editor only.** Just a syntax-highlighted JSON editor that calls
   `config.update`. No forms. Minimal effort, no UX advantage over editing the
   file directly.

**Decision:** **1** — full visual editor for all major sections + raw JSON tab.

---

## Q6 — Agent management: create/edit custom agents

Should users be able to create and edit custom agents from the SpecOps UI?

1. **Yes — full CRUD with form-based editor.** Name, prompt (markdown), model,
   mode, description, steps, permission rules. Writes to `opencode.json`.
   **[Recommended]** (this is a key "better than OpenCode" feature)
2. **Yes — but only via the raw config JSON editor** (M4-T8). No dedicated
   form. Users edit the `agent:` key directly.
3. **No — view only.** List custom agents but don't allow creating / editing
   from SpecOps. Users edit config files externally.

**Decision:** **1** — full CRUD with form-based agent editor (M4-T4).

---

## Q7 — Embedded terminal priority

How important is the embedded terminal (M5-T6)?

1. **Low — defer to a later phase.** Focus on message rendering, session
   management, composer, and config first. Terminal is a power-user feature;
   SpecOps already has an external-editor-open action. **[Recommended]**
2. **Medium — include in M5 but after TODO/diff/status.** Ship it as the last
   task of M5.
3. **High — prioritize early.** Terminal is essential for a coding workspace.

**Decision:** **1** — defer embedded terminal; M5-T6 marked deferred in execution plan.

---

## Q8 — Theme system scope

How many themes should we ship and how configurable should they be?

1. **Curated set (5–8 themes) + light/dark toggle.** Ship opencode-dark,
   catppuccin, dracula, gruvbox, nord, tokyonight, github. User picks from a
   list. No custom theme editor. **[Recommended]**
2. **Full theme engine.** Import OpenCode's 34-theme library. Custom theme
   editor with per-color overrides. Theme import from JSON. High effort.
3. **Just light/dark.** No named themes; only a color-scheme toggle. Minimal.

**Decision:** Leave themes as they currently are in SpecOps. Extend existing
theme tokens only where new phase-3.5 UI components need styling (M6-T1).

---

## Q9 — Sound / notification scope

Which feedback channels should we add?

1. **Both sounds and OS notifications, per-event toggles.** Agent done,
   permission, question, error. Volume control for sounds. Window-focus check
   for OS notifications. Matches OpenCode Desktop. **[Recommended]**
2. **OS notifications only.** No sounds. Simpler; less intrusive.
3. **Sounds only.** No OS notifications.
4. **Neither — skip for now.** Defer all appearance/feedback to a later phase.

**Decision:** **1** — both sounds and OS notifications in M6 scope (M6-T4/T5).
Font family picker deferred — M6-T2 covers font size only; keep existing mono /
sans fonts.

---

## Q10 — Session list per workspace

Should the workspace show all OpenCode sessions (not just SpecOps-created
agent tabs)?

1. **Yes — unified session list.** Agent sidebar shows all sessions for the
   workspace directory from `session.list`. SpecOps-created agent tabs and
   externally-created sessions (e.g. from TUI or another client) all appear.
   Opening a session creates an agent tab linked to it. **[Recommended]**
2. **No — SpecOps agent tabs only.** Keep the current model where the sidebar
   only shows sessions created via SpecOps. Simpler but sessions created
   outside SpecOps are invisible.

**Decision:** **1** — unified session list per workspace (M2-T2).

---

## Q11 — Slash commands: execution model

How should slash commands work when selected?

1. **Insert template into composer; user edits and sends.** The command's
   template text is inserted into the input. User can modify before sending.
   Non-destructive. **[Recommended]**
2. **Execute immediately via `session.command` API.** Sends the command
   directly to the session without user editing. Faster but less flexible.
3. **Both — insert simple templates, execute action commands.** Template-type
   commands insert text; action-type commands (like `/init`, `/review`)
   execute immediately.

**Decision:** **1** — insert template; user edits and sends (M3-T1).

---

## Q12 — @ mentions scope

What should be mentionable via `@` in the composer?

1. **Files + agents.** `@file:path/to/file` inserts file content as context;
   `@agent:name` invokes a subagent. Covers the most common use cases.
   **[Recommended]**
2. **Files + agents + MCP resources.** Also allow mentioning MCP resources
   (from connected MCP servers). More complete but requires MCP resource
   enumeration.
3. **Files + agents + MCP resources + symbols.** Also allow `@symbol:function
   Name` via `find.symbols`. Most powerful but complex UI.

**Decision:** **1** — files + agents only (M3-T2).

---

## Q13 — M1/M2 dependency on SDK

Can M1 (message rendering) and M2 (session management) start before the SDK
migration (M0) is complete?

1. **No — do M0-T1/T2 first, then M1/M2 on the SDK.** Avoids writing raw-fetch
   code for `session.messages` / `session.fork` etc. that'll be replaced.
   **[Recommended]**
2. **Yes — implement M1/M2 with the raw client; migrate later.** Faster start
   but technical debt.
3. **M1 can start (stream normalization is raw-client already); M2 waits for
   SDK.** Hybrid — stream changes don't need new endpoints, but session
   lifecycle APIs do.

**Decision:** **1** — M0-T1/T2 first, then M1/M2 on the SDK.

---

## Q14 — Fork / undo as agent tabs or in-place

When forking or undoing a session, how should it appear in the UI?

1. **Fork creates a new agent tab; undo is in-place.** Fork → new tab linked
   to the child session (with a "forked from" indicator). Undo → modifies the
   current session in-place with a revert notice. **[Recommended]**
2. **Both create new agent tabs.** Fork → child tab. Undo → new tab at the
   reverted state (non-destructive). Preserves history but clutters sidebar.
3. **Both in-place.** Fork replaces current tab with the child. Undo modifies
   in-place. Simplest but loses the parent/original.

**Decision:** **1** — fork → new tab; undo → in-place (M2-T3/T4).

---

## Q15 — Priority order

Which milestones should ship first? (rank or confirm the suggested order)

Suggested order: **M0 (SDK) → M1 (rendering) → M2 (sessions) → M3 (composer)
→ M4 (config) → M5 (workspace UX) → M6 (appearance, incremental throughout)**

1. **Confirm suggested order.** SDK first, then user-facing gaps by visibility.
   **[Recommended]**
2. **M4 (config) before M2/M3.** Providers + MCP + agents setup is a
   prerequisite for a usable workspace; do config management right after
   rendering.
3. **M6 (appearance) early.** Theme/fonts make the app feel polished even with
   limited features; good for demos / first impressions.
4. **Custom order** (specify).

**Decision:** **1** — confirm M0 → M1 → M2 → M3 → M4 → M5 → M6 (M6 incremental).

---

## Q16 — Phase 3.5 vs splitting into multiple phases

Should this be one phase or split into 3.5 / 3.6 / 3.7?

1. **One phase with milestones.** Keep everything under phase-3.5; milestones
   ship independently. Simpler tracking. **[Recommended]**
2. **Split: 3.5 (M1+M2+M3), 3.6 (M4), 3.7 (M5+M6).** Each sub-phase has its
   own exit criteria. More ceremony but cleaner separation.
3. **Split: 3.5 (M0+M1), 3.6 (M2+M3), 3.7 (M4), 3.8 (M5+M6).** Finer-grained.

**Decision:** **1** — one phase (3.5) with independently shippable milestones.
