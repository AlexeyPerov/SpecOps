# Tauri + SvelteKit + TypeScript

This template should help get you started developing with Tauri, SvelteKit and TypeScript in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## Running locally

From `app/`:

```sh
npm install
npm run tauri dev
```

### Port 1430 already in use

Vite is pinned to port **1430** (`vite.config.js`) with `strictPort: true`, matching `src-tauri/tauri.conf.json` → `build.devUrl`. If a previous dev server did not exit, that port stays occupied and `beforeDevCommand` fails.

Free it (macOS/Linux):

```sh
kill "$(lsof -t -iTCP:1430 -sTCP:LISTEN)"
```

Then run `npm run tauri dev` again.
