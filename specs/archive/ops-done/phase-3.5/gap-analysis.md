# Gap analysis — SpecOps workspace agents vs OpenCode Desktop

**Scope:** workspaces (= OpenCode projects), their agents, agent chats, and
workspace/agent settings only. Notepad and Chat-HTTP / Cloud contexts excluded.

## How to read this document

Each table compares a feature area. Columns:

- **Feature** — capability.
- **OpenCode Desktop** — how it works in OpenCode's own web/desktop app.
- **SpecOps (current)** — what SpecOps has today (post-phase-3).
- **Gap** — severity: `critical` (core workflow missing), `major` (visible
  missing feature), `minor` (polish / nice-to-have), `none` (parity).

---

## 1. Message rendering

OpenCode messages are composed of **Parts** (a typed union). SpecOps flattens
messages to a single text string + tool-call records.

| Part type | OpenCode Desktop | SpecOps | Gap |
|-----------|-----------------|---------|-----|
| `text` | Rendered as markdown | Rendered as text (no markdown rendering) | major |
| `reasoning` | Collapsible thinking blocks, dimmed | Not rendered (discarded during normalization) | critical |
| `tool` | Rich tool cards with expandable input/output | Basic tool cards (name, status, input/output) | minor |
| `subtask` | Subagent invocation panel (agent, model, status, output) | Not rendered | major |
| `step-start` / `step-finish` | Agentic step boundaries with cost/tokens/snapshot | Not rendered | major |
| `file` | Attachments: images inline, other files as chips | Not rendered | major |
| `snapshot` / `patch` | Diff viewer inline in message | Not rendered | major |
| `agent` | Inline @agent mention | Not rendered | minor |
| `retry` | Retry indicator with error | Not rendered | minor |
| `compaction` | Compaction marker | Shown as plain text notice | minor |
| Cost / tokens per message | Shown in message footer | Not shown | major |
| Cost / tokens per session | Shown in header / sidebar | Not shown | major |

**Root cause:** SpecOps' `WorkspaceAgentStreamEvent` union only carries
`message.delta` (string), `message.completed` (string), `tool.*`,
`permission.requested`, `question.requested`, `run.*`. The normalization layer
(`mapStreamFrame` in `workspaceAgentBackend.ts`) maps
`session.next.text.delta` → `message.delta` but has no mapping for reasoning,
subtask, step, file, or diff events.

**Fix:** extend the stream normalization + `ChatMessage` domain to carry parts;
or hydrate from `session.messages` API which returns the full structured parts.

---

## 2. Session lifecycle & management

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| Create session | Auto on first prompt | Auto on first prompt | none |
| List sessions per project | Session list with search, sort, archive | Agent sidebar (SpecOps-local index only; not OpenCode sessions) | major |
| Session messages hydration | `session.messages` returns full part-structured history | SpecOps stores its own thread snapshot; OpenCode session rehydrated as empty | critical |
| Rename | `session.update` + UI | Agent tab title is SpecOps-local; not synced to OpenCode session title | major |
| Fork | `session.fork` — branch from any message; parent/child navigation | Not supported | major |
| Undo / revert | `session.revert` — rollback to a message snapshot | Not supported | major |
| Redo / unrevert | `session.unrevert` | Not supported | major |
| Share | `session.share` → public URL | Not supported | major |
| Unshare | `session.unshare` | Not supported | major |
| Summarize | `session.summarize` | Not supported | minor |
| Export | Transcript to markdown | Not supported | minor |
| Diff | `session.diff` — all file changes for session | Not supported | major |
| Delete | `session.delete` | Supported (agent delete) | none |
| Abort | `session.abort` | Supported | none |
| Children (fork tree) | `session.children` | Not supported | minor |
| Background subagents | `session.background` — panel for background tasks | Not supported | minor |

---

## 3. Composer / prompt input

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| Plain text input | Yes | Yes | none |
| Slash commands | `/` triggers command popover (`command.list`); inserts template | Not supported | critical |
| @ mentions | `@` triggers context picker: files, agents, MCP resources | Not supported | major |
| File attachments | Drag-drop + file picker; images inline | Not supported | major |
| Image attachments | Paste / drag; previewed inline | Not supported | major |
| Prompt history | Arrow-up/down; frecency ordered | Not supported | major |
| Queued prompts | FIFO queue with steer-vs-queue mode | Not supported | minor |
| Agent picker (Tab) | Tab / Shift+Tab cycles agents | Picker in composer footer | minor (different UX) |
| Model picker | Model list dialog with search, favorites, variants | Picker in composer footer (no search, no variants) | minor |
| Model variants | Reasoning level cycling (Ctrl+T) | Not supported | minor |
| Context window indicator | Token budget display | `estimateContextWindowBudget` exists (HTTP only) | minor |

---

## 4. Configuration management

OpenCode config is file-based (`opencode.json` / `.jsonc`) with layered
discovery. OpenCode Desktop provides partial visual editors. This is where
SpecOps can be **better** than OpenCode by providing a complete visual config
experience.

### 4a. General config

| Setting | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| `model` (default) | Config file / model dialog | OpenCode catalog picker (per-thread) | minor |
| `small_model` | Config file only | Not exposed | major |
| `default_agent` | Config file only | Not exposed | major |
| `username` | Config file only | Not exposed | minor |
| `share` mode | Config file only | Not exposed | minor |
| `autoupdate` | Config file only | Not exposed | minor |
| `snapshot` | Config file only | Not exposed | minor |
| `compaction` settings | Config file only | Not exposed | major |
| `tool_output` truncation | Config file only | Not exposed | minor |
| `instructions` files | Config file only | Not exposed | major |
| `experimental` flags | Config file only | Not exposed | minor |

### 4b. Provider management

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| List providers | `provider.list` + settings dialog | Catalog picker (read-only list) | major |
| Set API key | `provider.auth` / settings | Not supported (OpenCode config manages keys) | critical |
| OAuth flow | `provider.oauth.authorize` + callback | Not supported | major |
| Enable / disable providers | `enabled_providers` / `disabled_providers` | Not exposed | major |
| Model filtering (whitelist / blacklist) | Config file | Not exposed | minor |
| Custom provider (npm) | Config file | Not exposed | minor |

### 4c. MCP server management

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| List MCP servers + status | `mcp.status` + dialog | Not supported | critical |
| Add local (stdio) MCP | `mcp.add` + dialog | Not supported | major |
| Add remote (HTTP/SSE) MCP | `mcp.add` + dialog | Not supported | major |
| Connect / disconnect | `mcp.connect` / `mcp.disconnect` | Not supported | major |
| MCP OAuth | `mcp.auth.*` | Not supported | minor |
| View MCP tools / resources | Shown in @ autocomplete | Not supported | minor |

### 4d. Agent management

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| List built-in agents (build, plan, etc.) | Picker | Catalog picker | none |
| List custom agents (config + .md files) | Picker | Catalog picker (if OpenCode returns them) | minor |
| Create custom agent | Edit `opencode.json` or `.opencode/agent/*.md` | Not supported | major |
| Edit agent (prompt, model, permissions) | Edit config files | Not supported | major |
| Delete / disable agent | `disable: true` in config | Not supported | minor |
| AI-generate agent | `Agent.generate()` | Not supported | minor |
| Per-agent permission rules | Config `agent.{name}.permission` | Not supported | major |
| Per-agent model override | Config `agent.{name}.model` | Not exposed in agent list | minor |
| Agent mode (primary / subagent) | Config `agent.{name}.mode` | Not exposed | minor |
| Agent steps limit | Config `agent.{name}.steps` | Not exposed | minor |

### 4e. Permission rules

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| View permission rules | Config file | Not supported | major |
| Edit per-tool rules (allow/deny/ask) | Config file | Not supported | major |
| Glob patterns per tool | Config file | Not supported | major |
| Saved approvals ("always" replies) | Stored in session permission rules | Sent to OpenCode but not viewable | minor |

### 4f. Slash commands

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| List commands | `command.list` | Not supported | major |
| Config-defined commands | Config `command:` key | Not supported | major |
| Auto-discovered commands (`.opencode/command/*.md`) | Auto-discovered | Not supported | minor |
| Create / edit command | Edit config / markdown files | Not supported | minor |

---

## 5. Workspace UX surfaces

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| Project file tree | Yes | Yes (ProjectPanel + ProjectTreeView) | none |
| Project icon (favicon) | Auto-discovered | Not shown | minor |
| Project rename | `project.update` | Not supported (path-based name) | minor |
| Embedded terminal | xterm.js via PTY API | Not supported | major |
| Diff viewer (session changes) | `session.diff` inline + side panel | Not supported | major |
| TODO panel | `session.todo` checklist | Not supported | major |
| File change tracking | `file.status` badge in tree | Not supported | major |
| Status popover | LSP, MCP, providers, permissions counts | Not supported | major |
| Session timeline | Jump-to-message dialog | Not supported | minor |
| Background subagents panel | `session.background` | Not supported | minor |
| Session progress bar | Step / token progress | Not supported | minor |

---

## 6. Appearance & feedback

| Feature | OpenCode Desktop | SpecOps | Gap |
|---------|-----------------|---------|-----|
| Color scheme (light/dark/system) | Yes | Dark-only (CSS variables) | major |
| Themes (34 built-in in TUI) | Curated themes | Single dark theme | major |
| Font: mono | Configurable | Fixed | major |
| Font: sans (UI) | Configurable | Fixed | major |
| Font size | Configurable | Fixed | minor |
| Sound notifications | Per-event with volume + sound pack | Not supported | minor |
| OS notifications | On agent / permission / error | Not supported | minor |
| Keybinding customization | Full keybind editor | Fixed shortcuts | minor |
| Diff style (stacked/unified) | Configurable | N/A (no diff viewer) | minor |

---

## 7. API surface utilization

SpecOps' `workspaceAgentBackend.ts` uses a **hand-rolled HTTP client** calling
~12 endpoints. The OpenCode SDK exposes **~80+ methods**. Below is a summary of
unused API surface.

### Currently used endpoints (raw HTTP)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/session` | Create session |
| GET | `/session/{id}` | Get session |
| GET | `/api/session` | List sessions |
| DELETE | `/session/{id}` | Delete session |
| POST | `/api/session/{id}/prompt` | Send prompt |
| POST | `/api/session/{id}/permission/request/{rid}/reply` | Permission reply |
| POST | `/api/session/{id}/question/request/{rid}/reply` | Question reply |
| POST | `/api/session/{id}/question/request/{rid}/reject` | Question reject |
| POST | `/api/session/{id}/abort` | Abort |
| GET | `/api/event` | SSE stream |
| GET | `/api/model` | Model catalog |
| GET | `/api/provider` | Provider catalog |
| GET | `/api/agent` | Agent catalog |

### Unused SDK methods (grouped)

| Group | Methods | What it unlocks |
|-------|---------|-----------------|
| `session.*` | `messages`, `message`, `update`, `fork`, `children`, `revert`, `unrevert`, `share`, `unshare`, `diff`, `summarize`, `todo`, `promptAsync`, `command`, `shell` | M1, M2 — full session management |
| `config.*` | `get`, `update`, `providers` | M4 — config editor |
| `provider.*` | `list`, `auth`, `oauth.authorize`, `oauth.callback` | M4 — provider management |
| `mcp.*` | `status`, `add`, `connect`, `disconnect`, `auth.*` | M4 — MCP management |
| `command.*` | `list` | M3 — slash commands |
| `tool.*` | `list`, `ids` | M4 — tool/permission visibility |
| `file.*` | `list`, `read`, `status` | M5 — file change tracking |
| `find.*` | `text`, `files`, `symbols` | M3 — @ mentions search |
| `pty.*` | `list`, `create`, `remove`, `connect`, `update` | M5 — embedded terminal |
| `lsp.*` | `status` | M5 — status popover |
| `project.*` | `list`, `current` | M2 — session list per project |
| `vcs.*` | `get` | M5 — git info |
| `app.*` | `log`, `agents` | Debug + agent list |

---

## 8. SpecOps advantages (keep / amplify)

These are areas where SpecOps is already **better** than OpenCode Desktop:

| Advantage | Detail |
|-----------|--------|
| Multi-workspace activity rail | Open multiple projects simultaneously with one-click switch |
| Integrated editor + chat | File editor tabs + agent chat in the same window |
| Notepad + Chat lanes | Separate contexts for different workflows |
| Resizable / collapsible panels | Layout is more flexible than OpenCode's fixed panes |
| Tauri native shell | Smaller footprint than Electron; native macOS dock menu |
| Sidecar reuse across workspaces | Single OpenCode server reused (Phase 3 M4 Task 1) |

Phase 3.5 should preserve all of these while closing the gaps above.
