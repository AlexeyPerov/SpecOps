# <img src="app/static/favicon.png" alt="" width="32" height="32" align="top"> SpecOps (Under Active Development)

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
- **AI chat**
  - **Workspace agents** powered by [OpenCode](https://opencode.ai/) (tools, permissions, streaming)
  - Dedicated **Chat** context (`chat-http`) gated by HTTP connection setup
  - OpenAI-compatible HTTP provider and Debug provider
  - Streaming assistant responses (SSE)

---

| ![SpecOps main screen](screenshots/main-screen.png) | ![SpecOps main screen](screenshots/main-screen-split-view.png)|
|------------------------------------------|-------------------------------------------------|
| ![SpecOps main screen](screenshots/main-screen-themes.png) | ![SpecOps main screen](screenshots/main-screen-logs.png) |


## What is planned

- UI / UX improvements
- **Git** module
- Extended **AI Support**

## Workspace agents (OpenCode)

Workspace folders use **OpenCode** as the agent runtime. SpecOps is the UI; OpenCode runs the model, tools, and session logic on disk.

| Context | Runtime | Where to configure models/API keys |
| --- | --- | --- |
| Workspace agents (`ws-*`) | OpenCode server | OpenCode (`/connect`, `opencode.json`, `auth.json`) |
| Chat (`chat-http`) | OpenAI-compatible HTTP | SpecOps **Settings → Chats → Providers** |

### Quick start

1. **Install OpenCode** (development builds expect `opencode` on your `PATH`; release builds bundle a sidecar binary):
   ```sh
   curl -fsSL https://opencode.ai/install | bash
   ```
2. **Open a workspace folder** in SpecOps (activity rail → add folder).
3. By default, SpecOps starts a local **OpenCode sidecar** for that directory (default port `4096`). You can disable this via **Settings → Workspaces → OpenCode → Use OpenCode for workspace agents** to use the folder as a plain editor without agents.
4. When enabled, health is shown under **Settings → Workspaces → OpenCode**.
4. **Configure a provider** in OpenCode (see below) — workspace agents do not use the HTTP connections in SpecOps settings.
5. In SpecOps, click **Refresh model list**, then pick a model in the workspace agent composer.
6. Use the **Agents** sidebar: create an agent tab, send a prompt. Tool calls, permission prompts, and question prompts appear in the chat panel.

### OpenCode server modes

**Sidecar (default)** — SpecOps launches OpenCode when you open a workspace (when OpenCode is enabled). No extra setup unless you set `OPENCODE_SERVER_PASSWORD` on the server (enter the same value under **Server password** in settings).

**URL** — Run OpenCode yourself, for example:
```sh
cd /path/to/your/project
opencode serve
```
Then in SpecOps: **Settings → Workspaces → OpenCode → URL**, set the base URL (for example `http://127.0.0.1:4096`), and use **Check connection**.

### Provider setup (OpenRouter, GLM Coding Plan, …)

API keys and model catalogs for **workspace agents** live in **OpenCode**, not in SpecOps `settings.json`. After you connect a provider, use **Refresh model list** in SpecOps so the composer picks up models from the running server.

Configure providers once with the OpenCode CLI (auth is shared with the sidecar SpecOps starts):

```sh
cd /path/to/your/project
opencode
```

#### OpenRouter

1. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. In the OpenCode TUI, run `/connect`, choose **OpenRouter**, and paste the key.
3. Run `/models` and select a model (many OpenRouter models are preloaded).

Alternatively, set the key in `~/.local/share/opencode/auth.json`:

```json
{
  "openrouter": {
    "type": "api",
    "key": "sk-or-your-key-here"
  }
}
```

Optional: pin or add models in `opencode.json` (project root or OpenCode config path):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "anthropic/claude-sonnet-4": {},
        "google/gemini-2.5-flash": {}
      }
    }
  }
}
```

See [OpenRouter + OpenCode](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration) and [OpenCode providers](https://opencode.ai/docs/providers/) for model IDs and routing options.

#### GLM Coding Plan (Z.AI)

1. Get an API key from the [Z.AI API Console](https://docs.z.ai/scenario-example/develop-tools/opencode) (see Z.AI docs for your plan).
2. Authenticate OpenCode — use either `/connect` in the TUI or:
   ```sh
   opencode auth login
   ```
   Search for **Z.AI** and choose **Z.AI Coding Plan** (not the generic **Z.AI** provider; they use different endpoints and model IDs).
3. Enter your API key, then run `/models` and pick a model such as **GLM-4.7**.

Details: [Z.AI + OpenCode](https://docs.z.ai/scenario-example/develop-tools/opencode), [OpenCode providers — Z.AI](https://opencode.ai/docs/providers/#zai).

### Troubleshooting

- **Health not “Healthy”** — Confirm `opencode` is installed (`which opencode`) or use URL mode against a running `opencode serve`.
- **Empty model list** — Connect a provider in OpenCode first, then **Refresh model list** in SpecOps settings.
- **Auth errors** — Re-run `/connect` or fix `auth.json`; workspace sends never read HTTP keys from SpecOps **Chats → Providers**.
- **Legacy workspace chat** — Threads from the pre–phase-3 HTTP workspace provider are not migrated into OpenCode sessions.

More detail: `docs/providers.md` (Chat HTTP vs workspace), `specs/ops/phase-3/phase-3.md`.

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
