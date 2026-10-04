# AS05-D — source hardening and selected release evidence

Recorded: 2026-10-04 22:10 MSK. Source recovery/security work is implemented; installed/live baseline acceptance remains open. SDK 0.3.289 / native executable 2.1.289 / Node 24.15.0, Darwin arm64.

## Recovery and security changes

Pinned SDK assistant error categories now select finite, static recovery messages: authentication, account hold/verification, billing/quota, rate limits, service overload/server failure, invalid request, unavailable model and output limit. Native result max-turn and budget limits have static messages too. Arbitrary exception/native error text is never copied into UI errors. Turn and budget settings are immutable: explicit resume retains them, a new session is required to choose different settings. A model failure preserves the existing model binding. Errors do not rotate accounts, replace sessions, automatically replay prompts, modify credentials, increment profile generations or interrupt sibling profiles.

The full native-history serialization boundary now redacts transcript identity fields and normalized event envelopes as well as content/tool payloads. A canary in a native message/tool identity previously bypassed content-only redaction; the new adversarial fixture verifies that it cannot reach common hydration. Private native transcripts can contain original provider content; they remain in the selected private profile home. This differs from the common normalized cache, which must omit credentials before disk persistence. No persisted-data migration or compatibility shim was added.

## Repeatable matrix

| Fault / boundary | Evidence and behavior |
| --- | --- |
| Missing/incompatible SDK/native assets | Existing bootstrap fixtures exercise distinct reinstall recovery; packaged resolution has no developer/global fallback |
| Offline / invalid / expired API key | Verification fixtures exercise network rejection and HTTP 401/403; native authentication category gives selected-profile reverify recovery. No real expired key is claimed |
| Billing/quota / rate / service / model / native limits | New fault matrix exercises pinned categories and immutable recovery. One failed terminal; other profile completes; same reference resumes; no replay |
| Exception / native stream ends without result | New matrix confirms one failed terminal and generic safe recovery; no exception body crosses transport |
| Native child exits | Actual distributed SDK driven by a deterministic control-wire child through the production adapter. Child exits on user input with a credential in stderr; adapter fails once, suppresses stderr, preserves key/binding; missing accepted history stays missing |
| Host SIGKILL | Real subprocess running production createHost/framing/dispatcher plus Codex/OpenCode process fixtures and injected Claude auth/SDK-shaped driver. Production frontend client settles all three streams, including pending Claude permission. Recorded history has one Claude prompt and one UUID, no replacement/replay |
| Stop / pending auth / late initialization / callback deadline / restart | Existing B/C fixtures cover once-only cleanup, no later prompt dispatch, stale generation and pending permission/question rejection |
| Missing history / fresh process / corrupted cache | Existing native lifecycle and production dispatcher/client/pipeline/store/disk tests preserve immutable binding and client IDs; divergent/corrupt native cache is hydrated without new session |
| Credential canaries | Exact keys split across native text; assistant/tool IDs and object keys; unknown diagnostics; tool/reasoning/history; snapshots; common persisted cache and corrupt-cache hydration; native stderr and allowlisted diagnostic exports. Public boundaries omit canaries |
| Ambient account/auth environment / profile storage | Existing bootstrap verifies environment allowlist, no inherited OAuth/cloud/proxy/Node injection, private bounded no-follow import and isolated logout. Unrelated profile keys remain intact |
| Handoff summary | No summary is advertised by D. AS06-A must run its own summary/attachment canaries; safe normalized history is its input boundary |

The subprocess coexistence test injects only Claude verification/driver to avoid network credentials. Codex/OpenCode adapters, production host transport and frontend client are real; fixture native processes do not establish provider inference or installed-app cleanup. Native child-death test uses the actual SDK dispatcher with a protocol child, not a provider-native tool turn.

## Setup and supported scope

Choose Claude in the common connection-profile panel and create a dedicated profile. Put the API key in that profile's private `api-key` file using mode 0600, then use Import/Verify. The WebView sends only an opaque handle; successful verification consumes the import file and stores the key privately. Account-provider response bodies, account URLs and credential-home paths are excluded from exported support diagnostics. A passing non-inference verification does not establish every model entitlement.

Only dedicated API keys are supported. Cloud credentials, subscription browser/device login and ambient developer account reuse are unavailable. Select a discovered native model and supported settings before creation. Sessions retain their profile, key identity, canonical workspace, model and policy settings. Replacing the key requires a new session; a credential-digest mismatch refuses continuation. Reconnect/Stop cancels pending interactions; explicit resume never restores an old approval or replays an earlier user message. Logout affects only the selected profile.

The [C native feature ledger](implementation-notes-phase-c.md#native-feature-ledger) remains authoritative: native approval/tools/limits and finite permission/questions; filesystem settings excluded; strict empty selected MCP and skills; managed policy/memory qualification; no configurable hooks/plugins or dedicated subagent/command/checkpoint/share surface. Native default/planning approval is not a read-only sandbox. Writer visibility remains possible/unknown; warnings are advisory and Stop targets only the selected turn. Export diagnostics through the common allowlisted support action when recovery fails.

A missing accepted transcript is an explicit error; retain the existing common thread/binding for review. No cache reset is an account switch, native thread recreation or upgrade path. To change immutable account/model/policy settings, create a new native session explicitly.

## Verification and disposition

- Final broad host regression: **223 passed / 4 explicit opt-in skips**; final D suite includes actual SDK child exit and transcript identity canaries (**18 tests**).
- Production frontend host-death/persistence/support export: 13 passed, including triple-runtime SIGKILL, credential-bearing corrupt cache and three-runtime exports.
- Host type check, frontend Svelte check (0 errors / 0 warnings), frontend production build and host build passed. No Rust implementation changed.
- Copied full SDK/native assets outside checkout: `node app/host/scripts/probe-claude.mjs` passed, Darwin arm64, SDK 0.3.289 / native 2.1.289, 5 native catalog models, no account/environment credentials or inference.
- Actual key/inference/tool/allow/deny/question/cancel/resume/logout, managed policy enforcement, live account A/B separation, signed installed package and distribution legal review, Windows/Linux cleanup and the unobserved immediate fork/parent-exit race remain open. No user key was read, imported or used.

AS05-D-01/-02 source evidence passes. AS05-D-03 has strengthened native contract and copied-asset control evidence; installed/live smoke remains open. AS05-D-04 publishes source setup/recovery and [selected-scope release decision](../08-release-gates/baseline-05-d.md); Claude baseline is not marked accepted. These open gates do not create a Claude dependency for an independently accepted earlier-runtime release. AS06 may implement handoff/native extensions while its own acceptance remains explicit.
