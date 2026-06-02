# <img src="app/static/favicon.png" alt="" width="32" height="32" align="top"> SpecOps

Building text and markdown files editor with support of workspace AI. Tech: [Tauri](https://tauri.app/) and [SvelteKit](https://kit.svelte.dev/).

## What works today

- **Notepad** with syntax highlighting for .md and code files
- **Markdown** viewer and editor
- **Folders as workspaces**
- **Project panel** — file tree (all files), drag-and-drop move, context menu (new/rename/delete), live refresh, open in tabs, show/hide hidden files
- **Themes**
- **Multi-Window**
- **Images** preview
- **Console** — resizable bottom panel with **Logs**
- WIP: AI support

---
![SpecOps main screen](screenshots/main-screen.png)
---
![SpecOps main screen](screenshots/main-screen-split-view.png)
---
![SpecOps main screen](screenshots/main-screen-themes.png)

## What is planned

- Massive **Notepad** UX improvements
- **Git** module
- **AI Support**

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

### CI releases

Pushing a semver tag (for example `v1.0.0`) triggers the [Release](.github/workflows/release.yml) workflow. It builds macOS (universal binary) and Windows installers and publishes them as assets on the GitHub release for that tag.
