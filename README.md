# <img src="app/static/favicon.png" alt="" width="32" height="32" align="top"> SpecOps

Desktop workspace for writing specs, notes, and project files. Built with [Tauri](https://tauri.app/) and [SvelteKit](https://kit.svelte.dev/).

Open folders as workspaces, browse files in the project panel, edit in tabs with CodeMirror, preview Markdown, and keep your session across restarts. A built-in console surfaces logs and (in progress) workspace-scoped AI chat.

![SpecOps main screen](screenshots/main-screen.png)

## What works today

- **Notepad and workspaces** — quick scratchpad plus folder-backed workspaces on the activity rail
- **Project panel** — file tree, open files in tabs, refresh and show/hide hidden files
- **Editor** — syntax highlighting, Markdown preview, find/replace, go to line, unsaved-change diff
- **Console** — resizable bottom panel with **Logs**; **Chat** tab appears when a workspace is open (UI and persistence in place; provider integration ongoing)
- **Session restore** — reopen tabs and workspace layout after restart

## Work in progress

AI chat in the workspace console is the active focus.

### Goal

Workspace-scoped AI chat with **Ask** and **Review** modes, **GLM** and **Cursor SDK** providers, one conversation per workspace, and file-read access checks before chat is enabled.

### Roadmap

| Area | Status | What it covers |
| --- | --- | --- |
| Console chat UI | Done | `Chat` and `Logs` tabs; chat only in a workspace; last-used tab restored per workspace |
| Chat history | Done | One thread per workspace; history saved locally and restored on reopen |
| Workspace access | Done | Preflight checks; clear blocked state when the model cannot read workspace files |
| History limits & errors | Done | Rolling cap on message history, clear-history action, shared error/retry scaffolding |
| AI providers | In progress | Built-in debug provider for development; GLM integration; ask/review modes; switching providers in a thread |
| Cursor SDK | Planned | Second production provider alongside GLM |
| Reliability & polish | Planned | Retry last message, streaming fallbacks, clearer error and recovery copy |

### Not planned for the first release

- Attaching the active file or console logs to AI context
- Multiple chat threads per workspace
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
