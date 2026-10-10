# 09 — Phase F: Agent installation, first use and recovery UX

**Date:** 2026-10-10

**Status:** F-01–F-03 source/fixture acceptance complete; F-04–F-06 UI implemented with maintenance/installed acceptance open. See [evidence](implementation-notes-phase-f.md).

**Prerequisites:** AS09-C APIs; AS09-D discovery; AS09-E descriptors/payload integration.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver agent installation, first use and recovery ux for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-F-01 — Build an agent component management surface

**State:** [DONE] — source and bounded UI fixtures; actual signed installed distribution/account acceptance remains H.

Expose agent availability, install/update/remove and shared prerequisite status in settings plus contextual Sessions entry points. Show download and required disk sizes, supported versions/platforms and useful failures. Keep account connections separate from software installation.

**Acceptance:** No component is downloaded by opening settings or selecting a dropdown. Unsupported/unavailable agents explain their status without advertising a working install button.

### AS09-F-02 — Implement reviewed first-use installation

**State:** [DONE] — source and bounded UI fixtures; actual signed installed distribution/account acceptance remains H.

Before starting a download, show the exact agent, required shared components, version and estimated bytes. An explicit Install action authorizes that finite dependency plan. Retain chosen runtime/profile/workspace intent while installation progresses, then offer connection/session continuation.

**Acceptance:** Cancel/dismiss creates no session or credential changes. Completing installation does not automatically submit a prompt, replay a turn or begin paid provider work.

### AS09-F-03 — Provide progress, cancellation and actionable retry

**State:** [DONE] — source and bounded UI fixtures; actual signed installed distribution/account acceptance remains H.

Show download/verify/install/probe stages, known/unknown byte totals and actual cancellation state. Explain offline, insufficient disk, incompatible version, damaged file and blocked distribution failures with scoped retry. Restored jobs appear consistently after reopening another window/app.

**Acceptance:** Retry targets the same compatible plan or presents a changed plan for review; stale events cannot overwrite newer state or clear a healthy component.

### AS09-F-04 — Support updates, version selection and component removal

**State:** [TODO] — UI source/fixtures implemented; actual maintenance/installed acceptance remains open.

Show tested update offers, pending activation/in-use blockers, retained versions and space reclamation. Present removal impact on agents/dependencies and preserve account/history by default. Offer executable-version rollback only when declared compatible with native data; incompatible state remains explicit.

**Acceptance:** No silent update/stop/logout/prompt replay. Removal deletes owned software/cache only, never workspace files, credentials or native/session history.

### AS09-F-05 — Integrate missing-component recovery into existing sessions

**State:** [TODO] — UI source/fixtures implemented; actual maintenance/installed acceptance remains open.

Display recorded transcript and original profile identity with an install/reinstall action when execution components are missing. Handoff destinations require compatible installed components and valid profile setup; installing a destination does not prematurely create its native session.

**Acceptance:** Existing session and reviewed handoff intent survive installation failure/cancel/restart; source history/binding stay unchanged and confirmation semantics remain intact.

### AS09-F-06 — Verify accessibility, multi-window and offline behavior

**State:** [TODO] — UI source/fixtures implemented; actual maintenance/installed acceptance remains open.

Verify keyboard/focus/live progress announcements, loading states and component/account health wording. Show installed runtimes as usable offline subject to native provider requirements; missing components require connectivity or separately verified import if later explicitly scoped.

**Acceptance:** UI tests cover fresh editor-only startup, every first-use/error/update/removal path and multi-window ownership. Offline editor use never depends on catalog refresh or component installation.

## Verification and evidence

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
