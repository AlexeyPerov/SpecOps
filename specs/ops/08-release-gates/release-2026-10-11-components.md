# Selected AS08-A release — Optional agent components, 2026-10-11

**Schema:** 2, `optional-agent-components`.
**Recommendation:** **blocked**; roadmap remains active.
**Record:** [Machine decision](release-2026-10-11-components.json).
**Evidence:** [AS09-H implementation and acceptance](../09-plugin-based-usage/implementation-notes-phase-h.md).

App 0.3.0 and host 0.1.0 target Darwin arm64 engineering acceptance with shared
Node 24.15.0, Codex 0.160.0, OpenCode 1.17.4, Claude SDK 0.3.289/native 2.1.289
and Cursor SDK 1.0.35. All-five actual candidate archive hashes, transfer and logical
payload costs are recorded. The lean local app inventory identifies its actual
bytes separately from the absent accepted production app/catalog/signing identities.
No downloadable component target is currently advertised.

Fresh source/copy/native no-account controls and local lean package budgets pass.
Production hosting/catalog/signing/notarization/quarantine/clearance/notices,
clean signed installed editor/subsets/handoff/update/process and authenticated
all-four lifecycle/native controls remain unavailable or not-run. Numerical installed
startup/RSS/first-use/baseline measurements remain not-run. Test-only signatures,
ad-hoc local builds and source mocks cannot accept these gates.

```sh
node --test scripts/release/check-component-record.test.mjs scripts/release/check-costs.test.mjs
node scripts/release/check-component-record.mjs specs/ops/08-release-gates/release-2026-10-11-components.json
# Exit 2 while blocked:
node scripts/release/check-component-record.mjs specs/ops/08-release-gates/release-2026-10-11-components.json --decision
# Publication additionally requires clean exact current source and accepted artifact:
node scripts/release/check-component-record.mjs /absolute/path/to/reviewed-ready-record.json --decision --require-current-source
```

Historical schema-1 records/validators and their original evidence remain unchanged.
The new selected record cannot close AS09 by shrinking it to fewer agents, rescoped
source-only gates or untested targets. A ready record must identify all five exact
approved component manifests/archives/signing/notices, production catalog URL/key/
revision/hash, clean exact source and signed/notarized exact app. Publication must
use that reviewed artifact; a rebuild is another candidate. Current CI only saves
candidate app/inventory artifacts and has no release publication step.

Prepare the immutable ready record outside checkout for the clean source HEAD. A
record cannot include the Git SHA of its own archival commit. Publish only after
the external record passes exact current-source/artifact review, then archive it
as historical evidence. Archival does not weaken source equality or authorize a
new artifact/commit.
