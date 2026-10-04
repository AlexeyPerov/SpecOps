# AS04-A — Host bootstrap evidence and parity ledger

**Updated:** 2026-10-04 20:05 MSK
**State:** Source implementation verified; upstream AS02-D installed/account acceptance remains open.

## Ownership and pinned contract

Agent Host imports its own exact `@opencode-ai/sdk` 1.17.4 dependency and accepts native runtime 1.17.4 only. The existing bundled macOS arm64 binary reports this version. `app/host/package-lock.json` is tracked and `npm ci --ignore-scripts` reproduces the host dependency installation. Tauri resolves the bundled executable and passes its absolute path; `SPECOPS_OPENCODE_EXECUTABLE` overrides it without silent fallback, followed by host PATH discovery for standalone execution.

`SPECOPS_OPENCODE_OWNER` is a process-start gate: `host` is the default; `legacy` is explicit temporary parity mode. Invalid values fail closed. Host mode registers the new adapter and rejects Rust legacy spawn/attach/restart. Legacy mode registers no new adapter. Restart the app to change the gate; there is no mutable frontend ownership switch. Existing legacy SDK and Rust supervisor files remain only until 04-C removal. The shared app still supervises only Agent Host on the new path.

Each local profile has its own private home, XDG data/config/cache/state and native config. Provider environment secrets and runtime control overrides are removed. Native runtime launches in the profile home, with a unique ephemeral loopback port and random host-only HTTP password. Native output is consumed but never forwarded. Existing endpoints are never adopted after a local launch fails. Profile auth uses native API credentials in the selected home; native credential mode is secured to 0600 after auth and before launch. Credentials never enter profile snapshots or metadata. Workspace-native instructions/config remain native authoritative inputs; this isolation does not sanitize a workspace's deliberate native config or plugin behavior.

External profiles persist an explicitly declared HTTP loopback or HTTPS origin. Host probes their pinned version but neither starts/stops the external server nor mutates its credentials. Server-account isolation and authenticated external endpoints are unsupported in this slice; the owner must manage them. OAuth/device/provider-specific flows are explicitly unavailable until a supported host flow has evidence.

Local crash/restart/shutdown clears the client and rejects stale provider/catalog results. Observed descendants are killed with PID birth-time verification; the child stays in the Agent Host process group so supervisor whole-host termination can clean the group. The immediate spawn/exit descendant discovery race and installed platform cleanup remain acceptance gates shared with foundation supervision. The adapter does not promise core turns yet; phase B owns them.

## Finite feature ledger

| Legacy category / existing source | Classification / owner | Required evidence before cutover |
| --- | --- | --- |
| Frontend SDK/client; backend factory; runtime config | Remove in 04-C; host owns replacement in A/B | No WebView SDK or secret state, one supervisor |
| Rust sidecar start/attach/config/auth/stop/restart | Replacement A; remove in 04-C | Gate fixtures, native bootstrap and process cleanup |
| Provider catalog/models/auth/profile config | Required core A/B/C | Native profile binding, restart, selected-provider auth, model selection and control-plane fixtures |
| Primary agents/modes | Required core A/B/C catalog | Native agent catalog and selectable mode parity |
| Session create/list/read/resume/history/missing state | Required core B/C | Restart through production persistence, native history hydration, no replay |
| Send/text/reasoning/tools/steps/subtasks/file changes/usage/errors | Required core B/C | Stable IDs/cursor/generation, bounded mapper and terminal fixtures |
| Permission/question/cancel/interruption | Required core B/C | Correlation, exactly-once resolution, expiry/timeout, hung-stream cleanup |
| Reconnect/compaction notification and continue | Required core B/C normalization | Preserve interrupted state, explicit resume; never resend silently |
| Fork/revert/unrevert | Retained later 06-B checkpoint extension | Explicitly unavailable until native extension and UI tests pass |
| Share/unshare | Retained later 06-B share extension | Explicit opt-in and native controls; no automatic sharing |
| Manual summarize | Retained later 06-B lifecycle extension | Explicit capability/action; compaction event core remains B |
| Slash commands and command catalog | Retained later 06-B command extension | Native schema, argument dispatch, capability UI |
| Text/file/symbol search | Deferred to future workspace integration owner | Not a core turn requirement; workspace file context remains app-owned |
| Todos | Retained later 06-B todo extension | Native projection/reconciliation and panel fixtures |
| Session diffs and file status | Retained later 06-B diffs extension | Native fetch/panel state; event file changes are core B |
| Language services, formatter diagnostics | Retained later 06-B diagnostics extension | Native status/actions and capability UI |
| MCP server catalog/auth/connect/disconnect | Retained later 06-B MCP extension | Host credential boundary and management fixtures |
| Skills and custom/subagents management | Retained later 06-B skills/config extensions | Catalog and profile/workspace scope; basic primary-agent selection is core |
| Rich provider configuration/editor | Retained later 06-B configuration extension | Supported native schema; A seeds and persists isolated config only |
| Export | Deferred to product export owner | Local transcript export can be implemented independently; no cutover parity requirement |
| Native web/TUI/PTTY management | Deferred to native management owner | No Sessions product surface or core gate |

The old `app/src/lib/ai/backends/opencode*.test.ts`, workspace backend fixture suites, resource/catalog/config tests and Rust sidecar tests are the comparison corpus for B/C. Retaining these files proves no new Sessions feature. A's new corpus is `app/host/src/opencode/bootstrap.test.ts` plus `nativeFixture.mjs`; B must replace the bounded control-plane fetch with a separate cancellable SSE fetch before streaming.

## Recorded verification

- Host: 125 passing tests, 1 opt-in native smoke skipped in ordinary suite; host TypeScript/build pass.
- Explicit bundled-native smoke: 8/8 bootstrap tests passed with `SPECOPS_NATIVE_SMOKE` pointing at the existing arm64 binary. Used only a temporary home and no account credentials. Validated health/version, primary-agent discovery and child shutdown. Native built-in free-provider availability can report authenticated readiness even without a credential file; this is provider availability, not proof of an authenticated paid account.
- Deterministic fixture: profile persistence/collision separation, orphan/corrupt isolation, endpoint/override/gate validation, credential redaction and 0600 mode, native auth persistence/logout/restart, observed descendant cleanup, stale provider reply rejection, offline health.
- Frontend check: zero errors/warnings. Rust Agent Host: 17/17 tests passed.

Open acceptance: AS02-D accepted installed/live-account baseline; real paid-provider auth/inference and account separation; UI/installed runtime-owner switch; Windows/Linux packaged bootstrap/tree cleanup; immediate child-exit descendant race. No live-account, installed-app or release acceptance is claimed. B/C can implement source parity independently, but final acceptance must retain these gates.
