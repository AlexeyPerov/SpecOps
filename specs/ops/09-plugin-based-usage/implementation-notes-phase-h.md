# AS09-H — Lean candidate and selected release acceptance

**Recorded:** 2026-10-11, Europe/Volgograd; Darwin arm64, macOS 14.4 (23E214).
**Decision:** Source implementation and local candidate verified; production release **blocked**.

## Actual lean application boundary

Tauri no longer declares an agent `externalBin` or recursively packages
`resources/agent-host`. Its only host resource is `host/dist/index.js`.
`host/scripts/build.mjs` bundles shipped adapter/control code without copying
Claude/Cursor SDK/native assets. OpenCode SDK code remains a lazy managed component.
Native trust metadata is compiled into Rust. Release execution resolves the bundled
host script and authenticated installed shared Node; checkout/PATH overrides remain
behind debug-only native guards. No package manager, SDK preparation or compiler is
needed for production component installation/execution.

Component/source asset preparation is explicitly separate (`fixtures:assets`);
`package-assets.mjs` rejects ordinary invocation without `--source-fixtures`.
The source gate/CI install both frontend and host build dependencies and prepare
fixture assets only for host/copied/component controls. Existing exact finite
component assembly and historical inventories are retained as source evidence,
not added back into Tauri resources.

## Concrete local candidate and numeric costs

`npm run tauri build -- --bundles app` from `app` produced the actual lean
`app/src-tauri/target/release/bundle/macos/SpecOps.app`.
[Candidate inventory](lean-base-candidate.json) records every regular file, mode,
SHA-256, local compressed digest and source snapshot identity (G base commit plus
uncommitted H snapshot). A reviewable exact app copy and zip are prepared in `/tmp/specops-as09-h-release`;
the selected record includes the actual zip identity and candidate bytes separately
from missing production app identity. This is an **ad-hoc linker-signed** app: no TeamIdentifier,
sealed resources or notarization. It is not an accepted signed installed app.

| Measurement | Actual bytes | A budget | Result |
| --- | ---: | ---: | --- |
| Base regular unpacked bytes | 18,762,344 | 83,886,080 | Pass, local candidate |
| Deterministic local USTAR/gzip level 6 | 8,543,895 | 26,214,400 | Pass, local candidate; not installer transport |
| Complete five component archive transfer | 317,961,020 | Per archive 536,870,912 | Pass, finite candidate files; not production transfer |
| Complete five component regular payload | 847,571,087 | 4,294,967,296 active disk budget | Below bound, finite logical files |
| Actual native-installed five component allocated roots | 899,100,672 | 4,294,967,296 | Pass, source test store; shared Node once |
| Archive cache / abandoned staging after installation | 0 / 0 | 1,073,741,824 archive cache | Pass, actual source store after consumed downloads |

The four app files are Info.plist, the sole main executable, host JS and icon.
There is no Node, agent executable, vendor SDK/native helper or checkout dependency
in its resource graph. The whole-tree checker allows only these plus PkgInfo and
sealed signature metadata, and rejects unknown Frameworks/Helpers/Resources files,
symlinks and native executable magic outside the main executable. Contamination and
oversized-file tests prove failure. Resource directories from old source preparation
may remain locally; they are not packaged.

The exact A installed baseline has no reproducible source/signing identity, so no
measured old/new signed installer reduction is asserted. Old prepared component
sizes remain historical. Ten-run editor startup/RSS/process, real installer size,
first-use/network timing and warm agent measurements are **not-run**. No RAM/startup
saving is inferred from disk bytes. `check-costs.mjs` enforces A's numerical p95,
zero idle agents, disk/cache budgets, all-five first-use costs and same signed
build/target/workspace/network/baseline identity for separately collected ten-run
installed evidence. Shared Node is counted once in exact summed active component
disk; transfer and cache are reported separately. Test fixtures are gate tests,
not installed measurements.

## Fresh source verification

The sequential source runner writes outside checkout and clears account/secret and
paid opt-in environment keys. All eleven executed steps pass:

| Check | Result |
| --- | --- |
| Host typecheck / lean build / separate fixture assets | Pass |
| Host full lifecycle/profile/subset/security suite | 352 pass, 8 explicitly skipped; 27 test files pass |
| Frontend type/Svelte check / production build | Pass; 0 errors / 0 warnings in check |
| Frontend full UI/storage/handoff suite | 2,968 pass, 285 files |
| Native bootstrap/install/update/security/process suite | 114 pass; one explicit real-candidate integration initially ignored |
| Actual copied Claude/Cursor controls without accounts | Pass |
| Historical selected record tests | 13 pass; historical records unchanged |
| New selected record and cost-gate tests | 6 pass; combined historical/new 19 pass |
| Whole-tree lean inventory contamination/oversize test | Pass |

Log root: `/tmp/specops-as09-h-source-20261011`. Build notices about existing web
chunk size/pure comments, canvas jsdom support and unused native debug helpers are
not runtime/release acceptance. Existing fresh fixtures cover editor-only no-start,
independent profiles/siblings, component subsets/shared Node leases, all sixteen
handoff pairs, missing destination review, cancellation/approval lease blocking,
update/removal/retained selection, host restart/crash/descendant cleanup and
revocation. These remain source fixtures, not real account or installed matrices.

Artifact assembly/security Python suite additionally passes all six tests. Markdown
link validation finds only the known pre-existing archived terminal-question anchor;
all new public/H links resolve.

The current source runner also includes new selected/cost and lean inventory tests
on future runs; their separate passing execution above occurred after the full run.

## Fresh actual native replacement probe after G

The explicitly opt-in five-candidate test was rebuilt against current managed
resolvers and rerun after G's fd/trust hardening. It installs/revalidates all exact
real archives using the actual Rust installer under cfg-test-only `fixture-v1`
metadata and bounded loopback transport, then executes copied native/SDK controls
with only `/usr/bin:/bin` on PATH and a private isolated HOME outside checkout.
All-five actual install/production resolver controls **pass** (187.78 s test duration):
shared Node v24.15.0, Codex private config/no-account read/two isolated source profile
homes, native OpenCode private server, five Claude models, Cursor SDK/session-worker
create/history/resume/dispose, native search/sandbox entry graphs and fixture registry.
There is no account inference or clean signed installed claim.

Allocated software root bytes measured by bounded nofollow traversal are Node
134,463,488; Claude 239,923,200; Cursor 45,056,000; Codex 344,743,936; OpenCode
134,914,048. The exact five sum is 899,100,672, including actual software receipt/
lease files and directory blocks, excluding private profile/session homes. This
is actual source-store disk measurement; production network transfer/install/warm
startup metrics remain unmeasured. Cache and staging are 0 after consumed downloads.

**Failed then corrected:** the first fresh run installed and revalidated every
archive, then failed `Storage` while writing test probe metadata. `Temp::new`
created a 0755 test root; G correctly rejected a nonprivate metadata parent.
The test helper now makes its own root 0700. No production permission/trust check
was weakened. The subsequent fresh full real test passes. Final full native suite
passes again after that source-test correction and installed recovery message change:
114 pass, one separately opt-in integration ignored (23.75 s serial run).

```sh
app/host/node_modules/.bin/esbuild app/host/scripts/managed-component-probe.ts --bundle --platform=node --format=esm --external:@opencode-ai/sdk/v2/client --outfile=/tmp/specops-h-managed-probe.mjs
python3 scripts/components/test-managed-candidates.py --candidates /tmp/specops-as09-e-candidates --managed-probe /tmp/specops-h-managed-probe.mjs
```

The probe now reports component/cache/staging allocation separately for future
native/copy runs. These measured source candidates do not authorize production
trust keys, redistribution, quarantine execution or provider accounts.

## New selected AS08 record and delivery gates

[Selected version-2 release](../08-release-gates/release-2026-10-11-components.md)
and its [machine record](../08-release-gates/release-2026-10-11-components.json)
identify app 0.3.0, host 0.1.0, exact five component pins/archive costs and the
Darwin arm64 engineering target. Production catalog identities remain absent;
**no downloadable target is advertised**. Historical version-1 schemas/records and
validators are unchanged. New required scopes cannot be relabeled, excluded,
dropped, duplicated or replaced by source passes. `--decision` returns 2 while
blocked. Ready requires clean source identity, exact signed/notarized app/catalog
and approved component identities with signing/notice evidence; fixture identities
cannot authorize release. `--require-current-source` compares current clean HEAD
and source digest. Self-referential selected JSON and candidate inventory are the
only digest exclusions. A future ready publication record must be prepared outside
checkout for the clean source HEAD and checked as external immutable JSON; archive
it afterward as historical evidence. Its archival commit cannot be its own source
identity, and current-source equality is not relaxed.

Release CI now builds only the Darwin arm64 candidate, checks whole-tree/size
inventory and saves an app archive plus inventory as Actions artifacts with
read-only repository permission. It performs **no release publication**. Publication
must review the exact signed artifact and coherent accepted record; rebuilding
source does not preserve accepted artifact identity. No tags, uploads, accounts,
paid operations or public release were performed during this phase.

## Dispositions and unresolved acceptance

H-05 source release schema/record/gate acceptance passes: coherent unavailable
production/installed/account/platform/process gates keep the record blocked and
four-agent/full-platform closure cannot be manufactured from fixtures.
H-01/H-04 packaging and measurement implementation lands, but their clean signed
installed/editor/startup/RSS/baseline acceptance remains open. H-02/H-03 retain
actual account/first-use/subsets/multi-window/handoff/native-store update and
quit/crash matrix acceptance. H-06 public setup/support/architecture/candidate
work lands; all-phase acceptance, exact production identities and approved
publication remain open. The milestone/roadmap is not Done.

**Unavailable:** approved production catalog/artifact hosting, release signing/key
custody/notarization, commercial distribution clearance, accepted downloaded
executable/quarantine identities, reproducible exact A signed baseline and
production-compatible native-store update candidates.

**Not-run:** clean signed installed offline editor/tree/git/settings without
checkout/developer Node; ten-run same-build cost measurements; authenticated all
four native create/send/tools/interactions/cancel/history/resume/logout/quit,
actual two-account identity and sixteen handoff pairs, installed multi-window
subsets/fault/restart/store compatibility and OS-specific descendant cleanup.
System Git remains a separate editor Version Control prerequisite. No migration,
compatibility shim, account/history conversion or silent prompt replay is added.
