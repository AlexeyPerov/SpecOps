# AS09-A — Component contracts and distribution evidence

**Recorded:** 2026-10-10, Darwin arm64; app 0.3.0, host 0.1.0, manifest schema 1; catalog not produced. Source commit and exact payload identities are in [payload-inventory.json](payload-inventory.json).

Phase A implements native contracts, all-five bounded fixture manifests, ownership/compatibility policies and numeric budgets. Production installation, cryptographic verification and actual installed/account/process acceptance belong to subsequent phases. Source-only results do not close the missing baseline and finite native payload gates.

## Inventory and current reconstruction boundary

[scripts/components/inventory.py](../../../scripts/components/inventory.py) records every current prepared regular file, mode, bytes and SHA-256 without executing accounts. `localTarGzBytes` is deterministic local USTAR/gzip level 6, not the vendor transport archive. No official archive compression measurement is asserted.

| Payload / tested version | Source ownership and finite execution files | Unpacked bytes | Local gzip bytes | Evidence |
| --- | --- | ---: | ---: | --- |
| Node 24.15.0 | `package-assets.mjs`; `node`, complete `NODE-LICENSE.txt`; system libraries only checked by existing packager | 120,101,534 | 38,642,444 | Prepared; production distribution/signing unaccepted |
| Host 0.1.0 | `build.mjs`; bundled `index.js` (includes OpenCode HTTP SDK 1.17.4) | 522,597 | 106,757 | Prepared; recorded host hash differs from old Node identity manifest, so existing resource receipt is stale |
| Codex 0.160.0 | Native `codex` app-server; current resolver uses explicit path or developer PATH | 246,046,384 | 97,980,308 | **Incompatible** observed executable is 0.162.0-alpha.17.2; sizes are observed executable, not the tested pin |
| OpenCode 1.17.4 | `update-opencode-sidecar.sh` nominally owns native executable; SDK is bundled host JS | 57 | 173 | **Unavailable** tracked sidecar is shell `exec opencode`, requiring developer PATH; it is not an agent payload |
| Claude SDK 0.3.289 / native 2.1.289 | `claude-assets.mjs`; 15 SDK JS/JSON/metadata/license files including lazy cores/bridge and native `claude`, SDK/native notices | 234,326,475 | 100,047,672 | Prepared full adjacent payload; production assembly/signing review open |
| Cursor SDK 1.0.35 | `cursor-assets.mjs`; both workers, recursive SDK/dependency packages, lazy chunks, platform search/sandbox/parser helpers; 1,629 files | 40,660,632 | 9,355,505 | Prepared full adjacent payload; production assembly/signing review open |

The checked-in inventory lists the finite prepared files, including all recursive Cursor assets and notices. Native profile homes/config/history and JSONL/native session stores are runtime data, never software payloads. Rust/Tauri/frontend, TypeScript, esbuild, vitest, Svelte/Vite and `@types/*` are build/test dependencies. Host TS/generated contracts are bundled JS inputs; no compiler or npm/package-manager install is needed at execution. Current packaging retains vendor type declarations/README files conservatively; they are not execution requirements. Removing those optional files requires a new exact catalog/inventory.

A-01 remains open because pinned Codex and actual finite OpenCode binaries are absent from the prepared inventory. No PATH-based success is reconstruction evidence. B must obtain exact upstream payloads, include notices and verify their identities before publishing installable catalog entries.

## Native manifest and ownership contract

`app/src-tauri/src/components.rs` is Node-independent Rust with strict serde codecs. Schema 1 rejects unknown fields at every level, unsupported targets, excessive metadata/file/archive/unpacked sizes, traversal/absolute/drive/control paths, duplicate case-folded files, file/directory collisions, malformed hashes, absent entries/notices, duplicate/self/missing/conflicting dependencies and incompatible exact app/host/adapter versions. Legitimate scoped SDK paths and Unicode/space filenames are supported; extraction must additionally reject symlinks/hardlinks/device files and filesystem normalization collisions in C/G.

`app/src-tauri/fixtures/components/manifests.json` contains synthetic fixtures for Node and all four agents, including native/SDK/worker/lazy/dependency/helper entry shapes. Zero hashes/signatures, `.invalid` URLs and unavailable distributions are deliberate fixture values. They cannot authorize installation. Signature metadata declares Ed25519, immutable key identity and signature bytes; B owns canonical authenticated metadata, full URL allowlisting and cryptographic trust. `parse` and `validate_plan` are schema/compatibility checks, **not signature verification**. The fixture-only bypass must not be used in production.

Application data roots:

```text
components/versions/<id>/<version>/darwin-arm64/   immutable validated software
components/staging/                              bounded private extraction
components/cache/                                bounded verified archives
components/receipts/                             manifest/catalog-bound receipts
components/active/                               atomic version selections
agent-private/                                   credentials/profiles/native history
```

Current native profile/history/session roots retain their independent existing ownership; a new installer must never move or delete them. Component roots apply only to software. Removal uses a validated component/version, never a vendor path from untrusted input. Registry reconstruction authenticates the catalog, matches schema-1 receipt identity/hash/catalog revision and rechecks every installed file; receipt presence alone cannot establish installed state. Invalid receipts report missing/failed; no migration or repair codec rewrites old data.

Component state is one of missing/installing/verifying/installed/update-available/in-use/failed/incompatible/unsupported/unavailable. Account state (unknown/signed-out/authenticated/not-entitled) and runtime health (unknown/healthy/offline/failed) are independent. Installed software does not imply credentials, entitlement or network/service health. Bounded events contain opaque operation ID, monotonic sequence, component ID, finite state and byte counters; raw errors, credentials, paths, account identity and vendor logs are excluded. C owns transition serialization, retry/cancellation and progress ordering.

## Compatibility, updates and rollback

Only exact versions in an authenticated tested catalog may be offered; vendor latest never substitutes for a tested pin. Base app ships adapter implementation and compatible host JS; components contain execution assets, not downloadable adapter code. Manifest compatibility independently binds app version, host version, adapter revision, OS/architecture and native-store revision. All four agent component plans include the same exact compatible shared Node dependency. Unsupported OS/architecture reports unsupported; absent clearance/evidence reports unavailable.

An explicit update offer includes the complete compatible dependency plan and bytes. Live host/vendor/helper processes lease immutable component ID/version/owner. Removal and shared Node cleanup reject leases/dependents; active selection changes do not modify leased directories. Rollback requires authenticated compatible retained software, no conflicting leases and proven current native-store revision compatibility. Unknown or mismatched native-store revision reports incompatible; no native data migration, rewrite, reset or compatibility shim. C/D/G must implement atomic activation and lease ownership around these contracts.

## Distribution decisions, reviewed 2026-10-10

This is a reviewed engineering decision matrix, not legal clearance or an accepted release. Exact licenses from pins override broad current documentation. All additional OS/architectures are unsupported until their own evidence exists.

| Exact first target | Candidate delivery | Official evidence and obligations | Current production availability |
| --- | --- | --- | --- |
| Node 24.15.0 Darwin arm64 | Verified official `nodejs.org/dist/v24.15.0/` archive, or reviewed hosted assembly | [Pinned complete license](https://raw.githubusercontent.com/nodejs/node/v24.15.0/LICENSE), [official release verification/key guidance](https://github.com/nodejs/node#verifying-binaries). Preserve MIT and bundled dependency notices; verify signed upstream checksums with reviewed pinned release keys plus signed catalog identity | Unavailable until exact archive/notice/signing evidence is accepted in B/H |
| Codex 0.160.0 Darwin arm64 | Exact official tagged release archive; optional hosted assembly after artifact review | [Pinned Apache-2.0 license](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/LICENSE), [official release installation](https://github.com/openai/codex#installing-and-running-codex-cli). Preserve license/NOTICE where provided and dependency obligations; derive immutable hash/signing evidence from actual target artifact | Unavailable; tested executable not prepared, new target signatures unverified |
| OpenCode 1.17.4 Darwin arm64 | Exact tagged official release archive; reviewed hosted assembly after native inventory | [Pinned MIT license](https://raw.githubusercontent.com/anomalyco/opencode/v1.17.4/LICENSE), [official release](https://github.com/anomalyco/opencode/releases/tag/v1.17.4). Include native/SDK/dependency notices; the existing shell wrapper cannot be shipped as finite runtime | Unavailable; actual native payload/notice/signing review missing |
| Claude SDK 0.3.289/native 2.1.289 Darwin arm64 | Exact official registry packages, verified against authenticated catalog; hosted repackaging only after explicit review | [Official SDK terms](https://code.claude.com/docs/en/agent-sdk/overview#license-and-terms), [official legal/authentication guidance](https://code.claude.com/docs/en/legal-and-compliance), local pinned SDK/native LICENSE.md. Commercial terms and component licenses apply; dedicated API-key baseline. Documentation of customer-facing use does not establish repackaging permission | Unavailable; assembly/redistribution permission and target signing review unresolved |
| Cursor SDK 1.0.35 Darwin arm64 | Exact official registry SDK/platform/dependency assembly, catalog verified; hosted repackaging only after explicit review | [Official SDK runtime/helper guidance](https://cursor.com/docs/sdk/typescript#runtime-support), [terms](https://cursor.com/terms-of-service), pinned SDK LICENSE.md and recursive dependency licenses. Include both workers and all lazy/platform assets; prevent native search fallback to developer PATH | Unavailable; SDK/platform redistribution permission and target signing review unresolved |

Downloaded executables remain subject to [Apple signing/notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution). Preserve quarantine; never clear it to bypass failures. B/H must record executable/helper signing identities, hardened-runtime/entitlement behavior and actual Gatekeeper assessment outside the checkout with developer PATH absent. Hash validation alone does not prove execution permission, vendor redistribution clearance or macOS trust. No runtime install script, arbitrary URL, upstream latest redirect or unreviewed SDK code is executed to assemble a production component.

## Numeric budgets and honest baseline

[delivery-budgets.json](delivery-budgets.json) fixes numeric bounds before H: base 25 MiB compressed / 80 MiB unpacked; editor startup p95 2 s and app/WebView RSS 256 MiB; zero owned host/vendor processes at editor idle. Per component archive 512 MiB, unpacked 1.5 GiB, file 512 MiB, manifest 2 MiB / 20,000 files; one download, three retries, 30 s request deadline; progress 100 ms with maximum silence 1 s. Cache 1 GiB, all active components 4 GiB, one inactive retained version per component, 256 MiB free-disk reserve plus archive and twice unpacked bytes. Local host ready p95 1.5 s, first native ready p95 5 s, aggregate local runtime RSS 768 MiB; provider latency/download time excluded and reported separately.

Ten repeated runs on the same machine/workspace/build/signing form the H baseline/comparison. Disk savings and startup/RSS changes are separate reports. These bounds are engineering acceptance decisions, not measured achievements.

Existing `/Applications/SpecOps.app`: 14,814,184 regular bytes, four files, no prepared runtimes/host in resources; OpenCode is also the PATH wrapper. `codesign -dv` shows ad-hoc signature, no TeamIdentifier or sealed resources. Source identity is unavailable and archive bytes unmeasured. It is not a clean current signed installed build. Editor-only startup/process/RSS and one-agent first-use/steady-state are **not-run**; launching this stale bundle cannot establish the requested current baseline. A-06 stays open pending reproducible signed build and authorized native measurements. No RAM/startup improvement is inferred from payload sizes.

## Verification and task dispositions

- **Pass:** seven Rust contract tests covering all-five fixture parsing, unavailable production plans, schema/target bounds, scoped/Unicode paths/traversal/collisions/limits, exact dependency/version compatibility, receipt/private-root separation, active leases/native-store rollback and bounded events. Existing unrelated `git.rs` unused-variable warning remains.
- **Pass:** read-only finite prepared inventory and local gzip measurements; actual installed signing inspection; pinned official license and current official runtime/terms review.
- **Not-run:** actual vendor native first use, paid/authenticated accounts, clean editor startup/process/RSS, steady-state, signed installed/Gatekeeper/quarantine execution.
- **Unavailable:** actual finite OpenCode payload, pinned Codex payload, reviewed commercial redistribution permission, signed catalog/artifact identities and clean current installed baseline.

A-02/A-03/A-04/A-05 source contracts/decision acceptance pass. A-01 and A-06 implementation/evidence are partial and remain open for their stated finite native reconstruction and measured clean installed acceptance. Continue B with unavailable production catalog entries and trusted local fixtures; these gaps must remain visible through H.
