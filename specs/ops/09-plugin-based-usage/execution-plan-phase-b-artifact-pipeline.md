# 09 — Phase B: Trusted component artifacts and catalog

**Date:** 2026-10-10

**Status:** Planned; all tasks open

**Prerequisites:** AS09-A manifest, compatibility and distribution decisions.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver trusted component artifacts and catalog for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-B-01 — Build reproducible per-target component payloads

**State:** [TODO]

Refactor existing asset packaging into separate Node and per-agent component outputs. Preserve required dynamic imports, workers, helper binaries, permissions and legal notices. Keep build dependencies in development/CI while removing native execution payloads from the base release output.

**Acceptance:** Same pinned inputs produce the same payload inventory and content identity; copied component smoke resolves every required lazy/helper asset outside node_modules in the checkout.

### AS09-B-02 — Produce signed catalog and artifact metadata

**State:** [TODO]

Generate artifact hashes and sign release metadata with keys kept outside the repository. Embed a trust root in the base app; specify catalog signature verification, supported schema, expiry, monotonic catalog revision and reviewed key rotation. An embedded compatible catalog supports repeatable initial installs.

**Acceptance:** Altered catalog/signature/artifact and unauthorized signing keys are rejected; expired or replayed remote metadata cannot silently authorize a new install. Installed verified components remain usable offline.

### AS09-B-03 — Define stable delivery endpoints and release retention

**State:** [TODO]

Prepare versioned immutable artifact URLs, download headers and platform catalog rows. Document hosting/offical-source choice, retention of supported pinned versions, availability, notices and request privacy. Publishing endpoints/artifacts is a separately authorized release action after local candidate review.

**Acceptance:** Every advertised catalog row has a resolvable approved payload and matching metadata; unsupported targets are absent or explicitly unavailable, never redirected to a different architecture.

### AS09-B-04 — Validate transitive payload boundaries

**State:** [TODO]

Add component inventory/size/license checks, verify helper entry points and architecture, and detect accidental credentials, development paths, npm caches and unrelated platform binaries. Do not run npm install or vendor install scripts on the user machine as the component installer.

**Acceptance:** A corrupt/missing helper, wrong-target binary, unlisted executable, credential canary or excess payload fails component production before publication.

### AS09-B-05 — Provide deterministic local distribution fixtures

**State:** [TODO]

Provide a local trusted fixture catalog/server with small executable payloads and controllable network/status/range/corruption behavior. Distinguish fixture signing keys from production trust and ensure overrides cannot activate in normal installed builds.

**Acceptance:** Installer tests run without vendor accounts, public uploads or paid inference; production rejects test keys and fixture endpoint overrides.

### AS09-B-06 — Document artifact release and revocation procedure

**State:** [TODO]

Specify reviewed component publication, application compatibility matrix updates, compromised-artifact revocation, trusted key rotation and retention/rollback handling. Revocation requires authenticated metadata and user-visible remediation; never quietly replace a running executable.

**Acceptance:** A rehearsal can revoke a test component and block new launches while preserving sessions/credentials. Publication and production signing are not claimed complete by a local packaging run.

## Verification and evidence

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
