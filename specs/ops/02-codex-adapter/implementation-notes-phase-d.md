# AS02-D source hardening and release handoff

**Recorded:** 2026-10-04 17:49 MSK

**State:** Experimental developer source slice hardened and fixture-verified. **Installed baseline preview is not accepted.** AS03-A/AS03-B remain Planned; real account-A/account-B acceptance requires a human login and installed build. AS02-D and milestone A–D remain In progress.

## Fault/security evidence

| Case | Source evidence and action | Remaining acceptance |
| --- | --- | --- |
| Missing/offline executable, wrong 0.160.0 pin, incompatible initialization/required schema | Bounded version/init requests; missing-runtime/incompatible-runtime/error profile states; explicit reconnect; private binding retained | Installed runtime resolver/PATH-independent smoke |
| Unknown additive notification | Bounded counter / safe diagnostic; raw native payload omitted | Real extension drift audit when advertised |
| Malformed JSON / oversized frame | Actual native fixture writes invalid/over-limit stdout; transport retires selected child, rejects pending request, sibling remains usable | Installed process-tree inspection |
| Native child crash | Failed turn, cleared interactions and offline profile; explicit resume; no replacement thread/replay | Abrupt tool-spawn/leader-death race below |
| Whole-host crash | Actual bundled host SIGKILL while two native fixture threads are active, one awaiting approval; production client detects actual death and closes both streams/listeners. Bindings and native persisted one-turn-per-thread history remain unchanged | Installed Rust/WebView combined smoke; fixture bridge status derives actual process exit rather than simulating death |
| Auth expiry / quota | C tests: typed profile auth-required/quota/retry/offline recovery; isolated account/usage clearing; no account rotation or automatic quota retry | Actual account expiry/limits availability |
| Ignored cancel | Actual fixture ignores interrupt; bounded 750ms request, local cancelled terminal, selected child retired, same binding retained | Installed native tools resisting cancellation |
| Login races | A tests: superseded attempts/generations cannot authenticate; browser failure/device cancellation return safe retry states | Actual available login methods |
| Credentials / boundaries | Synthetic API key, Bearer, quoted token assignment, device code and auth URL canaries; every split position in streaming text plus interleaved unrelated item completion; mapped tool values, final snapshots, native history text and auth result/notification masking. Long benign native text/tool output retained; draining consumers cannot evade cumulative 4MiB/10k-item state bounds | Installed support export, real native echo scenarios and handoff surface when implemented |
| Profile files/env/logout | Private 0700 homes/0600 config/credential files; symlink rejection; auth/provider environment controls; selected logout removes auth/import files, retains sibling files; no default desktop credential read/copy | Actual browser/device/API-key account preservation |

Native mapped events are sanitized before WebView delivery, so downstream history storage/logging/diagnostic export receives masked supported secret shapes. The stream holds an unfinished lexical atom and credential introducer; an item's authoritative completion discards only that item's carry, preserving other streams. Final native user/assistant history is masked. This is conservative shape-based masking, not a guarantee of recognizing arbitrary unlabeled secrets. Synthetic fixture-owned native history/request files intentionally contain their test inputs; native-owned private storage can hold credentials and conversation data and is never a support export source.

Per-profile descendants are observed by bounded asynchronous `ps` polling every 250ms, remain in the Rust-owned host process group and are retired on observed leader death/restart/logout. Birth stamps are checked before expanding tracked ancestry or signalling observed descendants. `ps` birth stamps have coarse resolution: they reduce PID reuse risk, not prove perfect ownership. A descendant spawned immediately before an abrupt leader exit can evade polling; **orphan-free selected-profile crash acceptance is still open**. Whole-host group retirement remains the Rust supervisor's responsibility, verified independently by its descendant/crash/force-kill fixtures. Children must not create a detached group to escape supervision.

## Setup and recovery procedure

1. Use the supported `codex-cli 0.160.0` executable. Development resolution uses an absolute `SPECOPS_CODEX_EXECUTABLE` or PATH lookup. This is not evidence of a bundled installed native executable or Node distribution; 03-B owns installed distribution/discovery. A version mismatch reports a selected-profile incompatibility; install the supported executable and explicitly reconnect.
2. Create a SpecOps profile. In the Tauri app its private home is under `~/Library/Application Support/com.alexeyperov.specops/connection-profiles/<id>/home`; the standalone host fallback is `~/Library/Application Support/SpecOps/connection-profiles/<id>/home`. Never copy or inspect the desktop's auth/home as setup. The host passes selected `CODEX_HOME`, enforces file credential storage and controls inherited auth/provider overrides. Ordinary workspace/tool environment survives. Keyring storage is not advertised.
3. Browser URL and device code stay in the host/system browser/dialog. API-key import is the selected profile's private `api-key` file (0600); successful import removes it, logout also removes any retained import/auth files. Do not put credentials in profile names, prompts, config, support records or screenshots. Auth method availability is only fixture/protocol evidence until manually verified; unavailable methods are excluded from preview support.
4. Coding/resume requires an explicit persisted **experimental profile opt-in**, default off. The official 0.160.0 distribution requires experimental **legacy materialized history**. This is an experimental developer slice, not accepted baseline coding. Disabling the opt-in retires its child; it does not migrate histories.
5. Model/effort/collaboration/sandbox/approval values belong to the session; profile TOML/workspace instructions remain native-owned. Native extension controls and paginated/sparse history are unadvertised. C's feature ledger remains authoritative; no independent skills/hooks/plugin/MCP-management/subagent smoke is added by D.
6. After offline/crash/cancel-timeout, reconnect the bound profile, explicitly resume the existing thread, inspect retained partial work and send a new message deliberately. Authentication expiry requires selected-profile sign-in. Quota requires explicit account verification after backend recovery; reset times alone do not allow retry. Never replay a stored prompt or replace a missing thread silently.
7. Missing/corrupt local cache can be reconstructed from readable native legacy history. Missing native history keeps the readable record and immutable binding with an actionable error. Do not delete private native history as an automatic recovery step. Logout affects only the selected profile; desktop account preservation still needs actual human smoke.
8. Sibling threads share cwd and may write concurrently; there are no filesystem execution locks. Before concurrent edits inspect shared files; writer visibility/external-edit refresh acceptance belongs to 03-A and remains open. Handoff is unadvertised and belongs to 06-A; simultaneous SpecOps profile UX belongs to 06-C.

For a safe support or handoff-ready summary, manually record only runtime/pin, experimental opt-in state, platform/build category, redacted profile label, binding IDs, fault category/recovery action, scope and check results. Exclude private home contents, API keys, token/device fields, auth URLs, raw native stderr, raw fixture files and full environment. No support-export UI or handoff feature is added here; 03-B/06-A must verify those eventual surfaces independently.

## Repeatable manual account/installed gate

Once 03-A/B acceptance evidence exists, install the selected macOS build and launch from Finder outside checkout with developer PATH removed. Record build/version/architecture, host/Node asset resolution and configured native executable pin without secrets. A human verifies desktop A via its normal account UI, creates/signs into B via each actually available method and records account category (no credential/URL/device-code screenshots).

On B: show safe identity; create a disposable workspace thread; run real native command/edit under separate allow and deny; cancel a running tool; quit/relaunch and resume the exact thread; inspect native history and models/settings/limits/recovery; run two active sibling threads, one waiting for approval, kill the host and confirm both UI interactions/streams settle while editor/session records remain usable. Inspect `ps` process trees on cancel, child death, host death and normal quit, including immediate descendant spawn before leader death. Verify outside-PATH startup, activity/writer warnings, diagnostics/export canaries and absence of descendants. Log out B; a human confirms A remains signed in. Record unavailable auth methods as unsupported, not passed. Any failure leaves the gate open.

## Selected-scope submission to AS08-A

| Selected combination | Decision/evidence |
| --- | --- |
| macOS + 0.160.0 + isolated file profile + explicitly experimental legacy coding | Source fixtures accepted; **release blocked** by installed 03-A/B and authenticated A/B smoke |
| Default-off baseline coding / installed macOS preview | **Not accepted**; default coding is intentionally unavailable before experimental opt-in |
| Browser/device/API-key login | Protocol/fixture coverage only; real-account supported method matrix pending |
| Whole-host death / selected-profile lost leader | Production-client actual host-death fixture and Rust group tests pass; installed UI/process cleanup, immediate-spawn race acceptance pending |
| Model/settings/text/tools/approvals/questions/cancel/history/limits | A–C ledger plus D fault tests; actual native inference/instructions/extension depth remain unverified |
| Other platforms/vendors, paginated history, steering, attachments, extension management, handoff, simultaneous-profile UX | Excluded from this release; later plans stay Planned |

AS08-A release recommendation: **do not publish/mark baseline Done from these source checks**. This submission does not implement or close 08-A, 03-A/B, 06-C or the full roadmap.

## Verification

- Host: 118 tests across 9 files; frontend: 3,238 tests across 295 files; Rust Agent Host: 17 serial tests. Host TypeScript and Svelte checks pass (zero errors/warnings); both production builds pass.
- New host suites cover actual malformed/oversized/crash retirement, observed orphan cleanup, ignored cancel, split/interleaved native secret masking, direct auth metadata and cumulative-state limits. Frontend adds actual bundled-host death with two active native streams/pending approval.
- No generated native roots/contracts changed; C's 46-root/199-file pin evidence remains unchanged. Existing canvas notices, Vite chunk advisory and unrelated Rust unused-variable warning remain.
- No live credentials or default desktop auth files were read, no authenticated native inference was performed and no installed preview was accepted. No migrations or compatibility shims.
