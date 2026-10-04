# 06 — Phase C: multiple simultaneous SpecOps profiles

**Date:** 2026-10-04

**Status:** Source implemented and verified; actual account/installed acceptance open

**Prerequisites:** AS02-D accepted. Default delivery stage 06; not a prerequisite for first Codex preview.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Let multiple Codex accounts operate simultaneously inside SpecOps after the separate-desktop-account scenario is proven.

## Implementation boundary

Own multi-profile management and concurrency tests, not automatic quota-based account rotation or native-history transfer.

## Tasks

### AS06-C-01 — Manage multiple profiles without rebinding sessions

Add named profile create/select/rename/logout/remove UX, actual account summary and stable ID. Enforce immutable profile binding; removal preserves session metadata with missing-profile state.

**Acceptance:** New sessions select profile explicitly; existing threads never move to another account. Removal/logout does not delete workspace files or another profile.

### AS06-C-02 — Operate independent profile processes

Run app-server instances with isolated home/auth/config, controlled environments and generation-scoped routing. Verify equal native IDs, parallel login, catalogs, account/limit notifications and per-profile crash/restart.

**Acceptance:** Two profiles stream/work concurrently in one workspace without routing collisions; stop/logout/quota/child death in one leaves the other usable. Whole-host death settles both and preserves their bindings.

### AS06-C-03 — Verify multi-profile native history and security

Persist/reload two profiles and threads across installed-app restart; add same-ID/stale-generation fixtures, credential canaries and actual-account opt-in smoke. Explain independent config/MCP/skills scope.

**Acceptance:** Each account resumes its own thread/home; no auth, config or transcript crosses profiles. Shared-workspace writer warnings identify both sessions/profiles without locks.

## Verification

- Run profile CRUD/routing/environment, persistence, multi-process fault and canary tests.
- Opt-in two-account concurrent sessions, restart/resume and logout-isolation smoke.

## Exit and next work

Record 06-C independently; first-preview baseline remains 02-A–D. Rerun 08-A for a release advertising simultaneous profiles. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.

## Source implementation record

[AS06-C implementation evidence](implementation-notes-phase-c.md) records Codex-only named CRUD, native account summary/stable UUID, durable private account/session guards, controlled isolated homes, owner mutation reservations, equal-ID two-process faults and production application persistence. All three tasks are source implemented; actual two-account and signed installed acceptance remains unchecked. The default-skipped real-account harness requires explicitly authorized paid native requests and user-provided private credential files. Upstream experimental/default-off and release gates remain open in [selected baseline](../08-release-gates/baseline-06-c.md).
