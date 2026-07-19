# Beta / experimental features

Features under this folder are **experimental**. They are intentionally kept
out of the main docs and out of the default settings sidebar — opt-in is
required, and behavior / location may change between releases.

## Active beta features

| Feature | Doc | How to enable |
| --- | --- | --- |
| **OpenCode (beta)** — workspace sessions backend (internal context pattern `ws-*`) with tools, permissions, agents, and MCP | [opencode-workspace-sessions.md](./opencode-workspace-sessions.md) | **Settings → Dev → Enable OpenCode (beta)** |
| **Chat (beta)** — HTTP chat context (internal id `chat-http`) with OpenAI-compatible providers and Debug Provider | [chat-http-providers.md](./chat-http-providers.md) | **Settings → Dev → Enable Chat (beta)** |

## Why these are beta

Both AI lanes — workspace sessions (OpenCode) and the HTTP chat context — are
experimental and ship **disabled by default**. The editor, project panel,
version control, and all non-AI features work without any beta toggle.

Enable the lane you want under **Settings → Dev**:

- **OpenCode (beta)** powers per-workspace conversations with tool use,
  permissions, agents, MCP servers, and streaming transcripts. When disabled,
  the Sessions sidebar, per-workspace session counts, the Workspaces settings
  section, and any open session tabs are hidden.
- **Chat (beta)** is the lighter HTTP-provider lane for users who already
  configured an OpenAI-compatible connection.

See the [main README](../../README.md) for the overall product overview.

## Reporting issues

Beta features accept feedback through normal channels. Please note the
version and which beta feature is in use.

See also the [docs index](../README.md).