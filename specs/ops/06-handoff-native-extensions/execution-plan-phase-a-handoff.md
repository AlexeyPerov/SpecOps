# 06 — Phase A: later reviewable handoff and lineage

**Date:** 2026-10-04

**Status:** Source implemented and fixture-verified; real enabled-pair/account and installed acceptance pending

**Prerequisites:** At least two accepted native runtime baselines, each with profile-bound sessions, plus early AS03-A/AS03-B. Default stage 06 after Claude baseline; technically eligible after Codex 02-D and OpenCode 04-C.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

**Source evidence:** [Implementation notes](implementation-notes-phase-a.md) · [Selected release baseline](../08-release-gates/baseline-06-a.md)

All five task implementations are present with source/fixture evidence. External acceptance below remains open; prior runtime baselines are not declared accepted solely to advance this plan.

## Goal

Create a fresh target-native session from context reviewed by the user.

## Implementation boundary

Own packet generation, target runtime/profile/settings review, new session creation, lineage and retry semantics. No native thread/history transfer or account rotation.

## Tasks

### AS06-A-01 — Define packet and lineage

Represent goal, decisions/summary, relevant paths, workspace diff/changed files, selected excerpts and SpecOps source/target refs including target profile. Bound sections and mark unavailable evidence.

**Acceptance:** Native source IDs are never used as target history; lineage is neutral metadata and profiles remain immutable after target binding.

### AS06-A-02 — Generate bounded safe draft

Collect common transcript/workspace evidence with stable ordering and size limits; exclude raw tool output/secrets by default. Let user remove sensitive context and show truncation/missing-section state.

**Acceptance:** Canary/large-diff/missing-file fixtures are safe and explicit; source native history is unchanged.

### AS06-A-03 — Review target and first prompt

Select enabled runtime/profile/model/policies, edit/remove sections, preview actual first prompt and confirm or cancel. Show unavailable auth/runtime and capability constraints.

**Acceptance:** No target native session or first prompt is created before confirmation. Selection cannot mutate source binding or substitute another account.

### AS06-A-04 — Create fresh target and persist lineage

Create a new target-native thread and send exactly approved context. Persist creation/send state so retry offers the known target and does not resubmit a possibly accepted prompt. Retain source session.

**Acceptance:** Failure/retry cannot duplicate hidden target/session/prompt; source and target remain independently usable and traceable.

### AS06-A-05 — Verify enabled pairs and profile cases

Test enabled ordered runtime pairs, later target profiles, edit/cancel/retry, auth unavailable, unsupported settings, large input and security. Expand matrix when each new adapter is enabled.

**Acceptance:** Actual enabled-pair matrix passes; no Cursor/four-runtime prerequisite for initial handoff. Missing capabilities are explicit rather than emulated.

## Recorded source verification

- AS06-A-01–04 source pass: bounded safe review packet; frozen exact approval; native fresh target; neutral index/thread lineage; durable CAS/lock intent boundaries and no duplicate dispatch.
- AS06-A-05 fixture pass: all nine ordered Codex/OpenCode/Claude pairs through actual adapter implementations and production dispatcher/client/pipeline/disk; selected later profiles, unchanged source, retry/cache corruption/security. Actual account/provider pairs remain pending.
- Focused 64 passed; full frontend 2,913 passed; full host 223 passed/4 opt-in skips; native Unix storage/excerpt test passed; Svelte 0/0 and build passed. See notes for exact scope and limits.

## Verification

- Run packet/redaction, review UI, target creation/retry/persistence and pairwise fixtures.
- Opt-in representative enabled-runtime handoff; inspect approved prompt and unchanged source history.

## Exit and next work

A adds handoff to the next selected-scope 08-A release. It does not gate early preview delivery 03-A/B. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
