# Phase 3.5 Milestone 14 Execution Plan — OpenCode sidecar tooling & port settings

**Spec:** [phase-3.5.md](./phase-3.5.md)  
**Index:** [execution-plan.md](./execution-plan.md)  
**Prerequisite:** [execution-plan-m13.md](./execution-plan-m13.md) (optional; no hard dependency)

**Status:** DONE

**Goal:** make OpenCode sidecar maintenance and configuration explicit in the repo:

1. **Manual sidecar binary refresh** — a developer script to download OpenCode CLI
   releases into Tauri's `externalBin` layout, callable on demand (not in CI).
2. **Configurable sidecar port** — add persisted `sidecarPort` (Option A) so sidecar
   mode no longer hardcodes `4096` in Rust; keep `baseUrl` in sync for health checks
   and SDK client wiring.

Workspace agents remain the stable product path. URL mode is unchanged except for
clearer separation from sidecar port settings.

How to use this plan: each task lists **Required context** — read only those docs for
that task. Cross-cutting **Confidence and Risks** below applies to every task.

---

## Problem

Today:

1. **Sidecar binaries are manually committed** at
   `app/src-tauri/binaries/opencode-<target-triple>` with no repo script to refresh
   them from upstream releases. Maintainers must download/rename by hand.
2. **SDK and binary versions can drift** — e.g. `@opencode-ai/sdk` at `^1.17.7` while
   the bundled macOS binary reports `1.17.4`; lockfiles are gitignored so npm installs
   can float within the caret range.
3. **Sidecar port is hardcoded** in Rust (`DEFAULT_SIDECAR_PORT = 4096`). Settings
   `baseUrl` defaults to `http://127.0.0.1:4096` but sidecar spawn ignores user
   changes to that field; only URL mode uses `baseUrl`.
4. **Port collisions** on `4096` force users into URL mode even when they only need a
   different local port.

## Scope

### In scope

| Area | Change |
| --- | --- |
| `scripts/update-opencode-sidecar.sh` | Manual CLI to fetch GitHub release assets → Tauri binary names |
| `app/package.json` | Optional npm script alias (e.g. `update-opencode-sidecar`) |
| Persisted settings | `opencode.sidecarPort: number`, default `4096` |
| Rust sidecar | Accept port on attach/start/restart; apply before `opencode serve` |
| TS bridge + effects | Pass `sidecarPort` into Tauri `invoke`; restart sidecar on change |
| Settings UI | Sidecar port field when mode is `sidecar`; validation + reconnect |
| Docs | `docs/opencode-integration.md`, `binaries/README.md`, script usage |
| Tests | Settings normalize/validate, sidecar invoke args, Rust unit tests |

### Out of scope

| Area | Reason |
| --- | --- |
| CI auto-download of OpenCode binaries | Explicit manual maintainer step; release workflow unchanged |
| Committing `package-lock.json` | Separate decision; script may *suggest* SDK bump only |
| Configurable sidecar hostname | Stay `127.0.0.1`; URL mode covers remote hosts |
| Data migrations / upgrade shims | Per AGENTS.md — missing `sidecarPort` normalizes to `4096` |
| Auto-sync SDK version on script run | Optional `--bump-sdk` flag at most; not required for M14 exit |

## Assumptions

- OpenCode CLI releases publish assets named `opencode-darwin-arm64`, `opencode-darwin-amd64`,
  `opencode-linux-amd64`, `opencode-linux-arm64`, `opencode-windows-amd64.exe` on
  [anomalyco/opencode releases](https://github.com/anomalyco/opencode/releases).
- Tauri `externalBin` expects `opencode-<rust-target-triple>` (see existing
  `opencode-aarch64-apple-darwin`).
- Sidecar continues to use `opencode serve --hostname 127.0.0.1 --port <n>`.
- In sidecar mode, `baseUrl` is derived/synced from hostname + `sidecarPort` for display
  and health consistency (not a free-form URL field).

## Confidence and Risks

Confidence: High.

Resolved constraints:

1. Sidecar spawn and health probe paths are centralized in `opencode_sidecar.rs`.
2. Settings normalization pattern exists (`opencodeSettings.ts`, `opencode.enabled`).
3. Tauri commands already return `port` and `baseUrl` in `OpencodeSidecarStatus`.

Residual uncertainties:

1. **GitHub asset naming changes** — script should fail loudly with release URL; document
   manual fallback in `binaries/README.md`.
2. **Port change while sidecar running** — restart sidecar when `sidecarPort` changes
   (same pattern as transport mode / password reconnect).
3. **Invalid persisted port** — normalize to `4096` with validation blocking save in UI
   (1024–65535, integer).

## Decisions applied

| ID | Decision | Implication |
| --- | --- | --- |
| O1 | Manual update script, not CI | `scripts/update-opencode-sidecar.sh`; no release.yml changes |
| O2 | Option A: explicit `sidecarPort` | New field on `OpencodeSettings`; not parsed from URL in sidecar mode |
| O3 | Default port `4096` | Matches current behavior; missing/invalid → `4096` |
| O4 | Sync `baseUrl` in sidecar mode | `http://127.0.0.1:${sidecarPort}` when port changes |
| O5 | Pass port into Tauri commands | Extend `opencode_sidecar_*` invoke args; Rust sets `inner.port` before spawn |
| O6 | Script maps release asset → triple | Document mapping table in script header + `binaries/README.md` |
| O7 | Optional `--version` pin | Default `latest`; support `v1.17.7` tag for reproducible updates |
| O8 | Optional `--platform current\|all` | `current` for local dev; `all` for release prep on maintainer machine |

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

---

## Task Breakdown

#### Task 1: Sidecar binary update script (M14-T1) [Score:5] [Agent:easy] [DONE]

**Required context**

1. `app/src-tauri/binaries/README.md` — Tauri naming convention
2. `app/src-tauri/tauri.conf.json` — `externalBin: ["binaries/opencode"]`
3. `app/package.json` — `@opencode-ai/sdk` version (for optional bump hint)
4. [OpenCode GitHub releases](https://github.com/anomalyco/opencode/releases)

- Add `scripts/update-opencode-sidecar.sh` (bash, `set -euo pipefail`):
  - Args: `--version latest|vX.Y.Z`, `--platform current|all`, optional `--check-only`.
  - Download from `https://github.com/anomalyco/opencode/releases/<tag>/download/<asset>`.
  - Write to `app/src-tauri/binaries/opencode-<triple>`, `chmod +x`.
  - Run `opencode-<triple> --version` (or `--version` on copied binary) after install.
  - Print summary: old vs new version, paths updated, reminder to commit binaries.
- Asset → triple mapping (minimum):
  - `opencode-darwin-arm64` → `aarch64-apple-darwin`
  - `opencode-darwin-amd64` → `x86_64-apple-darwin`
  - `opencode-linux-amd64` → `x86_64-unknown-linux-gnu`
  - `opencode-linux-arm64` → `aarch64-unknown-linux-gnu`
  - `opencode-windows-amd64.exe` → `x86_64-pc-windows-msvc.exe`
- Add npm script in `app/package.json`: `"update-opencode-sidecar": "bash ../scripts/update-opencode-sidecar.sh"`.
- Update `app/src-tauri/binaries/README.md` with script usage and mapping table.

**Acceptance checklist**

- `./scripts/update-opencode-sidecar.sh --platform current` updates local triple on maintainer OS.
- `--check-only` reports bundled vs latest without writing.
- Script fails with clear message if asset URL 404s.
- `binaries/README.md` documents manual and scripted update paths.

Dependencies: none.

---

#### Task 2: Settings schema — `sidecarPort` (M14-T2) [Score:5] [Agent:easy] [DONE]

**Required context**

1. `app/src/lib/domain/settings.ts` — `OpencodeSettings`
2. `app/src/lib/services/opencodeSettings.ts` — defaults, normalize, validate
3. `app/src/lib/services/settingsStore.ts` — persisted load/save
4. `app/src/lib/services/opencodeSettings.test.ts`

- Extend `OpencodeSettings`:
  ```ts
  sidecarPort: number; // default 4096
  ```
- Add `defaultOpencodeSettings.sidecarPort = 4096`.
- `normalizeOpencodeSettings`: missing/non-integer/out-of-range → `4096`; clamp valid
  integers to 1024–65535.
- Add `validateOpencodeSidecarPort(port: number): string | null`.
- Add `buildOpencodeSidecarBaseUrl(port: number): string` → `http://127.0.0.1:${port}`.
- When normalizing or applying port changes in sidecar mode, keep `baseUrl` synced via
  helper (export for UI/effects).
- Wire through `settingsStore` normalize/toPersisted paths.
- Unit tests: default, legacy missing field, invalid values, boundary 1024/65535.

**Acceptance checklist**

- Fresh install persists `sidecarPort: 4096`.
- Legacy settings without `sidecarPort` normalize to `4096`.
- `npm test` for opencode settings passes.

Dependencies: none (can parallel with Task 1).

---

#### Task 3: Rust sidecar — configurable port (M14-T3) [Score:7] [Agent:medium] [DONE]

**Required context**

1. Task 2 output (port semantics)
2. `app/src-tauri/src/opencode_sidecar.rs` — spawn, health, Tauri commands
3. Existing Rust tests at bottom of `opencode_sidecar.rs`

- Add optional `port: Option<u16>` parameter to:
  - `opencode_sidecar_attach_workspace`
  - `opencode_sidecar_start`
  - `opencode_sidecar_restart`
- On invoke: if `port` is `Some(p)`, set `inner.port = p` before `start_or_attach`;
  if `None`, keep existing `inner.port` (or default `4096` on fresh state).
- When port changes while a child is running, stop and respawn (reuse `start_or_attach`
  flow after `stop_child`).
- Ensure `OpencodeSidecarStatus.port` and `base_url` reflect configured port.
- Update port-in-use error messages to use actual port, not hardcoded `4096` in tests.
- Add/update Rust unit tests for port parameter and status fields.

**Acceptance checklist**

- Sidecar listens on configured port (manual smoke: `curl` health endpoint).
- Port change triggers restart on next attach.
- `cargo test` in `app/src-tauri` passes.

Dependencies: Task 2 (contract); can start with hardcoded test port before TS wiring.

---

#### Task 4: TS bridge, effects, and backend wiring (M14-T4) [Score:8] [Agent:medium] [DONE]

**Required context**

1. Tasks 2–3 output
2. `app/src/lib/services/opencodeSidecar.ts` — `invoke` wrappers
3. `app/src/lib/services/appShellEffects.ts` — `syncOpencodeSidecarEffect`, health refresh
4. `app/src/lib/ai/backends/workspaceAgentBackend.ts` — `attachOpencodeSidecarWorkspace`
5. `app/src/lib/ai/backends/opencodeBackendFactory.ts` — runtime config
6. `app/src/routes/+page.svelte` — effect inputs

- Extend `attachOpencodeSidecarWorkspace`, `startOpencodeSidecar`, `restartOpencodeSidecar`
  to accept `{ directory, port }` (port from settings).
- Pass `opencode.sidecarPort` from app shell effects into sidecar attach on workspace open
  and health refresh.
- `opencodeBackendFactory` / runtime config: include `sidecarPort` where sidecar attach runs.
- On port change in settings (sidecar mode): trigger reconnect (health → checking, re-attach).
- Remove or narrow hardcoded `DEFAULT_OPENCODE_BASE_URL` / `4096` literals where settings
  should be source of truth; keep constant only as default fallback in normalize.
- Update tests: `opencodeSidecar.test.ts`, `appShellEffects.opencodeSidecar.test.ts`,
  `workspaceAgentBackend.test.ts` stubs as needed.

**Acceptance checklist**

- Workspace agent requests hit `http://127.0.0.1:<sidecarPort>` after sidecar attach.
- Changing port in persisted settings re-attaches sidecar on next effect cycle.
- Unit tests pass.

Dependencies: Tasks 2–3.

---

#### Task 5: OpenCode settings UI — sidecar port (M14-T5) [Score:6] [Agent:medium] [DONE]

**Required context**

1. Tasks 2 and 4 output
2. `app/src/lib/components/settings/OpenCodeSettingsPanel.svelte`
3. `OpenCodeSettingsPanel` patterns for mode/baseUrl/server password

- When `mode === "sidecar"`, show numeric **Sidecar port** input (not the URL field).
- When `mode === "url"`, keep existing **Server URL** field; hide sidecar port.
- On port edit:
  - Validate with `validateOpencodeSidecarPort`.
  - Persist `sidecarPort` and synced `baseUrl` via `buildOpencodeSidecarBaseUrl`.
  - Trigger reconnect state (same as mode/password change).
- Add concise tooltip: default 4096; change if port already in use locally.
- Optional read-only hint showing effective sidecar URL derived from port.

**Acceptance checklist**

- Sidecar mode shows port control; URL mode unchanged.
- Invalid port shows inline validation message; not persisted.
- Settings panel reconnect flow works after port change.

Dependencies: Tasks 2, 4.

---

#### Task 6: Documentation and validation (M14-T6) [Score:4] [Agent:easy] [DONE]

**Required context**

1. All prior tasks
2. `docs/opencode-integration.md`
3. `specs/ops/phase-3.5/execution-plan.md`
4. `README.md` — sidecar notes if present

- Update `docs/opencode-integration.md`:
  - Sidecar port setting (default 4096, Settings → Workspaces → OpenCode).
  - Binary update script usage and version pinning notes.
  - Clarify SDK vs bundled binary versioning.
- Add M14 row to `execution-plan.md` (post-M13 subsection).
- Run validation: `npm test`, `npm run check`, `cargo test`.
- Mark tasks DONE in this file; changelog entry at milestone completion.

**Acceptance checklist**

- Docs describe script, port setting, and dev PATH fallback accurately.
- `execution-plan.md` indexes M14.
- Full test suite green.

Dependencies: Tasks 1–5.

---

## Exit criteria

- `scripts/update-opencode-sidecar.sh` exists; documented; npm alias available.
- `opencode.sidecarPort` persisted, default `4096`, validated 1024–65535.
- Rust sidecar spawns on configured port; TS passes port on attach/restart.
- Settings UI exposes sidecar port in sidecar mode; `baseUrl` stays in sync.
- `docs/opencode-integration.md` and `binaries/README.md` updated.
- `npm test` / `npm run check` / `cargo test` pass.

## Notes

- **Option A (explicit `sidecarPort`)** avoids overloading `baseUrl` in sidecar mode and
  keeps URL mode semantics unchanged.
- The update script is for **maintainers**, not end users. Release CI still bundles
  whatever binaries are committed at tag time.
- After running the update script, consider aligning `@opencode-ai/sdk` in `package.json`
  to the same release version manually (script may print a reminder; automatic bump is
  optional follow-up).
