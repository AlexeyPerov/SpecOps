# Sessions runtime setup and recovery

Updated: 2026-10-05. This guide describes implemented source scope. The [selected release record](release-2026-10-05.md) remains blocked; source/copied payload tests do not accept a signed installed application.

## Setup and accounts

Use the common Sessions connection panel. Create/select the runtime's isolated connection profile, then configure that profile's supported authentication. Native homes/configuration live under the application profile root outside the workspace. SpecOps never imports a default vendor home or reads another application's account. A missing runtime, unsupported version, missing packaged SDK asset or unauthenticated profile remains independently unavailable; other profiles and workspace editing remain usable.

| Runtime | Tested source contract | Setup and limitations |
| --- | --- | --- |
| Codex | Native app-server 0.160.0 | API key and official browser/device flow where available; independent named profiles. Full legacy native history is experimental and default off: explicit per-profile opt-in is required. Actual two-account/browser/installed acceptance is pending |
| OpenCode | Native executable/SDK 1.17.4 | Private local provider credentials/configuration; external owner-managed loopback HTTP/HTTPS endpoints expose core only. External credentials/account ownership and native extensions are not inferred |
| Claude | Agent SDK 0.3.289, native executable 2.1.289 | Dedicated API key baseline. Subscription/browser/device embedding is unsupported. Native settings/callbacks are limited to the pinned finite ledger; managed native policies may still apply |
| Cursor | Local SDK 1.0.35, explicit native JSONL store | User/service API key; browser key minting has no implemented host lifecycle. Native tools/sandbox/catalog enum settings are finite and immutable. No programmatic approval/question callback or Cloud execution is advertised |

For private-file key import, place the selected profile's key in the host-designated `api-key` file (private 0600 regular file on Unix), then use the explicit API-key import action. The frontend passes the opaque `profile-api-key` handle. Do not paste keys into messages, runtime labels or diagnostics. Import reads are bounded, no-follow and consume the file only after successful native validation. Failed/offline validation leaves the file for explicit retry. Authentication success/catalog discovery does not prove model entitlement. Cloud credentials beyond the selected baselines need separate official-contract and account evidence.

Node 24 is packaged with its license and identity manifest. Local SDK payloads include lazy modules, dependencies and platform executables. Release resolution uses adjacent assets or explicit absolute runtime paths; installed execution must not rely on developer PATH, global modules or a checkout. Current verified source/copied scope is Node 24.15.0/Darwin arm64. SDK Terms/native notices and redistribution clearance remain release blockers, especially the Cursor package's absent standalone native license; no permissive license is inferred.

## Sessions and configuration

Choose runtime/profile/model/native mode and available settings before creating the session. Native identity, original profile/account, canonical workspace, model and settings remain bound to that session. Changing these requires a new session. Wrong-account resume fails explicitly; restore the original profile credentials. Codex rename keeps profile identity; remove/logout retire only that profile's process/credentials and retain session/native history and workspace files. Removed bindings show missing-profile state; selecting another profile does not transfer history.

Native homes have explicit profile scope; workspace configuration intentionally belongs to the shared workspace. Feature ledgers distinguish native execution, visible status and editable configuration. OpenCode local profiles expose nine bounded views and seven native actions; command dispatch/manual summarize/configuration OAuth editors are excluded. Claude exposes finite native permission modes, tool allow/deny lists, maximum turns/budget, supported native approvals/questions. Cursor's automatic file tools and conditional sandbox execution do not provide a filesystem read-only guarantee; unsupported hooks/MCP/skills/subagents/fork/restore are not fabricated.

## Shared workspace, Stop and handoff

All sessions operate in the actual workspace. Writer activity/warnings are advisory; Continue remains available. SpecOps adds no writer locks, automatic worktrees, commits, rollback or account rotation. External edits refresh editor/tree/git evidence; simultaneous native writes still require human coordination. Stop cancels owned native work and pending interaction UI, then settles the stream; it does not undo files.

Handoff shows bounded editable/removable goal, decisions, summary, paths, changed-file diff and optional excerpts. Review the exact frozen first prompt and selected target profile/settings before confirmation. Raw tools, reasoning/private paths and known secret patterns are excluded by default; review prose for secrets that cannot be recognized automatically. Confirmation creates a fresh native target and saves independent lineage; source native history stays unchanged. All 16 ordered runtime pairs pass production source fixtures. Actual account/provider pair acceptance is pending.

An uncertain create/send acknowledgement never triggers automatic duplicate creation or prompt replay. Open the existing known target explicitly; inspect ambiguous outcomes before any manual retry. Durable Unix handoff intent storage uses bounded private no-follow/CAS/fsync semantics. Windows confirmation fails closed until supported safe storage is implemented and accepted.

## History, cache and failures

Native history is authoritative; the application transcript is a cache. Explicit resume reconciles stable native identities/cursors and preserves original binding after cache divergence/corruption. Missing or unreadable native storage is a visible error, not permission to create a replacement session or replay the last prompt. Cursor's JSONL agent/run store and Claude's native transcript have separate durable dispatch/identity guards. Codex's full native-history contract remains gated experimental.

Resetting application cache does not remove native history, change credentials, release durable first-prompt guards or repair lost native storage. For disposable development data, close active work and explicitly remove the selected application/native profile data if a clean reset is intended; sessions bound to that removed data cannot resume. No persisted-data migrations or compatibility upgrades are provided.

On offline, quota/model/auth or child failure, preserve the thread and profile. Restore connectivity/access, correct the selected profile setup, then explicitly reconnect/resume. Do not automatically rotate profiles/models or replay a possibly accepted turn. A runtime-child failure affects its owner; whole-host failure settles all in-flight streams. Pending approvals are cancelled fail closed; stale generation replies cannot authorize a new process. Re-enter a turn only after reviewing native history and the uncertain dispatch warning.

Diagnostics/support export includes allowlisted runtime/host/protocol versions, profile identity, nonsecret auth category, process generation, health and error kind. It excludes raw credentials, auth URLs/device codes, native stdout/stderr and transcript/tool payloads. Use the export plus the selected release record; never attach private native homes or key files. Signed installed restart/quit and manual descendant cleanup (including immediate unobserved spawn/exit) remain unaccepted. Linux/Windows and other architectures are not supported by this release record.
