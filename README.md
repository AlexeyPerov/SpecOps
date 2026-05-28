# <img src="app/static/favicon.png" alt="" width="32" height="32" align="top"> SpecOps

Desktop workspace for writing specs, notes, and project files. Built with [Tauri](https://tauri.app/) and [SvelteKit](https://kit.svelte.dev/).

Open folders as workspaces, browse files in the project panel, edit in tabs with CodeMirror, preview Markdown, and keep your session across restarts. A built-in console surfaces logs; workspace-scoped AI agents (in progress) live in a dedicated sidebar and agent tabs.

![SpecOps main screen](screenshots/main-screen.png)

## What works today

- **Notepad and workspaces** — quick scratchpad plus folder-backed workspaces on the activity rail
- **Project panel** — file tree, open files in tabs, refresh and show/hide hidden files
- **Editor** — syntax highlighting, Markdown preview, find/replace, go to line, unsaved-change diff
- **Console** — resizable bottom panel with **Logs** (chat moves to workspace agent tabs; see Work in progress)
- **Session restore** — reopen tabs and workspace layout after restart

## Work in progress

AI agents in workspaces is the active focus. The product is pivoting from console-embedded chat to an **agents sidebar** plus **agent tabs** in the main editor area.

### Goal

Workspace-scoped AI agents with **Ask** and **Review** modes, **GLM** and **Cursor SDK** providers, multiple conversations per workspace, and file-read access checks before chat is enabled.

### Roadmap

| Area | Status | What it covers |
| --- | --- | --- |
| Provider foundation (Debug) | Done | Provider abstraction, ask/review modes, send pipeline, Debug provider for development |
| Console chat UI (legacy) | Superseded | Original console Chat tab; replaced by agents UI shell |
| Agents UI shell | Next | Agents sidebar, agent tabs, multi-agent persistence, logs-only console |
| Chat history | Partial | Per-workspace single thread delivered; migrating to per-agent threads |
| Workspace access | Done | Preflight checks; blocked state when the model cannot read workspace files |
| History limits & errors | Done | Rolling cap, retry scaffolding (delete agent replaces clear history) |
| GLM provider | Planned | Settings, adapter, inline setup CTA in agent tabs |
| Cursor SDK | Planned | Second production provider alongside GLM |
| Reliability & polish | Planned | Retry last message, streaming fallbacks, clearer error and recovery copy |

### Not planned for the first release

- Attaching the active file or console logs to AI context
- Agent list subtitles
- Remote chat sync

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
