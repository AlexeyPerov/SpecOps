# 09 — Phase H: Lean release packaging and installed acceptance

**Date:** 2026-10-10

**Status:** Planned; all tasks open

**Prerequisites:** AS09-A–G source evidence; approved published delivery candidate; selected AS08-A run.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver lean release packaging and installed acceptance for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-H-01 — Remove heavy runtime payloads from the base application

**State:** [TODO]

Change Tauri/build resource lists and native asset packaging to include only editor/app code, the small host bundle, shipped adapter/control code and trust/catalog metadata. Remove bundled Node, mandatory OpenCode sidecar and Claude/Cursor SDK/native execution payloads from release packaging.

**Acceptance:** Base app artifact inventory contains no agent executable or Node runtime. A clean installed app opens editor/tree/git/settings with no network, host or vendor process and no developer toolchain.

### AS09-H-02 — Run clean installed first-use for each agent

**State:** [TODO]

Install the signed candidate outside checkout with no Node/vendor executable on PATH and empty managed store. Explicitly install each advertised runtime and verify actual version/target/inventory, account setup, native create/send/tools/interactions/cancel/history/resume/logout and quit. Account/paid tests require their established explicit authorization.

**Acceptance:** Four-agent completion requires actual accepted lifecycle evidence for each agent; no-account probes and mocks alone do not close live/provider/signed-installed acceptance.

### AS09-H-03 — Verify subset, concurrency, handoff and recovery acceptance

**State:** [TODO]

Test editor-only, each single agent, mixed subsets and all-four configurations; multiple profiles/windows, independent faults and whole-host restart. Repeat advertised handoff pairs, missing-destination installation and update/removal with active sessions/approvals.

**Acceptance:** Original account/session identities and reviewed prompt semantics hold; shared Node is reused, healthy siblings remain usable and quit/crash leaves no descendant processes.

### AS09-H-04 — Measure package, disk, memory and first-use cost

**State:** [TODO]

Compare the exact A baseline with the lean signed app and installed subsets. Record compressed installer/unpacked base, per-component transfer/disk/cache, cold editor startup/RSS/process count, install time and warm agent startup with target/network context. Enforce agreed numeric budgets in repeatable checks.

**Acceptance:** Measured base shrinkage and editor-only behavior meet A budgets; results disclose first-use download cost and all-agents total disk cost without equating disk savings with RAM savings.

### AS09-H-05 — Extend repeatable release records and platform gates

**State:** [TODO]

Add a new versioned selected release schema/record for trusted distribution, bootstrap/install security, lean inventory, compatibility/updates, clean installed/account lifecycle, process cleanup, size budgets and notices. Preserve historical AS08 records and validators as historical evidence; require new selected gates for advertised downloadable components/platforms.

**Acceptance:** A coherent blocked record remains blocked when account/signing/hosting/distribution/platform evidence is absent. Only tested OS/architecture subsets are advertised; final AS09 closure requires all four agents on the first supported target.

### AS09-H-06 — Publish accepted setup and close the milestone

**State:** [TODO]

Update public setup/component maintenance/support docs, source index/roadmap, accepted distribution matrix and dated changelog. Prepare reviewable release artifacts and delivery metadata; obtain applicable release publication approval only after candidate work is complete. Record exact accepted app/component/catalog identities.

**Acceptance:** All required A–H tasks have source and relevant real installed evidence before Done. Partial previews remain explicitly scoped; unresolved gates cannot be renamed away and no persisted-data migration/compatibility path is added.

## Verification and evidence

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
