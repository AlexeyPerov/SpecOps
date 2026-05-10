# SpecOps

Desktop Markdown editor with live sanitized preview, built with **Electron**, **TypeScript**, and **Vite** (`electron-vite`). Normative behavior is specified under [`specs/`](specs/README.md) (especially [`Requirements.md`](specs/Requirements.md) and [`Requirements-UI.md`](specs/Requirements-UI.md)).

## Prerequisites

- **Node.js** matching [`package.json`](package.json) `engines.node` (currently **>= 20.17.0**).

## Scripts

| Command | Purpose |
| -------- | -------- |
| `npm install` | Install dependencies (`package-lock.json` is authoritative). |
| `npm run dev` | Development: Electron + Vite HMR. |
| `npm run build` | Production bundle to `out/` (main, preload, renderer). |
| `npm run preview` | Preview production build locally. |
| `npm test` | **Vitest** unit/integration tests (markdown snapshots use jsdom). |

## Architecture (high level)

- **Main process** ([`src/main/index.ts`](src/main/index.ts)): filesystem IO, native dialogs, document watcher, save serialization ([`src/main/saveSerialize.ts`](src/main/saveSerialize.ts)), persistence ([`src/main/persistence.ts`](src/main/persistence.ts)), application menu ([`src/main/menu.ts`](src/main/menu.ts)).
- **Preload** ([`src/preload/index.ts`](src/preload/index.ts)): exposes a typed `window.specOps` bridge via `contextIsolation` + `contextBridge` ([`src/preload/specOpsApi.ts`](src/preload/specOpsApi.ts)).
- **Renderer** ([`src/renderer/src/main.ts`](src/renderer/src/main.ts)): boots [`bootRenderer`](src/renderer/boot/rendererBoot.ts), binds theme controls, hydrates preferences/session from disk via IPC.
- **State** ([`src/core/state/`](src/core/state/)): pure reducer (`reduceAppState`), presentation helpers, session/preferences codecs ([`sessionCodec.ts`](src/core/state/sessionCodec.ts)).
- **Markdown**: **`MarkdownParser`** / **`MarkdownRenderer`** adapters only ([`src/app/services.ts`](src/app/services.ts)); default HTML pipeline under [`src/core/markdown/impl/`](src/core/markdown/impl/) with **DOMPurify** sanitization ([`sanitizePreviewHtml.ts`](src/core/markdown/impl/sanitizePreviewHtml.ts)).

**Security baseline:** `nodeIntegration: false`, **`contextIsolation: true`**, **`sandbox: true`** on `BrowserWindow`; untrusted preview HTML is sanitized (`NFR-06`–`NFR-08`).

## Phase coverage (representative requirement IDs)

Implementation pointers are indicative; specs remain authoritative.

| Scope | Requirement / phase IDs | Where it lives |
| ----- | ------------------------ | -------------- |
| MVP shell + preview | `PH-01`, `UPH-01`, `FR-01`–`FR-10`, `FR-11`–`FR-14`, `TEST-02` | [`rendererBoot.ts`](src/renderer/boot/rendererBoot.ts), preview host |
| Theme tokens | `UPH-02`, `FR-17`–`FR-18`, `UI-01`–`UI-05` | [`bindTheme.ts`](src/renderer/theme/bindTheme.ts), [`theme/*.css`](src/renderer/theme/) |
| Filesystem tooling | `PH-03`, `FR-32`–`FR-41`, `TEST-07`–`TEST-08` | Main IPC handlers, [`rendererBoot.ts`](src/renderer/boot/rendererBoot.ts), reducer transitions |
| Extended Markdown | `FR-44`, `TEST-09` | [`remarkMarkdownParser.ts`](src/core/markdown/impl/remarkMarkdownParser.ts), fixtures [`fixtures/markdown/test09/`](fixtures/markdown/test09/) |
| Editor productivity | `FR-42`–`FR-43`, `AC-26`–`AC-27` | [`findReplace.ts`](src/core/editor/findReplace.ts), [`editorHistory.ts`](src/renderer/editor/editorHistory.ts), find UI in [`rendererBoot.ts`](src/renderer/boot/rendererBoot.ts) |
| Persistence & recovery | `FR-45`–`FR-46`, `DATA-10`, `TEST-10` | [`persistence.ts`](src/main/persistence.ts), [`sessionCodec.ts`](src/core/state/sessionCodec.ts), [`sessionCodec.test.ts`](src/core/state/sessionCodec.test.ts) |
| Tooling UX / menu | `UPH-07`, `FR-48`–`FR-56`, `TEST-11`–`TEST-12` (manual checklist for UX alignment) | [`menu.ts`](src/main/menu.ts), toolbar + dirty indicator + DnD affordance in [`rendererBoot.ts`](src/renderer/boot/rendererBoot.ts) / [`app.css`](src/renderer/theme/app.css) |

For execution-order context see [`specs/ExecutionPlan.md`](specs/ExecutionPlan.md).

## Contributing / PR notes

Per **`DOD-06`**, link relevant **core** and **UI** requirement IDs in PR descriptions when behavior or UX changes (for example `FR-45`, `FR-55`, `AC-31`).
