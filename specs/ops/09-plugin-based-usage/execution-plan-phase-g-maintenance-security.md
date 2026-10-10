# 09 — Phase G: Updates, storage maintenance and security hardening

**Date:** 2026-10-10

**Status:** Source maintenance/security implemented; G-02/G-04/G-06 source acceptance passes; G-01/G-03/G-05 complete installed/native-store/adversarial acceptance open. [Evidence](implementation-notes-phase-g.md).

**Prerequisites:** AS09-B trust policy; AS09-C/D installer/process ownership; AS09-F operations.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver updates, storage maintenance and security hardening for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-G-01 — Implement deliberate compatible update activation

**State:** [TODO] — source implementation/fixtures pass; full actual acceptance open, see evidence

Use verified catalog metadata to offer only tested compatible versions. Download on explicit user action and activate after leases are released or a reviewed stop/restart. App upgrades check installed components against the newly shipped adapter contract without automatic data conversion.

**Acceptance:** Current sessions do not change executable version mid-work. Incompatible components stay clearly blocked with install/select guidance, and uncertainty cannot trigger automatic resend.

### AS09-G-02 — Implement bounded cleanup and disk accounting

**State:** [DONE] — source/fixture acceptance; installed release evidence remains H

Report active/retained versions, shared dependencies, staging and archive cache separately. Apply explicit cache/retention budgets and remove only owned unleased software artifacts. In-progress installation recovery and profile/native history roots are excluded from reclamation.

**Acceptance:** Cache cleanup cannot delete active components, another installer staging directory or user data; accounting uses actual disk usage and declares shared-component attribution.

### AS09-G-03 — Harden component store and trust lifecycle

**State:** [TODO] — source implementation/fixtures pass; full actual acceptance open, see evidence

Protect private directories, catalog revision/receipts and extraction/activation against symlink/path substitution and permissions changes. Revalidate execution identity at the defined launch boundary; handle disk tampering, signed revocation and key rotation. Bound metadata and never accept trust from the downloaded archive itself.

**Acceptance:** Tampered payload/receipt, stale signed metadata, substituted path and revoked component fail before launch. Offline use of installed valid components follows the explicit A/B trust policy.

### AS09-G-04 — Harden network, logs and installation environment

**State:** [DONE] — source/fixture acceptance; installed release evidence remains H

Use explicit trusted endpoint/redirect rules and bounded proxy/network error handling. Avoid account credentials in catalog/download requests, scrub temporary URLs/headers/errors, and suppress unreviewed install scripts. Keep install subprocess environments separate from account/native profile environments.

**Acceptance:** Network fixture/canary tests verify no provider credentials enter requests, logs, receipts, progress or support exports; arbitrary URLs and shell command injection are rejected.

### AS09-G-05 — Run the interruption, concurrency and adversarial matrix

**State:** [TODO] — source implementation/fixtures pass; full actual acceptance open, see evidence

Exercise cancel, full disk, corrupted/truncated archive, decompression limits, stale locks, concurrent windows/processes, shutdown/reboot simulation, dependency failure, active lease removal, signed catalog replay and pending update under native activity.

**Acceptance:** The matrix shows deterministic final states, bounded resources, no partial-ready installs, no descendant leaks and no writes beyond owned software roots.

### AS09-G-06 — Document support and incident recovery

**State:** [DONE] — source/fixture acceptance; installed release evidence remains H

Provide user guidance for install/offline/update/remove/reinstall plus safe component diagnostics and support scope. Document compromised version remediation, manual verified component recovery and explicit native data incompatibility. Update architecture and developer packaging docs without linking public docs to untracked specs.

**Acceptance:** A user can recover software installation without deleting credentials/history. Support instructions distinguish installation, authentication, entitlement, native policy and vendor availability.

## Verification and evidence

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
