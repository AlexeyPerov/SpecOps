# Execution plan — Phase 3.5

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Gap analysis:** [gap-analysis.md](./gap-analysis.md)
**Decisions:** [questions.md](./questions.md)

Each milestone has its own execution plan. Tasks are marked `[ ]` until done. Update
`specs/changelog.md` after each task (per `AGENTS.md`).

---

## Milestones (implementation order)

| Order | Milestone | Plan |
|-------|-----------|------|
| 1 | M0 — SDK migration | [execution-plan-m0.md](./execution-plan-m0.md) |
| 2 | M1 — Richer message rendering | [execution-plan-m1.md](./execution-plan-m1.md) |
| 3 | M2 — Session management & history | [execution-plan-m2.md](./execution-plan-m2.md) |
| 4 | M3 — Composer enhancements | [execution-plan-m3.md](./execution-plan-m3.md) |
| 5 | M4 — Configuration management | [execution-plan-m4.md](./execution-plan-m4.md) |
| 6 | M5 — Workspace UX | [execution-plan-m5.md](./execution-plan-m5.md) |
| 7 | M6 — Appearance & feedback | [execution-plan-m6.md](./execution-plan-m6.md) |

### Post-review follow-ups (M7–M11) — phase-closure

| Order | Milestone | Plan |
|-------|-----------|------|
| 8 | M7 — Critical bugfixes | [execution-plan-m7.md](./execution-plan-m7.md) |
| 9 | M8 — M1 live-stream parts wiring | [execution-plan-m8.md](./execution-plan-m8.md) |
| 10 | M9 — Shared wire-reader extraction | [execution-plan-m9.md](./execution-plan-m9.md) |
| 11 | M10 — Reactive-store + backend factory | [execution-plan-m10.md](./execution-plan-m10.md) |
| 12 | M11 — Polish & spec housekeeping | [execution-plan-m11.md](./execution-plan-m11.md) |

M7–M11 are review-driven follow-ups, sequenced for development flow:
**M7** (isolated `[P0]` bugfixes) → **M8** (the M1 live-stream `[P1]` functional
gap, depends on M7's pipeline touchpoints) → **M9** (`[P2]` wire-reader dedup,
validates M8's new paths) → **M10** (`[P2]` reactive-store + backend factory,
largest churn) → **M11** (`[P1]`/`[P2]` polish + the spec housekeeping that
formally closes phase 3.5).

### Post-completion polish (M12) — optional

| Order | Milestone | Plan |
|-------|-----------|------|
| 13 | M12 — Post-completion polish (review observations) | [execution-plan-m12.md](./execution-plan-m12.md) |

M12 addresses the four "observations worth noting (non-blocking)" surfaced in
the second-pass architecture & code-quality review (part-rendering order policy,
`parseParts` lenience, `svelte-check` warning reduction, `formatCost`
ambiguity). It is **not** required for phase 3.5 to be considered complete —
M11 already closed it — and the tasks are independent `[P2]` improvements that
can ship in any order. Several carry a "decide, then implement" shape where
"document and accept" is a valid outcome.

### Post-M12 product & tooling (M13–M14)

| Order | Milestone | Plan |
|-------|-----------|------|
| 14 | M13 — HTTP Chat beta gate & Dev settings | [execution-plan-m13.md](./execution-plan-m13.md) |
| 14.5 | M13.5 — Lazy OpenCode sidecar & session-tab gating | [execution-plan-m13.5.md](./execution-plan-m13.5.md) |
| 15 | M14 — OpenCode sidecar tooling & port settings | [execution-plan-m14.md](./execution-plan-m14.md) |

M13 gates the experimental HTTP Chat lane behind **Settings → Dev**. M13.5 stops
eager sidecar startup (lazy start on Send + Settings, session-tab gating, circuit
breaker, non-blocking spawn). M14 adds maintainer tooling to refresh bundled
OpenCode sidecar binaries and user-facing **sidecar port** configuration (Option
A: explicit `sidecarPort` in settings).

### Terminology & internal rename (M15–M16)

| Order | Milestone | Plan |
|-------|-----------|------|
| 16 | M15 — OpenCode session terminology (user-facing) | [execution-plan-m15.md](./execution-plan-m15.md) |
| 17 | M16 — Internal session rename (code & persistence) | [execution-plan-m16.md](./execution-plan-m16.md) |

M15 aligns workspace UX with OpenCode: **Session** = conversation, **Agent** =
persona only. M16 renames internal symbols and disk paths to match; no migration
shim (pre-release).

---

## Dependency diagram

```
M0-T1, M0-T2  (SDK foundation — do first)
      |
      v
M1 (message rendering) ──────────► M2 (session management)
      |                                  |
      v                                  v
M3 (composer)                      M4 (config management)
      |                                  |
      v                                  v
M5 (workspace UX) ◄──────────────── M6 (appearance — incremental; no blockers)
```

M6 has no hard dependencies and can ship incrementally alongside any other
milestone. M5 depends on M1 (cost/token data) and M2 (session APIs). Embedded
terminal (M5-T6) is deferred per [questions.md Q7](./questions.md#q7--embedded-terminal-priority).
