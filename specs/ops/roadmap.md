# SpecOps agent sessions roadmap

**Updated:** 2026-10-04

**Status:** Active plan; foundation implemented with acceptance gaps, production adapters pending.

**Source of truth:** This roadmap and the linked milestone scope/execution plans. The [2026-10-04 audit](audit-2026-10-04.md) is historical evidence; its proposed order is adopted here. Folder prefixes and existing task IDs stay stable and do not prescribe delivery order.

## Product goal

Use popular coding agents with their native harness inside workspace Sessions. **Codex is the first production runtime.** The first user outcome is a Codex connection authenticated with account B in SpecOps while the separate desktop app remains on account A.

Native runtime owns the agent loop, tools, context management, policy enforcement and native history. SpecOps owns session navigation, normalized transcript and interaction UI, profile selection, activity visibility, diagnostics and reviewable handoff. An HTTP model wrapper is not an implementation of this goal. Native integration does not promise every feature of a vendor desktop application.

Notepad remains global and has no AI. Workspace contains editor, tree, version control and Sessions. There is no standalone Chat or Cloud context. Optional future cloud execution is a runtime extension.

## Current implementation state

| Milestone | Actual state | Next work |
| --- | --- | --- |
| [01 — Foundation](01-foundation-agent-host/README.md) | Historical A–F implemented; acceptance gaps open | Stabilization S before real-account work |
| [03 — Codex](03-codex-adapter/README.md) | Missing production adapter | A → B → C → D; optional later E |
| [04 — OpenCode](04-opencode-adapter/README.md) | Legacy SDK/client/sidecar code exists; no new-host adapter | A → B → D core cutover; C extensions later |
| [02 — Claude](02-claude-adapter/README.md) | Missing production adapter | A → B → C → D after Codex preview and OpenCode core |
| [06 — Shared delivery](06-handoff-release-polish/README.md) | Partial health/supervision; missing release acceptance | B/C early; A after two runtimes; D per release |
| [05 — Cursor](05-cursor-adapter/README.md) | Missing production adapter | Feasibility/auth/packaging spike → A–D after initial integrations |

A completed implementation marker is not a release acceptance record. All new phases below are Planned until their checks actually pass.

## Delivery order

| Slot | Plan | Result and gate |
| --- | --- | --- |
| 0 | [AS01-S](01-foundation-agent-host/execution-plan-phase-s-stabilization.md) | Production binding survives fresh-process restart; bounded I/O/shutdown; settled streams, safe errors and strengthened contract tests |
| 1 | [AS03-A](03-codex-adapter/execution-plan-phase-a-protocol-auth.md) | Pinned app-server, isolated profile/home, official account login/read/logout and neutral Sessions discovery/creation |
| 2 | [AS03-B](03-codex-adapter/execution-plan-phase-b-thread-events.md) | Developer slice: coding task, tools, approvals/questions, cancel and minimum native-thread resume |
| 3 | [AS03-C](03-codex-adapter/execution-plan-phase-c-capabilities-history.md), [AS06-B](06-handoff-release-polish/execution-plan-phase-b-observability.md), [AS06-C](06-handoff-release-polish/execution-plan-phase-c-packaging-diagnostics.md), then [AS03-D](03-codex-adapter/execution-plan-phase-d-hardening-exit.md) and AS06-D release gate | First usable installed Codex preview on macOS, account-B isolation, history reconciliation, quota/recovery, writer visibility and support diagnostics |
| 4 | [AS04-A → B → D](04-opencode-adapter/execution-plan.md) | Second native runtime; core parity and removal of legacy frontend/supervisor path; optional features explicitly deferred |
| 5 | [AS02-A → B → C → D](02-claude-adapter/execution-plan.md) | Third native runtime, current auth policy and tested capability coverage |
| 6 | [AS06-A](06-handoff-release-polish/execution-plan-phase-a-handoff.md), [AS04-C](04-opencode-adapter/execution-plan-phase-c-extensions-ui.md), [AS03-E](03-codex-adapter/execution-plan-phase-e-multi-profile.md) | Reviewable handoff, valuable native extensions and multiple simultaneous SpecOps Codex profiles |
| 7 | [AS05-A → B → C → D](05-cursor-adapter/execution-plan.md) | Cursor with pinned SDK and verified auth, capabilities, history and native assets |
| 8 | [AS06-D](06-handoff-release-polish/execution-plan-phase-d-release-exit.md) | Final matrix and roadmap closure after all active scope is verified; the same gate already runs for earlier subset releases |

OpenCode is second because code and fixtures already exist. If its core cutover proves larger than a new Claude adapter, record an explicit swap of slots 4/5 without moving Codex off the critical path. Handoff is technically eligible after two accepted runtimes; its default delivery slot is 6. No implementation needs to wait for Cursor to release Codex.

### Dependency graph

```text
01-S → 03-A → 03-B → 03-C ───────────────┐
                    ├→ 06-B ───────────┼→ 03-D → 06-D (Codex release)
                    └→ 06-C ───────────┘
03-D → 04-A → 04-B → 04-D → 02-A → 02-B → 02-C → 02-D
04-D → 04-C (later optional extensions)
03-D → 03-E (later multiple SpecOps profiles)
accepted runtimes >= 2 + 06-B/C → 06-A (later handoff)
accepted core/contract evidence → 05-A → 05-B → 05-C → 05-D
selected adapter gates + 06-B/C + advertised handoff → 06-D (each release)
```

06-B and 06-C have no dependency on handoff or later adapters. Packaging design/build preparation may start after 01-S; its runtime smoke uses 03-B. Readiness for future adapters is validated when they are added, not by blocking the Codex preview.

## Session and connection model

Creation: runtime → connection profile → model → supported reasoning/collaboration settings → sandbox/approval policy → optional native settings. These controls are distinct fields rather than an overloaded mode. Unsupported controls are hidden or explained; descriptors come from tested runtime behavior.

Session's runtime and profile are immutable once its native binding is created. Draft selection may change before that binding. Switching runtime/profile creates a new session or handoff; it never silently resumes a thread with another account.

Persist the binding through the production writer, including `runtimeId`, `connectionProfileId`, `nativeSessionId`, selected settings and lineage. Native history is authoritative; normalized transcript is a cache keyed by native item/turn identity. A missing profile or native thread is an actionable state, not permission to create a replacement thread.

Profiles are application-scoped connections; sessions remain workspace-scoped. A profile can serve several workspace threads. Profile metadata contains no credentials. Auth progress and account/limit updates are control-plane events independent of a turn.

## Runtime architecture and boundaries

```text
SpecOps WebView → Tauri IPC → supervised Agent Host
                               ├→ Codex profile → app-server → workspace
                               ├→ OpenCode adapter → runtime → workspace
                               ├→ Claude adapter → native SDK → workspace
                               └→ Cursor adapter → native SDK → workspace
```

- No vendor SDK/process in the WebView; Tauri supervises Agent Host, host owns runtime children.
- Codex app-server instances are profile-scoped, not switched between account logins. One instance may serve multiple native threads.
- Request/event keys include runtime, profile, native session, turn and process generation as appropriate. Equal native IDs in two profiles cannot collide.
- Host assigns normalized sequence/cursor where native protocol does not supply one. Retain native item/turn IDs separately for reconciliation.
- Adapter-child failure affects its profile/runtime; whole-host failure settles all its in-flight turns and retains bindings for explicit resume.
- Vendor schema/version checks reflect the pinned executable's actual interface. Unknown additive events become bounded redacted diagnostics; incompatible required payloads fail explicitly. Do not invent native protocol-version negotiation.
- Bounded UTF-8 framing, backpressure, request deadlines, terminal delivery and process-tree cleanup are prerequisites, not final polish.
- Keep the mandatory session core small. Discovery, catalog, auth lifecycle and optional capabilities use explicit control-plane/extension contracts; add profile identity consistently across every boundary.

### Common contract requirements

The mandatory native session core covers create, resume, streamed send and cancel,
with runtime descriptor/capability and health reporting. Authentication and catalogs
remain explicit control-plane operations, not messages disguised as turns. Optional
fork/rewind/checkpoint/share/summarize, todos/plans, MCP/skills/commands/hooks/subagents,
provider/model management, cost/limits and future cloud behavior use capability-gated
extensions. Never advertise an extension merely because its capability enum exists.

Every normalized event carries SpecOps session/turn identity where applicable,
runtime/profile identity, timestamp, stable kind, normalized payload and host sequence
or cursor. Keep native thread/item/turn IDs separate for replay and cache reconciliation.
Diagnostics use bounded redacted data; raw native payload retention is not permission
to persist credentials or tool output by default. Profile-aware request/reply routing
and generation checks apply equally to permissions, questions and control-plane events.

## Authentication and configuration

Use supported official mechanisms, verified against pinned runtime documentation before implementation:

| Runtime | Baseline | Additional policy |
| --- | --- | --- |
| Codex | API key; official ChatGPT browser/device login where available | SpecOps-owned home/auth, explicit file storage initially; keyring requires namespace-isolation evidence |
| OpenCode | Native provider authentication/configuration | Host-owned profile scope; no frontend provider secret state |
| Claude | API key / supported cloud credentials | Recheck current subscription/embedding policy; enable additional login only with documented supported flow |
| Cursor | Supported user/service API keys | Evaluate official browser-assisted login and storage during Phase A spike |

Codex profile home lives outside the project in app data. Pass `CODEX_HOME` to the child only. Control inherited auth/provider environment so another account's credentials cannot override selected profile auth; preserve necessary workspace environment. Never copy default home/auth into SpecOps as setup.

Config, skills, MCP/plugins and other native features have explicit workspace/profile scope. Feature ledger distinguishes native execution, UI display and UI configuration. Only tested features are advertised; global settings must not disappear silently when using a new profile.

Credentials remain host/native-store owned. They are excluded from frontend settings/snapshots, transcripts, raw-event diagnostics, error messages, support exports and handoff. Exclude sensitive auth URL query/device code fields from diagnostics and use allowlisted output plus canary tests.

## Shared workspace

All local sessions use real workspace `rootPath` as `cwd`. No automatic worktrees, writer locks, branches, commits, stash, rollback or serialization. Show active sessions and profile/runtime identity, warn when another writer starts, refresh tree/editor/git evidence after external edits and report overlap only as best-effort information. Continue stays available; Stop cancels work and does not undo files. Filesystem effects remain ordinary shared workspace changes.

## Handoff

After two runtimes are accepted, user reviews a bounded packet with goal, decisions/summary, relevant paths, changed files/diff and optional selected excerpts. Raw tool output and secrets are excluded by default. Selection includes target profile. Confirmation creates a new target-native session, sends the approved prompt and persists SpecOps lineage; source history remains unchanged. Retry must not duplicate hidden sessions. Native IDs/history are not portable across runtimes or accounts.

## Release policy and acceptance

- First usable preview targets macOS and Codex only. Its gates are 01-S, 03-A–D, 06-B/C and a selected-scope 06-D record.
- Bundle Agent Host and a compatible Node runtime; developer PATH is not installed-build evidence. Vendor binary may be bundled/installed where permitted or explicitly user-managed with version/setup diagnostics.
- 03-B is a developer slice, not an installed-product readiness claim. Minimal history/cancel/approvals are required there, not deferred to final polish.
- Neutral Sessions gate replaces provider-shaped settings. Each adapter/profile has independent setup/health state. No beta release is gated on complete legacy feature parity or all four runtimes.
- API-key and account smokes are explicit opt-in runs. Record selected version, account access category, support scope and unavailable auth methods without inferring model entitlement from catalog listing.
- Before adding Linux/Windows support, verify install, auth, resume, crash, cancel and child/grandchild cleanup on each advertised target.
- Release readiness is per enabled runtime/platform subset. Roadmap Done requires all active phases, including later extensions/multiple profiles and advertised handoff, or an explicit scope revision. Do not mark missing implementations Done through a deferment note.
- Native/history schemas may reset cleanly; no data migrations, compatibility codecs or upgrade paths for persisted data. Document resets when implementation lands.

## Completion evidence

Each phase records automated checks, pinned contracts and actual smoke/support evidence. No task becomes Done merely because a mock suite is green. Full roadmap completion adds independent Codex/OpenCode/Claude/Cursor sessions, native resume where supported, capability honesty, selected-profile isolation, concurrent-writer visibility, reviewable handoff and orphan-free installed builds.

## Changelog

| Date | Change |
| --- | --- |
| 2026-10-04 | Adopt Codex-first order; reopen foundation acceptance as S; isolated account profiles; early activity/packaging; OpenCode core before extensions; subset release gates |
| 2026-08-15 | Historical foundation implementation A–F marked Done; acceptance gaps subsequently recorded |
| 2026-08-11 | Replaced Chat/Cloud/per-workspace roadmap with native per-session runtime direction |

Historical completed/cancelled plans remain under `specs/archive/ops-done` and `specs/archive/ops-postponed`. Historical implementation notes and audit snapshots are evidence, not active task dependencies.
