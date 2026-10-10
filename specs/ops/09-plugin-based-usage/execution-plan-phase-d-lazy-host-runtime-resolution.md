# 09 — Phase D: Lazy Agent Host and installed component resolution

**Date:** 2026-10-10

**Status:** Source implementation landed; D-02/D-04 source acceptance complete; D-01/D-03/D-05/D-06 integration/installed gates remain open

**Prerequisites:** AS09-C verified installation APIs; existing supervision and binding contracts.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver lazy agent host and installed component resolution for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-D-01 — Bootstrap the shared Node dependency on demand

**State:** [TODO]

Resolve Node from the verified component store and launch the shipped host JS with that absolute executable. Install a compatible shared Node once as part of the first confirmed agent plan. Keep user/development executable overrides explicit and separate from managed production resolution.

**Acceptance:** First use works without Node on PATH; reopening the app uses the verified local version without network. Missing Node leaves the editor and native installer operational.

### AS09-D-02 — Make runtime discovery independent of runtime execution

**State:** [DONE] (source fixtures; installed evidence remains E/G/H)

Describe available agents from shipped descriptors/catalog before host startup. Ensure imports, constructors, discovery, settings and ordinary workspace open cannot eagerly resolve vendor SDKs or spawn native processes. Activate only the chosen installed runtime/profile for the requested operation.

**Acceptance:** Editor-only startup starts zero Agent Host/vendor children; selecting an uninstalled runtime shows setup. Installed sibling agents are not started merely to render availability.

### AS09-D-03 — Centralize trusted component resolution

**State:** [TODO]

Replace adjacent-resource/bundled-sidecar assumptions with a verified resolver that supplies explicit component roots/versions to host and workers. Apply the same identity/version/path checks to Codex, OpenCode, Claude and Cursor, including lazy/helper resolution. Remove production checkout and implicit PATH fallbacks.

**Acceptance:** All four adapters launch from managed storage outside the app bundle/checkout with hostile PATH; absent, altered or incompatible files fail before native execution.

### AS09-D-04 — Lease component versions to live processes

**State:** [DONE] (source fixtures; installed evidence remains E/G/H)

Tie runtime and shared Node version leases to host/profile/worker generations. Prevent replacing/removing a version used by auth, a turn, approval, history reconciliation or another window. Decide activation at a quiescent explicit boundary; changes to shared Node require an owned host restart.

**Acceptance:** A queued update cannot change code beneath a running process. Stop/restart settles pending interactions and preserves original bindings without prompt replay.

### AS09-D-05 — Preserve session/profile behavior across missing components

**State:** [TODO]

Keep session runtime/profile/native binding immutable when a component is absent or removed. Show install/reinstall/reconnect recovery instead of creating a replacement native thread. Leave history and account metadata available to the extent already supported without loading native code.

**Acceptance:** Reinstalling a compatible component resumes the original session/profile after explicit action. Unsupported native-store compatibility is surfaced without migrations or silent reset.

### AS09-D-06 — Verify host and descendant recovery from component faults

**State:** [TODO]

Exercise missing/corrupt Node, missing helper, runtime probe timeout, host crash, vendor child failure and update/remove races using real local fixture processes. Retain scoped failures and existing generation/cancel/approval cleanup guarantees.

**Acceptance:** Component failures leave healthy siblings/editor usable where possible; shared host loss settles all owned work once, and quit/crash/restart leaves no installer/host/runtime descendants.

## Verification and evidence

[Phase D source evidence](implementation-notes-phase-d.md) records exact fixture versions, native process leases, managed resolver failures, static discovery and remaining production/installed gates. D-01/D-03/D-05/D-06 are implemented but retain their stated integrated acceptance.

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
