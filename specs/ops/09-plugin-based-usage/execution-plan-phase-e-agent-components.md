# 09 — Phase E: All four agent components and future adapter registration

**Date:** 2026-10-10

**Status:** Managed all-four implementation and source controls recorded; E-05/E-06 source acceptance passes, E-01–E-04 account/installed/native gates open.

**Evidence:** [Implementation notes](implementation-notes-phase-e.md) · [Registration contract](first-party-registration.md)

**Prerequisites:** AS09-B/C/D; existing source adapter contracts. Account acceptance remains explicit.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver all four agent components and future adapter registration for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-E-01 — Move Codex execution into its managed component

**State:** [TODO]

Produce the compatible Codex native executable payload or approved verified official-download recipe and switch app-server resolution to the component store. Preserve isolated profile homes, native controls/config/activity and exact protocol compatibility.

**Acceptance:** Managed Codex resolves/version-checks/create/send/cancel/resume/auth lifecycle with fixture evidence; real account A/B isolation and signed installed execution are separate required gates.

### AS09-E-02 — Move OpenCode execution into its managed component

**State:** [TODO]

Package the native server and required SDK payload according to the inventory. Remove mandatory bundled sidecar ownership from production packaging/resolution; retain private profile/server lifecycle and bounded native extensions.

**Acceptance:** Managed OpenCode works without bundled sidecar/PATH/checkout, including native core/extensions fixtures; paid provider, native enforcement and installed lifecycle gates remain explicit.

### AS09-E-03 — Move Claude SDK and native assets into its component

**State:** [TODO]

Load the SDK/native executable and required chunks from the verified managed root. Keep adapter wiring and account-free discovery in the base code without eagerly importing the SDK. Preserve auth, policy, interactions, history and helper permissions.

**Acceptance:** Managed Claude copied-assets and native-wire fixtures pass; missing chunks cannot trigger package installation or arbitrary fallback. Real account/policy/installed acceptance is recorded independently.

### AS09-E-04 — Move Cursor SDK, workers and helpers into its component

**State:** [TODO]

Package the complete platform SDK dependency graph plus workers/parsers/search/sandbox helpers. Separate any shipped SpecOps worker version compatibility from vendor payload versions; resolve dynamic imports and launches only within approved roots.

**Acceptance:** Managed Cursor no-account native create/resume/dispose/helper probes pass outside checkout; auth/inference/policy/installed/redistribution uncertainty is not hidden by download success.

### AS09-E-05 — Make shared prerequisites and independent installation explicit

**State:** [DONE]

Allow any one agent, any subset or all four, with compatible shared Node reuse and per-component optional dependencies. Define dependency references and prevent removal of a prerequisite while installed/in-use dependents need it; provide an explicit reviewed group removal plan.

**Acceptance:** Node downloads once for compatible selected agents. Failed installation of one component does not remove or reinstall healthy siblings or mix profile credentials.

### AS09-E-06 — Specify registration for additional supported agents

**State:** [DONE]

Document the minimum adapter descriptor, manifest/dependency recipe, compatibility checks, official distribution evidence and installed acceptance required for a future first-party agent. Ship new adapter code through a reviewed app release, while heavy assets remain downloadable.

**Acceptance:** A small fixture adapter proves the shared install/resolve/UX contract without changing installer logic. This phase does not introduce a marketplace or arbitrary third-party executable/adapter loading.

## Verification and evidence

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
