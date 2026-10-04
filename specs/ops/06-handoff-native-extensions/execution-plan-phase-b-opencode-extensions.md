# 06 — Phase B: later native extensions and settings

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS04-C accepted core cutover. Default delivery stage 06 after Claude baseline; not a prerequisite for OpenCode core release.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Restore valuable native feature depth through optional host extensions without expanding the mandatory core.

## Implementation boundary

Own retained parity-ledger features, provider-specific host logic, common extension UI and independent settings refresh. No revival of old SDK/supervisor path.

## Tasks

### AS06-B-01 — Prioritize retained-feature ledger

Review the 04-A/04-C ledger for lifecycle actions, commands/search, todos/diffs/file status/language services, configuration, providers/models/auth, MCP/skills/agents. Select bounded retained work; explicitly revise scope for excluded features.

**Acceptance:** Every retained category has target extension/test and every excluded category has explicit disposition; no unowned blanket promise of parity.

### AS06-B-02 — Implement native lifecycle and workspace extensions

Add supported fork/revert/share/summarize, commands/file search, todos/diffs/file status and language-service functionality as selected in ledger. Native actions preserve profile scope; Stop remains separate from any explicit native revert action.

**Acceptance:** Each retained action has real native behavior and capability gate; unsupported actions send no request. Common UI does not import vendor types.

### AS06-B-03 — Implement native configuration and ecosystem extensions

Expose selected provider/model/auth/config, MCP/skills/agents through runtime-specific host extensions and bounded UI state. Clearly show workspace/profile configuration ownership.

**Acceptance:** Credentials remain host-side; refresh/failure/logout affects the owning profile only and cannot erase another runtime session.

### AS06-B-04 — Replace extension stores and accept retained parity

Update settings/panels to host requests/control-plane events. Compare retained fixtures and verify extension absence/presence, redaction and enabled handoff integration without reintroducing direct client dependencies.

**Acceptance:** Retained rows have automated or recorded native evidence, deferred rows stay unavailable, and new core path remains the only runtime owner.

## Verification

- Run selected extension/capability/settings/store UI fixtures and canaries.
- Walk retained ledger rows in installed app; inspect frontend import graph.

## Exit and next work

Record 06-B completion separately from 04-C baseline and rerun selected-scope 08-A for advertised new features. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
