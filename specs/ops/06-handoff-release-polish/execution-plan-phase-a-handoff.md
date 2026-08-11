# 06 — Phase A: reviewable cross-runtime handoff and lineage

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Milestones 01–05 Done for enabled runtimes  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Create a new target-native session from context explicitly reviewed by the user.

## Agent handoff boundary

Own packet schema/generation, review UI, target session creation, lineage,
redaction, and pairwise tests. Do not transfer native ids/history.

## Tasks

### AS06-A-01 — Define packet and lineage contracts

Model goal, decisions, summary, relevant files, diff, changed files, optional
excerpts, source reference, redaction metadata, and source/target lineage.

**Acceptance:** Packet contains no vendor-native session id as target history and lineage is SpecOps metadata only.

### AS06-A-02 — Generate bounded draft packets

Collect common transcript summary plus workspace evidence with size limits,
stable ordering, secret scanning, and raw-tool-output exclusion by default.

**Acceptance:** Oversized/missing sections degrade explicitly; secret canaries are removed or blocked.

### AS06-A-03 — Build review and target selection UI

Let users select runtime/model/mode, edit/remove sections, preview the first
prompt, cancel, and confirm creation.

**Acceptance:** No target session or prompt is created before confirmation.

### AS06-A-04 — Create target session and persist lineage

Create a fresh native session through the selected adapter, send the approved
packet, retain the source unchanged, and link both SpecOps records.

**Acceptance:** Failure/retry cannot duplicate a hidden target; source and target remain independently usable.

### AS06-A-05 — Pairwise and security tests

Cover every enabled runtime pair, edit/cancel/retry, unavailable target,
unsupported mode, large diff, missing file, and secret/raw-output cases.

**Acceptance:** Pairwise matrix and redaction suite pass.

## Verification

- Run packet, UI, lineage, pairwise and secret-canary tests.
- Manually hand off across representative runtime pairs and inspect first prompt.
- Confirm source session/native history is unchanged.

## Handoff

Phase B may consume lineage/activity metadata after the pairwise handoff matrix passes.
