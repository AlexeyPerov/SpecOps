# AS09-D — Lazy host and managed runtime source evidence

**Date:** 2026-10-10 23:28 MSK

**Disposition:** D-02/D-04 source acceptance passes. D-01/D-03/D-05/D-06 implementation lands with the integration/installed gates below still open. This record does not claim a working production download: the embedded production catalog intentionally marks all five components unavailable.

## Implementation

The native supervisor acquires the authenticated installed shared Node lease before launching the shipped host JS with its absolute `main` entry. Release builds ignore executable/host environment overrides, bundled Node and PATH. The only Node override is an explicit absolute development path in debug builds. Host JS remains a base resource; debug-only host overrides remain separate. Existing heavy packaging is retained until H.

Discovery uses shipped identity and exact shared capability descriptors without starting the host or constructing vendor adapters. The default registry imports and constructs only the selected adapter on an explicit routed operation. Concurrent activation reuses one promise; profile auth event wiring attaches to newly activated adapters. Initialization/discovery never activates adapters, even if a request carries an unrelated runtime ID. Ordinary catalog loading checks host status and returns idle for a stopped host. Passive profile rendering does not invoke native health/model probes and uses static discovery and verified native software inventory; an absent selected component displays Software/reconnect recovery without loading that adapter. Explicit native actions retain their existing lifecycle paths.

On each selected runtime operation the native command strips the reserved internal binding field supplied by the WebView, acquires the authenticated component lease, and injects its root/manifest over the owned stdio pipe. There is no external URL/path/manifest command. Runtime IDs map to the same native store resolver for all four adapters. The host rejects a changed root/version within its generation, validates platform/architecture, hashes the full manifest tree at operation boundaries with a reusable 1 MiB buffer, rejects symlink ancestors and rechecks selected entries before helper resolution. Missing/read/hash errors are replaced by a bounded path-free recovery error. Owned cancellation/approval replies do not resolve new code or rehash damaged components, so existing interactions can still settle; those cleanup methods never instantiate another adapter. Codex/OpenCode resolve managed executables; Claude resolves managed SDK/native entries; Cursor resolves managed SDK/profile/session worker entries. All shared Node workers use the supervised `process.execPath`.

Leases are held conservatively for the entire host generation, including auth, turns, history, approvals and workers. Version selection/removal cannot replace leased code; activating another version requires an explicit owned host stop/restart. Stop, stdout failure, host crash and liveness polling kill/reap the owned process group before releasing all leases. The native preparation lock is released before waiting on a host response, preserving concurrent cancellation/approval/stop. Request admission checks the captured generation so a restart between resolution and transport cannot route an old binding into a replacement host.

An absent/incompatible selected component returns typed `componentUnavailable` with explicit Software/reconnect recovery. The send pipeline retains the original runtime/profile/native binding, sends no prompt and creates no replacement. Existing history/account metadata remains in the neutral local session state; metadata requiring a stopped native host is not loaded. No automatic reinstall, session replacement, prompt replay, migrations or native-store upgrade path was added.

## Exact source/fixture context

- App `0.3.0`, host `0.1.0`, source base `5e28e36`; Darwin arm64 development workspace; explicit test Node `24.15.0`.
- Signed fixture catalog revision `1`, fixture Node `24.15.0`, Codex `0.160.0`, OpenCode `1.17.4`, Claude SDK `0.3.289` / native `2.1.289`, Cursor SDK `1.0.35`. Engineering production catalog remains unavailable under its separate embedded trust.
- Lease integration tests install authenticated local fixture payloads and attach their leases to a real built host driven by the explicitly selected test Node executable. They exercise version ownership/process recovery; they are not a claim that the tiny fixture Node payload runs the host or that signed vendor components have passed installed acceptance.
- Resolver tests execute real finite helper fixtures from canonical temporary roots outside the checkout with a nonexistent PATH for all four IDs. Missing helpers, altered transitive files and symlink helpers fail before execution; private paths do not escape errors. These are bounded source fixtures, not vendor/account acceptance.

## Verification

**Pass:** all 105 Rust/native tests (`cargo test --manifest-path app/src-tauri/Cargo.toml -- --test-threads=1`), including authenticated all-five installs, corrupt receipts/tree/target/symlink rejection, download/probe/crash faults, cross-process installer leases, all-five real-host lease retention through stop/crash, replacement-generation rejection, blocked stdin, host crash recovery, ignored shutdown and resistant grandchild cleanup.

**Pass:** 343 host tests and 7 separately gated skips with `npm --prefix app/host test -- --exclude src/codex/ecosystem.test.ts`; focused resolver/discovery/dispatch/process/adapter controls also pass (112 passed, 2 skips). Source host TypeScript check/build pass. Focused frontend discovery/client/catalog/profile/native-tools tests pass, including passive no-start discovery/catalog behavior, missing-component profile recovery, immutable original binding/no-send/no-replacement and existing history/turn/cancel lifecycle tests. Svelte check reports zero errors/warnings; web production build passes. Official Svelte lifecycle/effect docs and autofixer were used; final changed components have no issues. Existing async-effect suggestions are retained for asynchronous selected-profile updates and explicit state resets.

**Failed/environment-dependent:** an initial unfiltered host run reached the existing Codex installed native config probe through ambient PATH and found an executable incompatible with required `0.160.0`. This test is not passed or hidden by the source-only filtered run. An initial all-five lease test had one bounded loopback `Network` failure under concurrent test/build load; the unchanged test passed standalone and then in the complete serial native suite.

**Unavailable/not run:** clean signed installed editor-only launch, actual trusted production Node bootstrap/offline reopen, all-four real managed vendor lifecycle/native helper acceptance, compatible reinstall/reconnect against original persisted native stores, authenticated account isolation/inference, queued signed update races across installed windows, OS quit/crash installed descendant evidence, production publication/signing/redistribution. E/F/G/H own those integrated gates. Windows supervision remains fail closed under the existing unsupported-target boundary.

## Acceptance disposition

- D-01: implemented; native dependency installation/verified launch boundaries pass fixtures. Actual trusted production first-use/offline reopen remains unavailable.
- D-02: source accepted. Static discovery, deferred imports/constructors, passive no-start catalog/profile reads and absent-component setup pass without starting siblings.
- D-03: centralized resolver implemented and all-four outside-checkout hostile-PATH finite helpers pass. Actual managed vendor/native SDK identity and lifecycle acceptance remains E/H.
- D-04: source accepted. All-five authenticated version leases survive real host stop/crash until process cleanup; existing pending/generation/cancel/approval ownership tests pass. Installed signed updates/windows remain G/H evidence.
- D-05: immutable identity and actionable absent-component recovery pass source tests. Actual compatible reinstall against original native stores remains E/F/H.
- D-06: bounded source faults/process recovery pass. Complete managed-vendor/installed descendant/update acceptance remains E/G/H.
