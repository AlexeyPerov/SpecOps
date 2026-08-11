# 04 — OpenCode adapter migration

**Status:** Planned  
**Date:** 2026-08-11  
**Main doc (SSOT):** [`../roadmap.md`](../roadmap.md)  
**Execution plan:** [`execution-plan.md`](execution-plan.md)  
**Phase plans:** [A](execution-plan-phase-a-host-lifecycle.md), [B](execution-plan-phase-b-core-parity.md), [C](execution-plan-phase-c-extensions-ui.md), [D](execution-plan-phase-d-cutover-exit.md)

This milestone moves the completed OpenCode integration behind Agent Host while
preserving its useful depth through optional extensions rather than expanding
the mandatory common adapter contract.

## Locked decisions (2026-08-11)

| # | Topic | Choice |
| - | ----- | ------ |
| 1 | Ownership | Agent Host owns the SDK/client and all runtime children |
| 2 | Common core | Do not reshape it around OpenCode-specific capabilities |
| 3 | Rich features | Preserve them through explicit optional extensions |
| 4 | Persistence | Start clean; do not migrate legacy session state |
| 5 | Cutover | Remove direct frontend client and old supervisor only after parity evidence |

## Goal

Claude, Codex, and OpenCode sessions coexist under the same host and UI, with
the existing integration’s user-visible behavior preserved or explicitly deferred.

## Scope

| ID | Item | Current state |
| --- | ---- | ------------- |
| AS04-A | Move client/runtime lifecycle into Agent Host | Legacy direct path |
| AS04-B | Core session, stream and interaction parity | Legacy implementation |
| AS04-C | Optional feature extensions, stores and settings UI | Provider-shaped |
| AS04-D | Legacy-path removal, fixture comparison, packaging exit | Missing |

## Outcome

- The frontend bundle contains no runtime SDK import.
- Tauri supervises only Agent Host; Agent Host owns the runtime process tree.
- Existing capabilities retain parity or have an explicit deferred record.

## Dependencies

- **Phases 01–03** — Done; common contract proven by two independent adapters.

**Blocks:** phase 05 and the first broad Sessions beta.

## Out of scope

- Migration of old persisted AI sessions.
- Adding provider-specific methods to the mandatory adapter core.
- New features not required for existing behavior parity.

## Risks

- **Large parity surface** — cut over in slices and compare recorded normalized
  events before deleting the legacy path.
- **Double process ownership** — establish Agent Host ownership first and keep a
  single supervisor active in every intermediate state.

## Definition of done

- All phase plans A–D and legacy/new fixture comparisons pass.
- Cross-platform packaging smoke passes before broad beta.
- Status is changed to Done here and in [`../roadmap.md`](../roadmap.md).

### Definition of done — docs

- [ ] Capability parity/deferment table finalized.
- [ ] Runtime settings and recovery docs updated.
- [ ] Changelog entry appended in [`../../changelog.md`](../../changelog.md).
- [ ] Exit criteria manually reviewed before phase 05 starts.
