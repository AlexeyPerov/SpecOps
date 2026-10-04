# 03 — Phase D: isolated-account installed Codex preview

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS03-A/B/C, AS06-B and AS06-C accepted for the first macOS/Codex preview.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Accept a usable installed Codex release with account B independent from desktop A.

## Implementation boundary

Own native drift/fault/security closure, real-account scenario and release evidence. No additional vendor adapter or simultaneous SpecOps profiles is required.

## Tasks

### AS03-D-01 — Close native drift and fault matrix

Cover pinned-version mismatch, incompatible required schema, unknown additive events, malformed/oversized messages, offline child, child/host crash, auth expiry, quota failure, ignored cancel and login races. A child failure is profile-local; whole-host failure settles all active turns.

**Acceptance:** Every case has typed actionable state, bounded settlement and a retained binding. No implicit prompt replay, replacement thread or cross-profile cancellation.

### AS03-D-02 — Audit profile/credential boundaries

Use key/token/device/auth-URL canaries in auth updates, exceptions, native events, storage, logs, support export and handoff-ready summary. Inspect profile permissions, controlled inherited auth environment and logout cleanup.

**Acceptance:** No secret crosses prohibited boundaries; default desktop home/account is untouched. Initial file store is isolated; keyring is not advertised without separate namespace evidence.

### AS03-D-03 — Accept the account-A/account-B scenario

With desktop on A, sign into B in SpecOps, show B identity, execute real native tools/edit, allow/deny, cancel, quit/relaunch installed app and continue same B thread; logout B and confirm A remains signed in. Record supported browser/device/API-key coverage by actual availability.

**Acceptance:** End-to-end record includes account category, pinned version, installed build/support scope and outcomes without exporting secrets. An unavailable auth method is explicitly unsupported for the preview, not falsely marked tested.

### AS03-D-04 — Validate installed build and native depth

Consume 06-B/C evidence; launch outside checkout/developer PATH, inspect bundled host/Node and configured Codex executable, history, limits, warnings, diagnostics and shutdown descendants. Run contract/type/build/regression checks and native feature ledger.

**Acceptance:** First macOS preview is usable from installed app. No readiness claim relies on development dependencies, all enabled baseline capabilities are tested and optional gaps are documented.

### AS03-D-05 — Publish setup/recovery evidence and close preview scope

Document runtime setup, profile/config ownership, model/settings, limits, missing-history/credential recovery, shared cwd risks and support export. Mark A–D only when their acceptance passes; record E as later active work. Submit selected-scope matrix to 06-D for release decision.

**Acceptance:** Codex preview scope is accepted without waiting for Claude/OpenCode/Cursor/E/handoff. Milestone records distinguish baseline Done from later E Planned; full roadmap is not closed.

## Verification

- Run all Codex/host/client/security tests, type/build and applicable non-AI regressions.
- Complete opt-in actual-account and installed macOS smoke with process-tree inspection.
- Review baseline scope, deferred native features and 06-D release record.

## Exit and next work

Accepted D unblocks OpenCode core. E is the later multiple-SpecOps-profile slice; the desktop-A/SpecOps-B scenario is already required here. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
