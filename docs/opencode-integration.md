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

## Core concepts: workspaces, agents, sessions

### Workspace

- A workspace is a folder-backed context (`ws-*`).
- OpenCode data is scoped to workspace root path.
- Session lists, model catalogs, TODOs, diffs, and status summaries are loaded per workspace.

### Agent tab

- An agent tab is SpecOps UI state in `chatStore` + tab/session state in `appState`.
- Each agent entry may be linked to an OpenCode session via `opencodeSessionId`.
- Draft agents can exist before a linked OpenCode session exists.

### OpenCode session

- The server-side conversation object in OpenCode.
- A session can be:
  - linked to an existing agent tab
  - opened from external OpenCode history into a new SpecOps agent tab
- Session lifecycle actions (fork/revert/share/summarize/export/rename) are performed against this server-side session.

## Relationship model

- **One workspace -> many agent tabs**
- **One agent tab -> zero or one linked OpenCode session**
- **One OpenCode workspace -> many OpenCode sessions**
- SpecOps can open sessions that were not originally created in SpecOps (session list / external session open).

## Key integrated features

- **Richer transcript rendering:** reasoning, subtasks, step boundaries, attachments, diffs, totals.
- **Session lifecycle:** rename, fork, undo/redo (`revert`/`unrevert`), share/unshare, summarize, export, session list.
- **Composer UX:** slash commands, mentions, file attachments, prompt queueing.
- **Workspace UX panels:** TODO, changes/diff viewer, file status badges, status popover.
- **Configuration management:** OpenCode config, providers, MCP servers, agents, permissions, commands, instructions.

## Setup OpenCode in SpecOps

1. Open **Settings -> Workspaces -> OpenCode**.
2. Ensure **Use OpenCode for workspace agents** is enabled.
3. Choose transport mode:
   - **Sidecar (default):** local OpenCode sidecar managed by SpecOps.
   - **URL:** enter your OpenCode server URL (`http://` or `https://`).
4. If your server requires auth, set **Server password** (stored in `provider-secrets.json`, not in `settings.json`).
5. Click **Check connection** to verify health.
6. Click **Refresh model list** to load current server models.
7. Open a workspace and start or select an agent tab.

## Sidecar notes

- Bundled binaries are expected at `app/src-tauri/binaries/opencode-<target-triple>`.
- In development, if a bundled binary is missing, SpecOps falls back to an `opencode` executable on `PATH`.

## Important source files

- Backend + SDK mapping: `app/src/lib/ai/backends/workspaceAgentBackend.ts`
- Sidecar runtime/health: `app/src/lib/services/opencodeSidecar.ts`
- OpenCode settings defaults/validation: `app/src/lib/services/opencodeSettings.ts`
- Session lifecycle handlers: `app/src/lib/services/appShellAgentHandlers.ts`
- Hydration from `session.messages`: `app/src/lib/services/workspaceAgentHydration.ts`
- OpenCode Settings UI: `app/src/lib/components/settings/OpenCodeSettingsPanel.svelte`
