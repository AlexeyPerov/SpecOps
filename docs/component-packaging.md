# Component packaging and maintenance

The desktop application owns adapters and the bundled host JavaScript. Optional components contain finite execution assets and notices for shared Node or one supported agent. They never install new adapter code or execute package-manager/install scripts at runtime. Native component management works without Node or the Agent Host.

Build component archives in CI from exact pinned upstream inputs and complete finite inventories. Preserve native helpers, lazy SDK chunks, dependencies and applicable notices. Produce deterministic regular-file archives with complete modes, bytes and SHA-256 identities. The application accepts only its supported target, approved distribution entries and exact tested app/host/adapter/native-store compatibility. Commercial distribution clearance and macOS signing, notarization and quarantine acceptance are independent release gates. A source fixture or copied executable is not a production distribution result.

Catalog envelopes authenticate exact payload bytes with Ed25519 and the `SpecOps component catalog v1` domain followed by NUL. Each finite manifest is independently signed using the `SpecOps component manifest v1` domain, NUL and recursively sorted compact unsigned JSON. Catalogs have a monotonic revision, bounded lifetime and cumulative component/version/target revocations. Same-revision equivocation, older catalogs, changed immutable manifest identities, dropping still-installed/active manifests and revocation omission are rejected. Unknown installed identities conservatively block shared-runtime reclamation. Signed envelope caches and watermarks are never cleared by software cleanup.

`app/src-tauri/resources/components/trust.json` contains a bounded reviewed `keys` array with exact `keyId`, `publicKey`, `minimumRevision` and optional `maximumRevision` fields. Ship an application release that includes the approved next key before signing catalogs with it. Catalog revision intervals allow controlled signer overlap; retained manifests remain verifiable under explicitly retained trusted keys. A later application release can retire a compromised key. Neither catalog bodies nor archives add trust roots. Test keys/HTTP mappings exist only in test builds. The production catalog origin remains absent until release approval; available artifacts cannot be fabricated to close this gate.

The catalog refresh endpoint is an exact application-owned immutable HTTPS URL. Artifact URLs are exact finite names under its reviewed artifact origin. Client requests use no account credentials, ambient proxies, cookies or authorization headers; redirects and content encodings are rejected, deadlines and metadata/download sizes are bounded, and only finite path-free failure codes leave the native manager. Approving proxy support or another endpoint requires an explicit application policy change and security evidence.

Store mutations use an OS-held global advisory lock and finite component/version ownership. Unix directory traversal and files use fd-relative nofollow operations; directory creation, atomic replacement and bounded recursive removal use `mkdirat`, `renameat` and `unlinkat`. Metadata is private, hardlinks and changed permissions fail closed, and execution graphs are rehashed before leased request boundaries. Runtime leases retain a directory identity and version lock until the owned process tree exits. Cancel/approval replies and process cleanup remain possible after revocation; new work revalidates the latest signed catalog and exact leased graph.

CI must exercise signed metadata replay/revocation/key rotation, actual loopback requests with credential canaries, archive corruption/limits, low-space injection, cancellation, shutdown/crash checkpoints, separate-process lock death, active lease/removal, compatible and unknown native-store transitions, retained cleanup and concurrent symlink substitution. Record source fixture evidence separately from clean signed installed, authorized account, provider/native enforcement, full disk and OS reboot acceptance. Preserve historical measurements and report any unavailable distribution gate explicitly.

## Lean build and release validation

The production Tauri resource map contains only `host/dist/index.js`; frontend
assets are compiled into the application. Native trust metadata is compiled into
Rust. No external agent sidecar or recursive vendor/resource directory is included.
Host `npm run build` bundles adapter/control code without SDK/native asset copying.
Production host resolution uses the bundled script and managed shared Node; only
debug builds accept explicit development executable/checkout overrides.

From the repository root:

```sh
npm ci --prefix app
npm ci --prefix app/host
npm run tauri --prefix app -- build --bundles app
python3 scripts/release/measure-base.py --app app/src-tauri/target/release/bundle/macos/SpecOps.app --output /tmp/specops-base-inventory.json
node scripts/release/run-source-gate.mjs /tmp/specops-source-run
node scripts/release/check-component-record.mjs specs/ops/08-release-gates/release-2026-10-11-components.json
```

Source fixture SDK/Node preparation is separate: `npm run fixtures:assets --prefix
app/host`. It copies only pinned local assets for tests/candidate assembly and is
never an app build or runtime install step. `package-assets.mjs` requires the explicit
source-fixture flag. Candidate assembly commands and actual five-component native
installer probe are described in the [artifact procedure](../specs/ops/09-plugin-based-usage/artifact-release-procedure.md).

The local inventory checker allows only the main app executable, bundled host JS,
icon, Info.plist/PkgInfo and sealed-resource signature metadata. Unexpected helpers,
frameworks, SDK trees, symlinks and native executable payloads fail anywhere in the
bundle. It records regular bytes and deterministic local tar/gzip bytes against the
80/25 MiB budgets. Local gzip is not a DMG/installer measurement; ad-hoc linker
signing is not release signing/notarization.

The version-2 selected record preserves version-1 historical records. Required gates
retain their source/installed/account/distribution/platform/process scopes and all
five exact component archive costs. `--decision` exits 2 for a coherent blocked
record; `--decision --require-current-source` additionally requires a clean current
commit and identical source digest. Source digests cover tracked and nonignored new
files, excluding only the self-referential selected JSON record and generated lean
candidate inventory. For publication, prepare the ready record outside the checkout
against the clean source HEAD and pass that external immutable JSON to
`--decision --require-current-source`. A record cannot contain the Git SHA of the
commit that also commits that record; archive it afterward as historical evidence.
Keep exact current-source equality. Candidate CI builds and saves reviewable artifacts; it cannot
publish or treat rebuilt bytes as an accepted signed artifact.

Installed cost evidence is separately checked with
`node scripts/release/check-costs.mjs /absolute/path/to/installed-costs.json`.
Schema 1 requires signed-installed identity, target, fixed workspace/network context,
ten same-build runs (editor startup/RSS/owned idle agents, installed host/native
ready latency, aggregate runtime RSS), real installer/base sizes and all-five
transfer/disk/install-time costs. `allActiveComponentsBytes` equals the sum of active
component disk bytes, shared Node counted once; archive cache is separate. Record
actual A baseline identity and comparison evidence. Fixtures test budget enforcement
but do not collect or establish signed installed measurements. Download/provider
latency must be disclosed separately from local ready latency.
