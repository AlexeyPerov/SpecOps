# AS09-C — Native installer source evidence

**Date:** 2026-10-10

**Disposition:** C-02–C-06 native source/fixture acceptance passes. C-01 native management implementation passes; clean installed editor startup and lazy host/base-bundle acceptance remains D/H. Production component installation is unavailable under the signed embedded catalog; no release endpoint or signing/redistribution approval is bypassed.

## Implemented boundary

`component_manager.rs` owns installation independently of Node, Agent Host and vendor SDKs. Tauri initializes the manager without spawning a process, attempts bounded lock-based recovery and keeps the editor open on management recovery failure. The existing host/package resources remain unchanged; D owns removing startup discovery assumptions, and H owns lean signed packaging acceptance.

Only `VerifiedCatalog` manifests can make a finite plan. Each five-minute, window-owned confirmation binds the exact dependency manifests, target, catalog revision/payload and digest. Installation reauthenticates the catalog and every manifest identity; arbitrary URL/path/key commands do not exist. The authenticated catalog watermark is atomically fsynced and never erased by cancellation, expiry or cache cleanup. Corrupt watermark metadata fails closed. Expired metadata can recheck the same installed files but cannot authorize an install/new selection.

One kernel advisory mutation lock serializes all component mutations across processes and windows, including dependency activation. A crash releases the lock without deleting its inode or guessing stale PIDs. Separate shared runtime lease file locks block removal and selection of running versions. D must hold both shared Node and agent `RuntimeLease` values until their owned process trees have exited; acquisition rehashes the complete inventory and returns native-only roots/manifests. The frontend and safe exports never receive private filesystem paths.

Plans reserve the fixed 256 MiB plus compressed bytes and twice unpacked bytes, in addition to space already consumed by retained software. Downloads use HTTPS with system certificate validation, no automatic proxy/credentials, zero redirects, a 30-second total request deadline, five-second initial response bound and two-second inactivity bound. Each job permits its initial attempt plus at most three explicit retries. Only one transfer runs; duplicate confirmations reuse the same operation/generation, including the durable cross-process current-job snapshot. Cancellation checks precede and follow bounded network waits and each extraction/hash chunk. There are no downloader subprocesses. Every job is joined on shutdown, probes use isolated environment/home and a process group that is killed/reaped. Progress is throttled to 100 ms; a 250 ms heartbeat keeps status alive during network/verification/probe waits. No partial range resume is attempted: partial files are discarded under the lock and final signed byte/hash identity is always required.

Archives must be the signed exact gzip tar bytes, then raw regular-file entries only. GNU/PAX metadata, directories, absolute/traversal paths, duplicates, links, special files, unknown files, mismatched size/hash and expansion abuse fail before activation. All staging ancestors are checked against symlinks, directories are private and extraction never uses shell commands/install scripts. Every file is rehashed against the complete manifest inventory and exact permissions. Native executables and `.node`/`.dylib` files must be thin Darwin arm64 Mach-O; test-only fixture scripts cannot pass this production check. Version probes are account-free, use fixed `--version` arguments, empty provider environment, isolated HOME/TMPDIR, bounded 4 KiB stdout/stderr and a five-second deadline; declared native pins must appear in successful bounded output. SDK-only import probes remain E acceptance.

A complete private staging tree receives a durable 0400 receipt, fsynced files/directories and an atomic immutable version rename before an atomic active selection. Until that boundary old active versions remain usable. A fully verified orphan after rename can be selected on retry; partial staging never becomes ready. Corrupt immutable versions can be rebuilt after revalidation and an exclusive version lock. Idle active removal first deselects, then removes software only; dependencies and runtime leases block destructive races. Account/history/native data roots are never touched. Startup recovery deletes abandoned staging/cache and marks interrupted durable jobs failed; diagnostics remain usable during another window's download and expose finite error codes, component/version/verification and job sequence/generation only.

`componentManager.ts` exposes typed list/plan/install/cancel/retry/update/select/remove/clean-cache/diagnostics plus status events. Confirmation is explicit and never inferred from merely opening settings. Status ordering rejects malformed/foreign/late generations and sequences, null/foreign enum states and unknown secret-bearing fields. Jobs are bounded to 32 in-memory records; pending plans to 16; persistent state contains only the bounded current job. Unknown command fields, finite IDs and stale/foreign cancellation are rejected.

## Verification

| Evidence | Result |
| --- | --- |
| Native build, app 0.3.0 / host compatibility 0.1.0 / Darwin arm64 | Pass: `cargo check --manifest-path app/src-tauri/Cargo.toml --lib` |
| All native library tests | Pass: 103 tests, including 13 manager groups |
| Signed fixture catalog revision 1, fixture key, all five exact pinned manifests | Pass: actual loopback download/install/complete hashes/fixture probe/receipt/active selection |
| Async confirmation, duplicate windows, stale/foreign generation, cancellation, clean shutdown | Pass |
| Redirect with credential canary, 401, tampering, truncation, oversized and delayed response | Pass: safe finite failures, no version activation |
| Traversal/absolute path, symlink/hardlink/fifo/directory/longname, wrong native target, file hash and cancellation | Pass: rejected in private staging |
| Five crash boundaries: downloaded, verified, receipt written, version renamed, active written | Pass: old Node selection stays valid; new selection exists only with a fully valid receipt/inventory |
| Abandoned staging, interrupted durable job, corrupt receipt/watermark, extra file and private ancestor symlink | Pass: no partial ready state; fail closed |
| Separate child process killed while holding persistent mutation lock | Pass: lock unavailable while live, reusable after death |
| Shared runtime lease full verified-root acquisition/removal exclusion and safe path-free diagnostics | Pass |
| Low-disk refusal, three-retry budget and excess/wrong version probe output | Pass |
| Typed frontend event generation/sequence/bounds fixture | Pass: 2 Vitest tests |
| Clean installed app without system Node/vendor components, actual release payload probes, Gatekeeper/quarantine, all helpers, real account/first-use, installed quit behavior and measured budgets | Not-run; D/E/H acceptance remains open |
| Approved production catalog endpoint/signing/redistribution/publication | Unavailable; embedded catalog rows deliberately unavailable |

Fixture Node 24.15.0, Codex 0.160.0, OpenCode 1.17.4, Claude SDK 0.3.289/native 2.1.289 and Cursor SDK 1.0.35 are signed tiny account-free fixtures, not real installed runtimes. Fixture trust, loopback mapping and shell-script/version bypasses exist only behind Rust `cfg(test)` checks; there is no production caller-controlled trust/transport mode. Existing B copied source payload evidence is separate and is not claimed as a manager install acceptance.

The first focused run exposed the test's use of macOS `/var` symlink in temporary paths; fixtures now canonicalize their private temporary roots. A tamper test initially attempted writing an immutable 0400 file; it now explicitly changes permissions before corruption. The implementation continues to enforce immutable file permissions. A final focused rerun exposed partial HTTP request-header reads in the tiny fixture server; it now reads complete headers within a finite bound, and the final full native suite passes. These corrected fixture failures are not installed/distribution results.

## Handoff

D should call `acquire_runtime(Node)` and the selected agent lease before launch, use their verified native roots/entry maps rather than PATH/package-adjacent roots, and retain those leases until process-tree cleanup. Management inventory/diagnostics must remain separate from host discovery. F should restore diagnostics/current-job snapshot, confirm the complete plan and use operation/generation/sequence for UI updates. G should extend update retention/revocation/lease maintenance and exercise real large payload/proxy/disk faults. H must perform fresh signed clean-installed startup/account/process/size acceptance. No migrations, compatibility shims, account operations, uploads or publication occurred.
