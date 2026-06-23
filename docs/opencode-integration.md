# OpenCode integration

SpecOps uses OpenCode as the backend for all workspace-agent workflows (`ws-*` contexts). Chat HTTP providers are only used in the `chat-http` context.

## Integration at a glance

- Workspace chat send/stream/lifecycle operations go through `WorkspaceAgentBackend` (`opencode` backend id).
- The app can talk to OpenCode in two modes:
  - `sidecar` (default): local process managed by SpecOps
  - `url`: remote OpenCode server URL
- OpenCode health is tracked in app settings (`settings.opencodeHealth`) and surfaced in Settings + title-bar status UI.

```mermaid
sequenceDiagram
  participant UI as ChatPanel/Composer
  participant Store as chatStore
  participant Backend as WorkspaceAgentBackend(opencode)
  participant OC as OpenCode (sidecar or URL)

  UI->>Store: send workspace prompt
  Store->>Backend: send/stream/session calls
  Backend->>OC: SDK v2 client requests
  OC-->>Backend: events, messages, session data
  Backend-->>Store: normalized SpecOps contracts
  Store-->>UI: live message updates + workspace UX panels
```

## User-facing terminology

SpecOps aligns with OpenCode Desktop vocabulary in the UI:

| Term | Meaning |
| --- | --- |
| **Session** | A workspace conversation — sidebar row, tab, transcript, and lifecycle actions (fork, share, rename, …). |
| **Agent** | An OpenCode **persona/config** only — Settings → Agents, composer persona picker, `@agent:` mentions, default agent in config. |
| **Chat** | The experimental `chat-http` lane (Settings → Dev); unrelated to workspace sessions. |

Internal code may still use **agent** for conversations until [M16](../specs/ops/phase-3.5/execution-plan-m16.md) (`agentId`, `AgentsSidebar`, disk paths). Do not confuse with:

- **OpenCode session** — server-side conversation object linked via `opencodeSessionId`.
- **Window session** — `SessionState` in `session.json` (editor tabs, last active context); not a chat session.

## Core concepts: workspaces, sessions, agents

### Workspace

- A workspace is a folder-backed context (`ws-*`).
- OpenCode data is scoped to workspace root path.
- Session lists, model catalogs, TODOs, diffs, and status summaries are loaded per workspace.

### Workspace session (UI)

- A **session** is SpecOps UI state in `chatStore` + tab state in `appState` — what users see in the sidebar and tab bar.
- Each session entry may be linked to an OpenCode session via `opencodeSessionId`.
- Draft sessions can exist before a linked OpenCode session exists.

### OpenCode session (server)

- The server-side conversation object in OpenCode.
- A session can be:
  - linked to an existing workspace session tab
  - opened from external OpenCode history into a new SpecOps session tab
- Session lifecycle actions (fork/revert/share/summarize/export/rename) are performed against this server-side session.

### Agent (persona)

- OpenCode agent definitions (`build`, `plan`, custom agents) configured under Settings → Agents.
- Selected in the composer persona picker; referenced in prompts via `@agent:`.

## Relationship model

- **One workspace → many workspace sessions**
- **One workspace session tab → zero or one linked OpenCode session**
- **One OpenCode workspace → many OpenCode sessions**
- SpecOps can open sessions that were not originally created in SpecOps (**All sessions…** / session list).

## Key integrated features

- **Richer transcript rendering:** reasoning, subtasks, step boundaries, attachments, diffs, totals.
- **Session lifecycle:** rename, fork, undo/redo (`revert`/`unrevert`), share/unshare, summarize, export, session list.
- **Composer UX:** slash commands, mentions, file attachments, prompt queueing.
- **Workspace UX panels:** TODO, changes/diff viewer, file status badges, status popover.
- **Configuration management:** OpenCode config, providers, MCP servers, agents, permissions, commands, instructions.

## Setup OpenCode in SpecOps

1. Open **Settings -> Workspaces -> OpenCode**.
2. Ensure **Use OpenCode for workspace sessions** is enabled.
3. Choose transport mode:
   - **Sidecar (default):** local OpenCode sidecar managed by SpecOps.
     The **Sidecar port** field sets the local port the sidecar binds to
     (default `4096`; validated to 1024–65535). The effective sidecar URL
     is shown read-only below the input — it tracks the port so the URL
     probe and SDK wiring stay consistent. Change the port only when
     `4096` is already in use locally.
   - **URL:** enter your OpenCode server URL (`http://` or `https://`).
4. If your server requires auth, set **Server password** (stored in `provider-secrets.json`, not in `settings.json`).
5. Click **Check connection** to verify health.
6. Click **Refresh model list** to load current server models.
7. Open a workspace and start or select a session.

## Sidecar notes

- Bundled binaries are expected at `app/src-tauri/binaries/opencode-<target-triple>`.
- In development, if a bundled binary is missing, SpecOps falls back to an `opencode` executable on `PATH`.
- The maintainer script
  [`scripts/update-opencode-sidecar.sh`](../scripts/update-opencode-sidecar.sh)
  refreshes the bundled binaries from upstream GitHub releases. See
  [`app/src-tauri/binaries/README.md`](../app/src-tauri/binaries/README.md)
  for asset→triple mapping and usage (npm alias: `npm --prefix app run update-opencode-sidecar`).
- The bundled CLI version can drift from the `@opencode-ai/sdk` version in
  `app/package.json` (SDK uses a caret range and resolves at install time;
  bundled binary is a pinned release). The script does not modify the
  SDK lockfile — bump `@opencode-ai/sdk` manually if you need them to
  match exactly.

## Sidecar lifecycle — lazy, session-scoped

The sidecar is **lazy** and **session-scoped**. It does not start when a workspace opens or when a file/editor tab is active.

| Trigger | Sidecar spawns? |
| --- | --- |
| Send on a session tab (sidecar mode) | **Yes** (primary) |
| Settings → **Check connection** | **Yes** (explicit retry; clears circuit breaker) |
| Settings → **Refresh model list** | **Yes** |
| Open OpenCode config sub-panels (providers, MCP, agents, …) | **Yes** (explicit) |
| Workspace add / switch / lifecycle | **No** |
| File/editor tab active | **No** |
| Session tab open (idle) | **No** |
| Catalog auto-prefetch on session-tab mount | **No** (deferred until Send or Settings refresh) |

### Non-session tabs never touch OpenCode

On `file`/`editor`/`notepad` tabs the app shell skips OpenCode entirely — no sidecar attach, no catalog refresh, no file-status fetch, no reconcile / hydrate. Workspace file editing does not require OpenCode.

### Background reconcile + hydrate (session tab only)

When the user opens / switches a workspace **on a session tab**, a fire-and-forget background reconcile + hydrate runs **only when all** of:

1. Sidecar is already running and healthy (status probe only — no attach).
2. Active session has a linked OpenCode session id.
3. Thread has ≥ 1 message.
4. Last message role is `user` (pending turn; skip when `assistant` — local cache is sufficient after a completed turn).

Always show the local transcript immediately on switch; the background work is best-effort, single-flight, non-blocking.

### Circuit breaker on hard failure

Treat `portInUse`, `missingBinary`, `launchFailure`, and `healthTimeout` as hard failures. On hard failure:

1. `opencodeHealth.status = "error"` with an actionable `lastErrorMessage`.
2. In-memory circuit-breaker flag (cleared by app restart, an explicit Settings action, or a successful explicit start).
3. **One deduped snackbar** per failure episode: *"OpenCode could not start. Check Settings → Workspaces → OpenCode."*
4. No automatic retry on workspace switch, session-tab switch, or effect re-runs.

Clear breaker: user clicks **Check connection**, toggles OpenCode enabled / mode, or sends the first message after the failure (Send may attempt once and surface the error).

### Non-blocking spawn

`opencode_sidecar_attach_workspace` no longer blocks the Tauri IPC thread for up to 10 s. It spawns the process and returns with `health: checking`; a dedicated background thread polls `/global/health` and updates the sidecar state. The frontend `ensureOpencodeSidecar({ intent: "send" })` waits on the resolved health (with a 10 s cap) so the Send button stays responsive.

## Important source files

- Backend + SDK mapping: `app/src/lib/ai/backends/workspaceAgentBackend.ts`
- Sidecar runtime/health: `app/src/lib/services/opencodeSidecar.ts`
- OpenCode settings defaults/validation: `app/src/lib/services/opencodeSettings.ts`
- Session lifecycle handlers: `app/src/lib/services/appShellAgentHandlers.ts`
- Hydration from `session.messages`: `app/src/lib/services/workspaceAgentHydration.ts`
- OpenCode Settings UI: `app/src/lib/components/settings/OpenCodeSettingsPanel.svelte`
