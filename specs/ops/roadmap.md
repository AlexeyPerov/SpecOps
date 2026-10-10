# SpecOps agent sessions roadmap

**Updated:** 2026-10-10

**Status:** Active acceptance plan; four native adapters, reviewed handoff/extensions/profiles and repeatable release records are source verified. Authenticated, signed installed, distribution and process gates remain open; expanded release is blocked. Stage 09 adds on-demand Node/agent delivery; A/B contracts and artifact security are source verified, while installer/runtime/release acceptance is open.

**Source of truth:** This roadmap and the linked milestone scope/execution plans. The [2026-10-04 audit](done/reviews/audit-2026-10-04.md) is historical evidence; its proposed order is adopted here. Active folders and task IDs are numbered in the default delivery order; shared early gates and repeated release acceptance are explicit exceptions. Completed records are in [done](done/README.md).

## Product goal

Use popular coding agents with their native harness inside workspace Sessions. **Codex is the first production runtime.** The first user outcome is a Codex connection authenticated with account B in SpecOps while the separate desktop app remains on account A.

Native runtime owns the agent loop, tools, context management, policy enforcement and native history. SpecOps owns session navigation, normalized transcript and interaction UI, profile selection, activity visibility, diagnostics and reviewable handoff. An HTTP model wrapper is not an implementation of this goal. Native integration does not promise every feature of a vendor desktop application.

Notepad remains global and has no AI. Workspace contains editor, tree, version control and Sessions. There is no standalone Chat or Cloud context. Optional future cloud execution is a runtime extension.

## Current implementation state

| Milestone | Actual state | Next work |
| --- | --- | --- |
| [01 — Stabilization](01-foundation-stabilization/README.md) | S accepted on source-checkout macOS; downstream gates open | S before live account work |
| [02 — Codex](02-codex-adapter/README.md) | A–G native harness/session controls/ecosystem/activity source verified; selected rollback/plugins/OAuth unavailable; live-account/installed gates open | Real account native controls and 03-A/B installed gates before closure |
| [03 — Preview delivery](03-codex-preview-delivery/README.md) | Shared activity/packaging/recovery source extends across four runtimes; installed acceptance open | Signed installed activity/resolve/recovery/process verification |
| [04 — OpenCode](04-opencode-adapter/README.md) | A/B/C host/core/cutover source verified; installed/account acceptance open | Installed/live/native-extension acceptance |
| [05 — Claude](05-claude-adapter/README.md) | A–D source native SDK/API key/sessions/interactions/policy/recovery/security implemented; installed/live baseline open | Installed/live acceptance |
| [06 — Handoff/native extensions](06-handoff-native-extensions/README.md) | A/B/C source verified; 16 ordered handoff pairs/native extensions/simultaneous Codex profiles; live/installed gates open | Actual account handoff/extensions/two-profile and installed acceptance |
| [07 — Cursor](07-cursor-adapter/README.md) | A–D local SDK/profile/lifecycle/settings/fault/security/16-pair handoff source and copied assets verified; native/authenticated/installed/distribution gates open | External D acceptance and selected 08-A gate |
| [08 — Release gates](08-release-gates/README.md) | Versioned expanded source record/validator/runner verified; release blocked | External selected-scope gates; repeat for 09 and close after full active scope |
| [09 — Plugin-based usage](09-plugin-based-usage/README.md) | A/B/C and D-02/D-04 source contracts/security accepted; 34 open tasks incl. release/integration gates | Native installer, shared Node and four optional agent components; lean installed release |

A completed implementation marker is not a release acceptance record. Implemented source phases retain explicit external acceptance; the dated [expanded AS08-A decision](08-release-gates/release-2026-10-05.md) is blocked. A source marker does not close the roadmap.

## Delivery order

| Stage | Plan | Result and gate |
| --- | --- | --- |
| 01 | [AS01-S](01-foundation-stabilization/execution-plan-phase-s-stabilization.md) | Production binding survives fresh-process restart; bounded I/O/shutdown; settled streams, safe errors and strengthened contract tests |
| 02 | [AS02-A](02-codex-adapter/execution-plan-phase-a-protocol-auth.md) | Pinned app-server, isolated profile/home, official account login/read/logout and neutral Sessions discovery/creation |
| 02 | [AS02-B](02-codex-adapter/execution-plan-phase-b-thread-events.md) | Developer slice: coding task, tools, approvals/questions, cancel and minimum native-thread resume |
| 02 / 03 | [AS02-C](02-codex-adapter/execution-plan-phase-c-capabilities-history.md), [AS03-A](03-codex-preview-delivery/execution-plan-phase-a-observability.md), [AS03-B](03-codex-preview-delivery/execution-plan-phase-b-packaging-diagnostics.md), then [AS02-D](02-codex-adapter/execution-plan-phase-d-hardening-exit.md) and AS08-A release gate | First usable installed Codex preview on macOS, account-B isolation, history reconciliation, quota/recovery, writer visibility and support diagnostics |
| 04 | [AS04-A → B → C](04-opencode-adapter/execution-plan.md) | Second native runtime; core parity and removal of legacy frontend/supervisor path; optional features explicitly deferred |
| 05 | [AS05-A → B → C → D](05-claude-adapter/execution-plan.md) | Third native runtime, current auth policy and tested capability coverage |
| 06 | [AS06-A](06-handoff-native-extensions/execution-plan-phase-a-handoff.md), [AS06-B](06-handoff-native-extensions/execution-plan-phase-b-opencode-extensions.md), [AS06-C](06-handoff-native-extensions/execution-plan-phase-c-codex-profiles.md) | Reviewable handoff, valuable native extensions and multiple simultaneous SpecOps Codex profiles |
| 07 | [AS07-A → B → C → D](07-cursor-adapter/execution-plan.md) | Cursor with pinned SDK and verified auth, capabilities, history and native assets |
| 08 | [AS08-A](08-release-gates/execution-plan-phase-a-release-exit.md) | Recurring selected release matrix; final closure after all active scope, including 09; earlier subset releases remain independent |
| 09 | [AS09-A → B → C → D → E → F → G → H](09-plugin-based-usage/execution-plan.md) | Lean editor-only base; shared Node and four native runtime payloads installed on explicit request; trusted updates/removal and fresh selected 08-A installed acceptance |

OpenCode is second because code and fixtures already exist. If its core cutover proves larger than a new Claude adapter, record an explicit scheduling swap of stages 04/05 without moving Codex off the critical path. Handoff is technically eligible after two accepted runtimes; its default delivery stage is 06. No implementation needs to wait for Cursor to release Codex.

### Dependency graph

```text
01-S → 02-A → 02-B → 02-C ───────────────┐
                    ├→ 03-A ───────────┼→ 02-D → 08-A (Codex release)
                    └→ 03-B ───────────┘
02-D → 04-A → 04-B → 04-C → 05-A → 05-B → 05-C → 05-D
04-C → 06-B (later optional extensions)
02-D → 06-C (later multiple SpecOps profiles)
accepted runtimes >= 2 + 03-A/B → 06-A (later handoff)
accepted core/contract evidence → 07-A → 07-B → 07-C → 07-D
selected adapter gates + 03-A/B + advertised handoff → 08-A (each release)
01–07 source contracts → 09-A → B → C → D → E → F → G → H → 08-A (on-demand release)
```

Stage 09 may reuse verified source contracts before older external gates close, but its release repeats relevant installed/account/distribution/process acceptance. Stage 08 is recurring and follows 09-H for the new delivery mode, not a prerequisite that must have final closure first. No existing early preview is blocked merely by the new planned milestone.

03-A and 03-B have no dependency on handoff or later adapters. Packaging design/build preparation may start after 01-S; its runtime smoke uses 02-B. Readiness for future adapters is validated when they are added, not by blocking the Codex preview.

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

- First usable preview targets macOS and Codex only. Its gates are 01-S, 02-A–D, 03-A/B and a selected-scope 08-A record.
- Existing 03 delivery bundles Agent Host and a compatible Node runtime; developer PATH is not installed-build evidence. Vendor binary may be bundled/installed where permitted or explicitly user-managed with version/setup diagnostics.
- [09 delivery](09-plugin-based-usage/README.md) keeps small host/adapter code in the base app and downloads shared Node plus agent SDK/native/helper payloads through a trusted Rust/Tauri installer on explicit request. Installed component identity replaces adjacent-resource resolution only after verification; profile/auth/history remain separate. Current bundled source evidence does not prove this future delivery mode.
- 02-B is a developer slice, not an installed-product readiness claim. Minimal history/cancel/approvals are required there, not deferred to final polish.
- Neutral Sessions gate replaces provider-shaped settings. Each adapter/profile has independent setup/health state. No beta release is gated on complete legacy feature parity or all four runtimes.
- API-key and account smokes are explicit opt-in runs. Record selected version, account access category, support scope and unavailable auth methods without inferring model entitlement from catalog listing.
- Before adding Linux/Windows support, verify install, auth, resume, crash, cancel and child/grandchild cleanup on each advertised target.
- Release readiness is per enabled runtime/platform subset. Roadmap Done requires all active phases, including later extensions/multiple profiles, advertised handoff and 09 on-demand delivery, or an explicit scope revision. Do not mark missing implementations Done through a deferment note.
- Native/history schemas may reset cleanly; no data migrations, compatibility codecs or upgrade paths for persisted data. Document resets when implementation lands.

## Completion evidence

Each phase records automated checks, pinned contracts and actual smoke/support evidence. No task becomes Done merely because a mock suite is green. Full roadmap completion adds independent Codex/OpenCode/Claude/Cursor sessions, native resume where supported, capability honesty, selected-profile isolation, concurrent-writer visibility, reviewable handoff and orphan-free installed builds.

## Changelog

| Date | Change |
| --- | --- |
| 2026-10-10 | Implement AS09-A strict native contracts, all-five fixtures, payload inventory/distribution decisions and numeric budgets; finite native reconstruction/clean baseline acceptance remain open |
| 2026-10-10 | Add full AS09 A–H on-demand Node/four-agent delivery plan, trusted native installation, maintenance UX and fresh installed release gates |
| 2026-10-04 | Renumber active stages 01–08, split preview/extensions/release plans, move completed evidence to done |
| 2026-10-04 | Adopt Codex-first order; reopen foundation acceptance as S; isolated account profiles; early activity/packaging; OpenCode core before extensions; subset release gates |
| 2026-08-15 | Historical foundation implementation A–F marked Done; acceptance gaps subsequently recorded |
| 2026-08-11 | Replaced Chat/Cloud/per-workspace roadmap with native per-session runtime direction |

Completed foundation phases, implementation notes and review/audit snapshots moved out of this queue live in [done](done/README.md). Older completed/cancelled archives retain their historical location under `specs/archive/ops-done` and `specs/archive/ops-postponed`. Archived evidence does not close active acceptance gaps.

**AS02-C source evidence (2026-10-04):** [Pinned configuration/usage/history ledger](02-codex-adapter/implementation-notes-phase-c.md). Experimental full legacy history, optional session configuration, sparse per-profile limits/recovery and composite host/child epoch guards are implemented with production persistence fixtures. Paginated items are unavailable in the pinned executable; native management panels and authenticated/installed acceptance remain open. This does not close AS03-A/B or AS02-D.

**AS02-D source evidence (2026-10-04):** [Hardening/setup/recovery and selected release matrix](02-codex-adapter/implementation-notes-phase-d.md). Native fault/secret/capacity tests and actual bundled-host death with two active production-client streams pass. Source developer scope remains experimental and default-off; immediate descendant race, account-A/B and installed 03-A/B gates stay open. AS08-A receives a blocked subset recommendation, not a release acceptance; 06-C is now separately source verified; actual accounts/installed acceptance remains open.

**AS04-C source evidence (2026-10-04):** [Core cutover and selected baseline](04-opencode-adapter/implementation-notes-phase-c.md). Direct frontend SDK/legacy supervisor/gate/settings stores are deleted; neutral profile/model/mode controls, private-file import, shared writer activity and packaged Node/host/native asset resolution are implemented. Codex/OpenCode child isolation and actual whole-host loss pass production-client fixtures. Installed/live-account/platform and immediate descendant-exit evidence remain open; 06-B source is now verified and [08-A is a blocked subset](08-release-gates/baseline-04-c.md). Subsequent source implementation may proceed without treating these gates as accepted.

**AS06-A source evidence (2026-10-04):** [Reviewable handoff and durable lineage](06-handoff-native-extensions/implementation-notes-phase-a.md). Common review/edit/remove/cancel, exact first prompt, fresh target with immutable profile/model/policy, strict CAS/fsync create/send intents and cache-independent no-resend guards are implemented. Nine ordered Codex/OpenCode/Claude adapter fixture pairs and production disk recovery pass. Actual provider/account pairs and signed installed/platform evidence remain open; Windows durable confirmation is unavailable. [08-A remains blocked](08-release-gates/baseline-06-a.md); B/C and Cursor source are now separately verified; their external acceptance remains open.

**AS06-C source evidence (2026-10-04):** [Simultaneous named native profiles](06-handoff-native-extensions/implementation-notes-phase-c.md). Stable Codex profile CRUD/native summary, durable original-principal guard, private execution environment, owner mutation reservation, equal-ID two-process fault and production persistence/whole-host-loss fixtures pass. Actual paid two-account/browser and signed installed/platform/cleanup acceptance remains open; experimental native history is still default-off. [Selected release recommendation](08-release-gates/baseline-06-c.md) remains blocked.

**AS07-C source evidence (2026-10-05):** [Finite native settings/capability ledger](07-cursor-adapter/implementation-notes-phase-c.md). Native file tool allowlists, boolean sandbox requests and selected-profile safe catalog enum parameters are immutable and validated before SDK work. Interactive approvals/questions/hooks/fork/restore/MCP/skills/subagents and Cloud remain unavailable; native workspace sandbox policy may apply and no filesystem read-only guarantee is advertised. Actual native enforcement/authenticated/signed installed/distribution acceptance remains open; [release recommendation remains blocked](08-release-gates/baseline-07-c.md).

**AS07-D source evidence (2026-10-05):** [Native hardening/support notes](07-cursor-adapter/implementation-notes-phase-d.md). Strict bounded history, safe native failure discrimination, durable terminal cleanup/ownership, exact profile/control secret redaction, four-runtime host SIGKILL and all 16 reviewed handoff pairs verified. Paid native smoke remains explicit/default skipped; authenticated enforcement, signed installed/platform/process/distribution acceptance stays open. [Expanded release baseline remains blocked](08-release-gates/baseline-07-d.md); AS08-A must decide its concrete selected scope without automatic roadmap closure.

**AS08-A source evidence (2026-10-05):** [Expanded release record and repeatable gate](08-release-gates/release-2026-10-05.md), [machine record](08-release-gates/release-2026-10-05.json) and [runtime guide](08-release-gates/runtime-guide.md). Full source regression, checks/builds, account-free pinned controls/copied assets and finite required-record validation pass. Selected Darwin arm64 four-runtime source is implemented; actual accounts/native policy/16-pair handoff, signed installed/platform/redistribution/manual cleanup remain open. Recommendation blocked; AS08-A-05 and full roadmap closure are not Done.

Codex session parity extension: [AS02-E](02-codex-adapter/execution-plan-phase-e-native-session-parity.md) implements verified native fork, compact lifecycle and active steering. Current pinned conversation rollback is paginated-only and unavailable for supported legacy coding/history; no deprecated endpoint or local transcript rewrite is substituted. AS02-F ecosystem/profile configuration source is implemented; G detailed native activity source is implemented; actual account/installed gates remain open.

Codex ecosystem parity extension: [AS02-F](02-codex-adapter/execution-plan-phase-f-ecosystem-config-parity.md) exposes native skills toggles, bounded current-thread MCP inventory, profile-owned existing server enable/disable/reload and allowlisted private native configuration CAS. [Finite ledger](02-codex-adapter/implementation-notes-phase-f.md) keeps OAuth/elicitation and upstream development-only plugins unavailable. Source verification does not close authenticated/installed release gates.

Codex finite parity submission: [AS02-G](02-codex-adapter/execution-plan-phase-g-native-activity-parity.md) completes source E–G with bounded native child/context activity cards and production recovery/security fixtures. [Feature ledger](02-codex-adapter/implementation-notes-phase-g.md) keeps selected unsupported controls explicit; [fresh parity release record](08-release-gates/release-2026-10-05-codex-parity.md) remains blocked pending actual account/installed/native enforcement/distribution/process gates.

**AS09-B source evidence (2026-10-10):** [Trusted artifact notes](09-plugin-based-usage/implementation-notes-phase-b.md) implement native Ed25519 catalog/manifest verification, exact URL/revision/expiry/revocation boundaries, deterministic finite all-five source candidates and bounded trusted loopback fault fixtures. Actual copied no-account SDK/native controls pass; original bundled resources stay until replacement bootstrap acceptance. Production endpoint/publication/signing/redistribution and signed installed/account/process acceptance remain open.

**AS09-C source evidence (2026-10-10):** [Native installer notes](09-plugin-based-usage/implementation-notes-phase-c.md) implement Node-independent finite confirmed installation, signed all-five loopback fixture installs, bounded download/cancel/retry, strict extraction/hash/target validation, durable receipt/active recovery, cross-process runtime/mutation locks and path-free typed APIs. 103 native tests and the focused frontend event test pass. Production unavailable catalog stays enforced; C-01 installed startup and D/E/H host/account/distribution acceptance remain open.

**AS09-D source evidence (2026-10-10):** [Lazy host/resolver notes](09-plugin-based-usage/implementation-notes-phase-d.md) implement authenticated shared Node launch, static exact capability discovery, selected lazy adapter imports, all-four managed root/entry verification, generation-pinned transport and all-five leases retained through real host stop/crash cleanup. All 105 native tests pass; source host/frontend checks/builds pass. Production unavailable catalog remains enforced; actual trusted first-use/offline bootstrap, managed vendor/account/reinstall and signed installed process/update gates remain E/F/G/H.
