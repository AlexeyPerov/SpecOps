# AS07-A — Local SDK bootstrap evidence

Recorded: 2026-10-04 23:33 MSK. Source implementation verified; authenticated, signed installed and full local-turn acceptance remain open.

## Pinned native feasibility ledger

Official [TypeScript SDK documentation](https://cursor.com/docs/sdk/typescript), [SDK announcement](https://cursor.com/changelog/sdk-release), [npm registry metadata](https://registry.npmjs.org/@cursor%2Fsdk/1.0.35) and distributed public declarations were checked on 2026-10-04. The package is linked from the official documentation; this is a native local agent SDK, with hosted inference. Cloud execution is excluded.

| Surface | Evidence and selected scope |
| --- | --- |
| Exact SDK | `@cursor/sdk` 1.0.35; registry SHA-512 integrity locked in host-only package lock, exact matching platform optional package |
| Runtime | Official minimum Node 22.13; SpecOps supports bundled Node 24, tested 24.15.0 on Darwin arm64 |
| Local storage | Pinned public `JsonlLocalAgentStore` holds agents/checkpoints/runs/events. Explicit JSONL store selected; no emulation or storage migration. Actual create/dispose/resume native ID probe passes without prompt/inference |
| SQLite qualification | Current docs describe `node:sqlite`; pinned public declarations describe optional SQLite behavior. No implicit default-store assumption: explicit JSONL avoids the disagreement. SQLite is not advertised or tested |
| Local loop/stream/cancel | Official public `Agent.send`, `Run.stream`, `Run.cancel`, `Run.conversation` and resume exist. No authenticated model turn was executed; mapping/cancellation/enforcement remain B/C/live acceptance work |
| Policy and interactions | Native tool restrictions, file settings sources and sandbox options exist. Hooks are file-based; there is no documented programmatic approval callback. Default local execution automatically runs tools. A exposes no turns or fabricated approval/question bridge |
| Native assets | Exact platform package contains search/sandbox executables and native parser bindings with grammar assets. Full SDK/dependency package roots and lazy JS chunks are copied alongside them; hashes, pins, OS/architecture and safe relative paths are verified |
| Native search/sandbox probe | Copied search executable reports version; copied sandbox helper launches. This verifies assets/execution only, not filesystem/network policy enforcement |
| Authentication | SDK native `Cursor.me` and `Cursor.models.list` use explicit host-owned user/service API key. Native auth failures and offline results are distinct; no HTTP model fallback |
| Browser-assisted auth | Official `Cursor.auth.login` accepts custom credential store, browser opener, URL callback and cancellation; mints an expiring user API key. Host browser challenge lifecycle is not implemented, so browser/device controls remain unsupported. No existing desktop auth store is read |
| Catalog | Actual selected-key native catalog only; bounded/deduplicated safe model descriptors. Native parameter metadata exists; parameter and policy editors remain C work. No hardcoded generic mode/model fallback |
| Maturity | April announcement describes public beta; current SDK/version is recorded rather than permanently assigning a beta label to future versions |

## Ownership and security

Each control operation runs the official SDK in a separate private profile worker. HOME/config/data/Windows roots are profile-local, with a finite inherited execution environment. Keys cross only private stdin to explicit native options; no key in process arguments, provider environment, browser state, normalized snapshots or SDK stdout. Vendor output is suppressed and worker stderr discarded. Control input/output/time are bounded; abort/logout/restart invalidates generation and waits for owned process cleanup. The existing birth-stamped process owner tracks descendants inside the host supervisor group; immediate unobserved spawn/exit remains a platform release gate.

Private `api-key` import uses bounded no-follow nonblocking regular-file reads, private modes and file identity checks. A successful native account/catalog probe persists the credential and consumes that import; rejected/offline probes retain it without promotion. Logout clears only the selected saved credential/catalog. Metadata reads are bounded/private with canonical timestamp validation. No migrations or compatibility codecs.

Catalog names scrub exact key and common secret shapes before truncation; snapshots expose only API-key account category. No SDK identity email, key display name or raw error body is exported. Native SDK request failures never substitute another account or runtime. Earlier runtimes remain registered and independent.

## Packaging and license boundary

`cursor-assets.mjs` copies the full SDK, matching platform package and runtime dependencies (including available license notices); no single-file/native-asset assumption. Installed resolution requires adjacent verified payload and has no global CLI/developer module/PATH fallback. Platform helper layout and SHA manifest are tested. Build roots must retain native parser binaries, lazy chunks and package-root dependency resolution.

The distributed SDK license reserves rights and refers to [current Terms of Service](https://cursor.com/terms-of-service), updated September 3, 2026. Official documentation explicitly targets embedded interactive hosts, but this is not a legal clearance for public redistribution. Distribution permission, bundled dependency notices, signed installed packaging/notarization and target-platform review remain release gates. The Darwin platform package itself declares a license-file pointer but does not ship that file; the SDK license and all actually distributed notices are preserved, and the missing native-package notice is recorded for release review.

## Verification and limitations

- Host typecheck and Svelte check: pass, 0 errors/0 warnings.
- Broad host fixtures: 249 passed, 6 skipped; Cursor bootstrap: 12 passed, including actual account-free native control/store probe and copied checksum/missing/version checks.
- Focused frontend profile panel/client: 12 passed.
- `scripts/probe-cursor.mjs`: copied SDK/assets and copied Node outside checkout, private HOME, no NODE_PATH/global CLI; durable native ID create/resume, native search and sandbox executable launch pass. This is not a signed installed app or authenticated/inference/enforcement test.
- Host build and frontend production build: pass.

Actual keys, account variants, browser login, model entitlements, stream/tool/cancel/history content, sandbox/hook enforcement, Windows/Linux/native parser behavior, signed installed lifecycle and distribution clearance remain open. A source bootstrap completion does not accept A's full installed/authenticated gate. See [selected release baseline](../08-release-gates/baseline-07-a.md).

## Handoff to B

Use `cursorControl`/private worker boundary, exact adjacent package entry and explicit profile store. Maintain abort/cleanup/generation and environment isolation; never mutate shared host process environment. Implement long-lived per-profile worker native agent/run storage and bounded native event mapping, immutable credential/workspace/model/settings binding, restart/resume without replay, reservation before awaits and cancelled late native query cleanup. Native callbacks do not support the shared approval UI; unsupported interactions must remain explainably unavailable. C separately owns tool/sandbox/settings policy, model parameters and extension ledger. Browser flow needs explicit host URL/cancel lifecycle if later selected; Cloud remains excluded.
