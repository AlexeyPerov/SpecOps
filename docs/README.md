# SpecOps docs

Stable documentation for users and contributors. Product plans, execution checklists, and the changelog live under [`../specs/`](../specs/) — that tree is development material, not end-user docs.

## For users

| Doc | When to read it |
| --- | --- |
| [../README.md](../README.md) | Product overview, install, quick start |
| [opencode-integration.md](./opencode-integration.md) | Workspace sessions (OpenCode): first session, sidecar/URL, providers, troubleshooting |
| [beta/README.md](./beta/README.md) | Experimental features (opt-in) |
| [beta/chat-http-providers.md](./beta/chat-http-providers.md) | Chat (beta) HTTP providers — only if you turn on **Settings → Dev → Enable Chat (beta)** |

**Recommended AI path:** Open a workspace folder and use **Sessions** with OpenCode. Do not start with Chat (beta) unless you already need an OpenAI-compatible HTTP lane.

## For contributors

| Doc | When to read it |
| --- | --- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, tests, changelog, PR/branch norms |
| [../AGENTS.md](../AGENTS.md) | Rules for coding agents in this repo |
| [architecture.md](./architecture.md) | Repo layout, state, persistence, where to change things |
| [opencode-integration.md](./opencode-integration.md) | OpenCode backend, sidecar lifecycle, key source files |
| [beta/chat-http-providers.md](./beta/chat-http-providers.md) | HTTP provider registry (Chat beta only) |

## Docs vs specs

| Tree | Purpose |
| --- | --- |
| `docs/` | How the product works today — setup, architecture, integrations |
| `specs/` | Roadmaps, phase plans, feature specs, [`changelog.md`](../specs/changelog.md) |
