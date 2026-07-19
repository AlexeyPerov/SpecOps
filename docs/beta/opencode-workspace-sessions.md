# Workspace sessions — OpenCode integration (beta)

> **Beta feature.** The workspace-sessions backend (OpenCode) is an experimental
> beta lane. It is **disabled by default**. To enable it, turn on
> **Settings → Dev → Enable OpenCode (beta)**, then configure transport and
> providers under **Settings → Workspaces → OpenCode**.

SpecOps routes **workspace context** (internal id pattern `ws-*`) AI through the
OpenCode backend. Each workspace folder gets its own session list, transcript,
and lifecycle (fork, revert, share, summarize, export). The backend supports
tool use, permission prompts, question prompts, agents, MCP servers, and
streaming.

**Chat contexts** (internal id `chat-http`) are a separate beta lane that routes
through an HTTP provider registry instead — see
[chat-http-providers.md](./chat-http-providers.md).

## How to enable

1. Open **Settings → Dev**.
2. Check **Enable OpenCode (beta)**.
3. Switch to **Settings → Workspaces → OpenCode** to pick a transport (sidecar
   or URL) and check the connection.

## What is hidden when OpenCode (beta) is off

When the toggle is off, the following are removed from the UI so the disabled
feature leaves no surface visible:

- **Sessions sidebar** in workspace contexts.
- **Per-workspace session counts** in the activity rail (the file/view tab count
  remains).
- **Session tabs** — any open session tabs are closed when the toggle flips off.
- **Workspaces settings section** — the OpenCode, Config, Providers, MCP servers,
  Agents, Permissions, Commands, Instructions, and Debug Provider tabs are
  hidden from the settings sidebar and unreachable from deep links (they
  redirect to the Dev master panel).
- **Sidecar / SDK activity** — no OpenCode sidecar starts and no backend calls
  are made.

Persisted configuration (transport mode, base URL, port, provider keys, MCP
servers, agents, permissions, commands, instructions) is preserved across
toggle changes; only visibility and runtime activity are gated.

## Transport modes

| Mode | Description |
| --- | --- |
| `sidecar` (default) | Local OpenCode process managed by SpecOps on `127.0.0.1:<port>`. |
| `url` | Remote OpenCode server URL (e.g. `opencode serve` on another host). |

The sidecar starts lazily on the first backend call that needs it (send
pipeline, settings actions). Background-sync / status-only callers never spawn
the sidecar.

## Settings shape

Defined in `app/src/lib/domain/settings.ts` as `OpencodeSettings`:

```json
{
  "opencode": {
    "enabled": false,
    "mode": "sidecar",
    "baseUrl": "http://127.0.0.1:4096",
    "sidecarPort": 4096
  }
}
```

Normalized in `app/src/lib/services/opencodeSettings.ts`
(`normalizeOpencodeSettings`). The `enabled` field defaults to `false`; an
explicit boolean in persisted settings is always preserved.

## Gating architecture

| Layer | Mechanism |
| --- | --- |
| Default | `defaultOpencodeSettings.enabled = false` |
| Predicate | `isOpencodeEnabled(settings)` in `opencodeSettings.ts` |
| Slice action | `appState.setOpencodeEnabled(enabled)` — normalizes settings, resets health, closes session tabs on disable, clears the sidecar circuit breaker |
| Runtime | `createOpencodeBackendFromAppState` returns `null` when disabled; the send pipeline, sidecar effects, and agent handlers short-circuit |
| Sidebar visibility | `+page.svelte` / `AppShellHost.svelte` hide the Sessions sidebar when `!opencodeEnabled` |
| Rail counts | `ActivityRail.svelte` hides per-workspace "Sessions: N" when `!opencodeEnabled` |
| Settings tabs | `settingsDialogUi.ts` — `OPENCODE_GATED_TABS` filtered from the sidebar; deep links redirect to Dev |
| Settings toggle | `DevSettingsPanel.svelte` — "OpenCode (beta)" section |

See [opencode-integration.md](../opencode-integration.md) for the full backend
contract, SDK wiring, and session lifecycle. Implementation history is in the
[changelog](../../specs/changelog.md).
