# AS09-B — Trusted artifacts and local distribution evidence

**Recorded:** 2026-10-10 23:00 MSK, Darwin arm64, app 0.3.0 / host 0.1.0, manifest/catalog schema 1; source follows phase A commit `18a4eb7`. Production candidate catalog revision 1; local fixture revisions 1/2. Keys and signed identities are in the committed public trust/catalog files. Production delivery remains unavailable; no publication is claimed.

## Source implementation

`app/src-tauri/src/component_catalog.rs` is Node-independent Ed25519 strict verification. It authenticates exact catalog bytes and independently signed compact/sorted manifests; checks schema/bounds, exact row identities, expiry/future issue time, numeric revision and same-revision payload identity; pins complete immutable artifact URLs; validates archive hash/bytes; and rejects known revoked install/new-launch manifest lookups. Authenticated watermark persistence, receipt file rehash, range/download/extraction/process/UI enforcement belong to C/D/G. Verifier constructors cannot accept arbitrary trust keys/origins in installed code; fixture trust exists only under `cfg(test)`. The candidate embedded origin is absent, so production installable rows cannot activate.

`resources/components` embeds a real signed engineering candidate catalog and its external-key public root, with all five Darwin arm64 rows explicitly unavailable and no fake artifact. Its private key remains outside the checkout, preserved in private local Codex configuration as described in the [release procedure](artifact-release-procedure.md). The candidate key/custody is not a reviewed production release identity. `fixtures/components/distribution` contains independently signed test catalogs, all-five tiny executable archives, complete manifests, public test trust and a signed revocation revision. No fixture seed or HTTP override is accepted by production. The loopback server supports exact range/ETag responses, missing/service-unavailable/throttled status, corrupt/truncated/disconnected/delayed responses, redirect and ignored-range cases.

The CI-only Python assembly pipeline splits existing prepared Node/SDKs into independent immutable archives and obtains exact official native packages without account/login/install scripts. Every file/mode/byte/hash/helper/notice is finite. Source receipts identify upstream archives separately from the assembled transport archives. Preserve the original bundled resources and PATH sidecar until the replacement native install/bootstrap/adapter path is functional and H verifies its packaging. Host bundling remains base JS; no Node/compiler/package-manager execution is needed to verify catalogs.

## Actual finite native reconstruction and candidate evidence

A's missing pinned native inputs were obtained from exact official release assets: [Codex 0.160.0](https://github.com/openai/codex/releases/tag/rust-v0.160.0), [OpenCode 1.17.4](https://github.com/anomalyco/opencode/releases/tag/v1.17.4). GitHub release API exact archive digest and size matched the downloaded bytes. This proves upstream archive identity under the reviewed source; it does not establish notarization, all dependency notices or redistribution approval. The Codex full package includes its native execution/helper/search/resources/shared libraries rather than only a PATH-discovered executable. Its only mode normalization is explicit non-executable JSON runtime metadata.

[Native finite inventory](native-payload-inventory.json) records every actual pinned native package file and notice, target, hashes, bytes/modes, signed candidate manifests and upstream identities; [artifact evidence](artifact-evidence.json) records all five exact copied candidate identities/bytes and no-account controls. Existing A SDK inventories remain the finite inputs, and hashes are checked again before assembly.

| Candidate | Files | Unpacked bytes | Assembled gzip bytes | Actual copied source probe |
| --- | ---: | ---: | ---: | --- |
| Shared Node 24.15.0 | 2 | 120,101,534 | 38,642,444 | Copied `--version`; drives all SDK probes |
| Codex 0.160.0 full native package | 43 | 332,979,473 | 129,973,781 | Exact copied CLI version; full helper hashes/target inventory, no account/inference |
| OpenCode 1.17.4 native | 2 | 119,373,323 | 39,923,252 | Exact copied CLI version; no PATH wrapper/account/inference |
| Claude SDK 0.3.289 / native 2.1.289 | 15 | 234,326,475 | 100,047,672 | Copied native version and local supported-model control using copied SDK/shared Node |
| Cursor SDK 1.0.35 | 1,629 | 40,660,632 | 9,355,505 | Copied local create/resume/dispose and native search/sandbox availability; signed-installed enforcement untested |

Actual no-account copied smoke runs outside the checkout with isolated homes, no ambient provider environment and only `/usr/bin:/bin` PATH. All extracted files are inventory/hash/mode checked, then exact pins and native controls are checked. This is source payload reconstruction evidence, not a signed installed app, actual native inference, voice/code execution, sandbox enforcement or Gatekeeper/quarantine result. Lazy/helper file identity and architecture are validated; full native helper execution remains E/H acceptance.

## Verification and dispositions

- **Pass:** four Rust native security groups: all-five authentication/production unavailable rows; unauthorized keys/catalog/signature/manifest mutation/row mismatch/exact URL rejection; expiry/future metadata/replay/equivocation/offline receipt boundary; corrupt archives/authenticated revocation/no replay/new install/new launch lookup block.
- **Pass:** six Python security/distribution groups: deterministic all-five generation; deterministic copied executable smoke; missing/corrupt/unlisted/mode/canary/development-root failures; symlink/wrong-architecture/unapproved-helper/size bounds; target-native/nonempty notices; loopback statuses/ranges/corruption/truncation/redirect/ignored ranges/traversal rejection.
- **Pass:** actual finite all-five candidate assembly and repeated archive/signed-manifest identity comparison; exact full Codex/OpenCode official source hashes and finite native target inspection; all-five copied no-account control smoke; existing copied Cursor local session/create/resume/helper probe.
- **Corrected during verification:** raw credential regex first matched embedded public native strings, so full PEM and lexical token boundaries replaced marker-only patterns; canary rejection stays unconditional. An upstream JSON executable mode was normalized explicitly. The first new copied Cursor probe lacked its disposable native directory; the probe now creates it and reruns successfully. These initial failures do not represent installed results.
- **Not-run:** authenticated accounts/inference, all native helper actions, live-process revocation/UI remediation, clean signed installed app, Gatekeeper/quarantine, startup/process/RSS/disk comparisons and actual host bootstrap via downloaded components.
- **Unavailable:** approved production endpoint/publication/signing custody, full redistribution/dependency notice/signature review and clean signed installed baseline. Embedded unavailable catalog is intentional; no advertised production payload is unresolvable because no installable production row exists.

B-02/B-04/B-05 local source/security acceptance passes. B-01 implementation has all-five candidates but final all-helper/replacement/base-release acceptance remains open through E/H; B-03 delivery preparation has truthful unavailable rows but approved hosting/publication is open; B-06 documented/authenticated revocation rehearsal passes at the native authorization boundary but actual launch/UI/session-preservation integration remains C/D/G/H acceptance. No migrations, compatibility shims, account use or uploads were performed.

## Commands

```sh
python3 -m unittest discover -s scripts/components -p 'test_*.py' -v
cargo test --manifest-path app/src-tauri/Cargo.toml component_catalog::tests
python3 scripts/components/fixtures.py --output /tmp/specops-fixtures --serve
```

Candidate commands require explicit external output/work/signing-key paths: `build-prepared.py`, `obtain-pinned.py`, `prepare-native.py`, `smoke.py`, and `sign-catalog.py` expose `--help`; none publishes. Use the finite review/signing/revocation policy in [artifact-release-procedure.md](artifact-release-procedure.md) before release actions. C must consume `VerifiedCatalog`, atomically persist `CatalogWatermark`, authenticate the complete dependency plan and enforce extraction/file receipts without Node.
