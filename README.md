# <img src="app/static/favicon.png" alt="" width="32" height="32" align="top"> SpecOps

Desktop workspace for writing specs, notes, and project files. Built with [Tauri](https://tauri.app/) and [SvelteKit](https://kit.svelte.dev/).

Open folders as workspaces, browse files in the project panel, edit in tabs with CodeMirror, preview Markdown, and keep your session across restarts. A built-in console surfaces logs; workspace-scoped AI agents live in a dedicated sidebar and agent tabs.

![SpecOps main screen](screenshots/main-screen.png)

## What works today

- **Notepad and workspaces** — quick scratchpad plus folder-backed workspaces on the activity rail
- **Project panel** — file tree, open files in tabs, refresh and show/hide hidden files
- **Editor** — syntax highlighting, Markdown preview, find/replace, go to line, unsaved-change diff
- **Console** — resizable bottom panel with **Logs** only
- **AI agents** — workspace-scoped agents sidebar, agent tabs, **Ask** and **Review** modes, GLM provider (Debug for development)
- **Session restore** — reopen tabs and workspace layout after restart

## AI agents (MVP)

Workspace-scoped AI agents with **Ask** and **Review** modes, **GLM** as the production provider (plus settings-gated **Debug** for development), multiple conversations per workspace, retry on failure, streaming on Debug with buffered GLM fallback, and file-read access checks before chat is enabled.

| Area | Status | What it covers |
| --- | --- | --- |
| Agents UI | Done | Agents sidebar, agent tabs, multi-agent persistence, logs-only console |
| GLM provider | Done | Settings, adapter, inline setup CTA in agent tabs |
| Reliability & polish | Done | Retry last message, streaming fallbacks, error and recovery copy |
| Cursor SDK (optional extra) | Planned | Second production provider; not required for MVP |

### Not planned for the first release

- Attaching the active file or console logs to AI context
- Agent list subtitles
- Remote chat sync
- Cursor SDK provider (optional post-MVP — see `specs/ai-m-extra-1-execution-plan.md`)

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain, required by Tauri)

## Development

From the `app/` directory:

```sh
npm install
npm run tauri dev
```

This starts the Vite dev server and opens the desktop app. Type-check the frontend with:

```sh
npm run check
```

### Unit tests

From the `app/` directory:

```sh
npm test
```

Run tests in watch mode while developing:

```sh
npm run test:watch
```

Tests live next to source as `*.test.ts` files under `app/src/`. Rust backend tests run from `app/src-tauri/`:

```sh
cargo test
```

If port **1430** is already in use (Vite is pinned to that port), free it and retry:

```sh
kill "$(lsof -t -iTCP:1430 -sTCP:LISTEN)"
npm run tauri dev
```

## Build

From the `app/` directory:

```sh
npm install
npm run tauri build
```

Installers and bundles are written to `app/src-tauri/target/release/bundle/`.

On macOS, CI builds a universal binary when you push a semver tag (`v1.0.0`).
