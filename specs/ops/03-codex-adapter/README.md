# 03 — Codex native harness and isolated accounts

**Date:** 2026-10-04

**Status:** Planned

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

**Evidence:** [Implementation audit](../audit-2026-10-04.md)

Codex is the first production adapter. Baseline A–D delivers a usable macOS preview with account B in SpecOps while desktop stays on A. E is later simultaneous profiles inside SpecOps.

## Decisions

- Use pinned official app-server in Agent Host; no frontend protocol/SDK or model-only agent loop.
- Profile home/auth/config and child process are SpecOps-owned; account state and routing are profile-scoped.
- Persist immutable runtime/profile/native-thread binding; native history is authoritative.
- API key and official browser/device login only where supported by selected version/account.
- Model, effort, collaboration, sandbox and approval policy are distinct settings.

## Scope and current state

| Phase | Work | State |
| --- | --- | --- |
| AS03-A | [Isolated profile and authentication](execution-plan-phase-a-protocol-auth.md) | Missing |
| AS03-B | [Native coding slice and minimum resume](execution-plan-phase-b-thread-events.md) | Missing |
| AS03-C | [Native config, limits and reconciliation](execution-plan-phase-c-capabilities-history.md) | Missing |
| AS03-D | [Installed account-B acceptance](execution-plan-phase-d-hardening-exit.md) | Missing |
| AS03-E | [Multiple simultaneous SpecOps profiles](execution-plan-phase-e-multi-profile.md) | Later; missing |

## Dependencies and delivery

01-S → A → B → C; B also feeds independent early 06-B/C. C + 06-B/C → D → selected-scope 06-D release. No Claude prerequisite. Accepted D unblocks 04 core; E follows D at slot 6.

## Expected outcomes

- Real coding tasks use native tools, permissions and history.
- Fresh installed-app restart resumes same B profile/thread; logout B preserves desktop A.
- Missing runtime/auth/history/quota states are actionable without implicit replay.

## Out of scope

- Account rotation to bypass quota or thread transfer between accounts.
- Full desktop feature duplication, voice/browser/cloud parity or prompt-based policy emulation.
- Persisted-data migration or a prerequisite implementation of another vendor adapter.

## Definition of done

- [ ] Baseline A–D tasks, strengthened shared contract and profile/credential canaries pass.
- [ ] 06-B/C installed macOS/activity/diagnostic gates pass and selected-scope 06-D release record exists.
- [ ] Actual desktop-A/SpecOps-B smoke passes; unsupported login variants recorded honestly.
- [ ] Native feature ledger and setup/config/history/recovery docs are current; changelog updated.
- [ ] For full milestone completion, later E accepted or explicitly removed from active scope; baseline acceptance alone does not mark E Done.
