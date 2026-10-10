# 09 — Phase A: Component contracts and distribution decisions

**Date:** 2026-10-10

**Status:** Source contracts/decisions implemented; A-01 finite native payload and A-06 clean measured baseline acceptance remain open

**Evidence:** [Implementation notes](implementation-notes-phase-a.md) · [Exact inventory](payload-inventory.json) · [Numeric budgets](delivery-budgets.json)

**Prerequisites:** Existing adapter pins and packaging source; no live account is needed.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver component contracts and distribution decisions for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-A-01 — Inventory the complete execution payload

**State:** [TODO] — finite prepared inventory implemented; tracked OpenCode sidecar is a PATH wrapper and observed Codex differs from tested pin, so reconstruction acceptance remains open

Inventory Node, Agent Host, Codex executable, OpenCode executable/SDK, Claude SDK/native executable and Cursor SDK/workers/dependency/helper payloads. Record platform/architecture, entry points, lazy assets, size, license/notice sources and current resolver/build ownership. Distinguish build-only dependencies from installed execution requirements.

**Acceptance:** Every existing runtime can be reconstructed outside the checkout from an explicit finite payload; no executable or lazy dependency is implicitly supplied by developer PATH.

### AS09-A-02 — Define the first-party component manifest

**State:** [DONE] — source contract/decision acceptance; production install/signing/account gates remain later phases

Specify a versioned manifest for component ID/version, adapter compatibility, OS/architecture, archive format, compressed/unpacked sizes and limits, file inventory/hashes, executable entries, dependencies, trusted download location and signature metadata. Describe Node as a shared prerequisite and native runtimes as optional components.

**Acceptance:** Fixtures describe all four agents plus shared Node; unsupported target, unknown required field/schema and incompatible dependency combinations fail before installation.

### AS09-A-03 — Define ownership, state and storage contracts

**State:** [DONE] — source contract/decision acceptance; production install/signing/account gates remain later phases

Specify application-scoped immutable version directories and separate staging/cache/install receipts/active selection. Keep credentials, profiles, native history and session metadata in separate private roots. Distinguish component state, account state and runtime health. Define missing/installing/verifying/installed/update-available/in-use/failed/incompatible/unsupported/unavailable states and bounded events.

**Acceptance:** Removing a component cannot remove account/history roots; installed does not imply authenticated, entitled or healthy. Registry state can be rebuilt from validated receipts rather than migrated.

### AS09-A-04 — Resolve vendor delivery and execution constraints

**State:** [DONE] — source contract/decision acceptance; production install/signing/account gates remain later phases

Record official source and current distribution/notice/embedding requirements per exact runtime target. Choose approved hosted payloads or verified official downloads for each component; evaluate downloaded executable signing/quarantine and permitted SDK/native assembly. Unknown permission or absent verification prevents advertising an installable component.

**Acceptance:** A reviewed distribution matrix exists for Node and all four agents. Unsupported or unresolved entries have a truthful unavailable state; runtime downloading is never treated as redistribution clearance.

### AS09-A-05 — Specify package and adapter compatibility policy

**State:** [DONE] — source contract/decision acceptance; production install/signing/account gates remain later phases

Define application/host/adapter/component compatibility independently of vendor latest. The app ships the adapter implementation and a trusted catalog of tested component versions. Component upgrades do not fetch arbitrary adapter code. Define update offers, active leases, component rollback preconditions and explicit native-store incompatibility outcomes.

**Acceptance:** An untested latest version cannot be installed as a supported replacement. Native data is never migrated, rewritten or silently reset to make a component upgrade/rollback work.

### AS09-A-06 — Set measurable delivery and performance budgets

**State:** [TODO] — exact prepared bytes and numeric budgets recorded; current clean signed installed/startup/process/RSS/first-use/steady-state baseline unavailable or not run

Capture clean current installed-package size, prepared payload sizes, editor-only startup/process/RSS baseline and one-agent first-use/steady-state baseline on the first supported target. Set numeric acceptance budgets for base package, installer limits, disk/cache and progress responsiveness before implementation gates. Treat previous approximate asset totals as planning estimates.

**Acceptance:** The baseline records exact build/target and compressed versus unpacked bytes. Required budgets have numeric values before H; disk savings and RAM/startup changes are reported separately.

## Verification and evidence

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
