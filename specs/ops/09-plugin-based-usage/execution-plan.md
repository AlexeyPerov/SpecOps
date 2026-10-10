# 09 — Execution plan index: Plugin-based agent usage

**Updated:** 2026-10-10

**Status:** A/B/C, D-02/D-04 and E-05/E-06 source contracts/security accepted (16 tasks); 32 open tasks across eight phases, including A-01/A-06 acceptance

**Scope:** [README](README.md) · [Roadmap](../roadmap.md)

## Execution order

| Phase | Plan | Effort | Tasks |
| --- | --- | --- | --- |
| A | [Component contracts and distribution decisions](execution-plan-phase-a-component-contracts.md) | XL | 6 |
| B | [Trusted component artifacts and catalog](execution-plan-phase-b-artifact-pipeline.md) | XL | 6 |
| C | [Native bootstrap and durable installer](execution-plan-phase-c-native-install-manager.md) | XL | 6 |
| D | [Lazy Agent Host and installed component resolution](execution-plan-phase-d-lazy-host-runtime-resolution.md) | XL | 6 |
| E | [All four agent components and future adapter registration](execution-plan-phase-e-agent-components.md) | XL | 6 |
| F | [Agent installation, first use and recovery UX](execution-plan-phase-f-installation-ux.md) | XL | 6 |
| G | [Updates, storage maintenance and security hardening](execution-plan-phase-g-maintenance-security.md) | XL | 6 |
| H | [Lean release packaging and installed acceptance](execution-plan-phase-h-release-acceptance.md) | XL | 6 |

Effort is relative scope, not a calendar estimate. The full plan includes shared Node download, all four agent payloads, native bootstrap, trusted distribution, maintenance UX and actual installed acceptance.

```text
A → B → C → D → E ───────────┐
        C + D + E → F ──────┼→ G → H → selected AS08-A release gate
A budgets + B distribution ─┘
```

E's four agent integrations can be implemented independently after the shared resolver is stable. B's publication preparation may proceed beside C fixture development; production publication remains a separately authorized action. F skeletons may use C typed fixtures before every E adapter lands, but full F acceptance requires their real descriptors/resolvers. G hardening starts alongside C/D; its exit follows integrated F. Do not remove required bundled production payloads until the replacement install/bootstrap path is functional and verified.

## Scope and acceptance boundary

A contracts, B trusted artifact pipeline, C native installer and D lazy host/resolver are implemented; A-01/A-06 and B-01/B-03/B-06 acceptance plus C-01/D-01/D-03/D-05/D-06 and E-01–E-04 and F–H remain open. [C evidence](implementation-notes-phase-c.md) records native installation/security/crash/ownership fixture acceptance and its installed gates. [B evidence](implementation-notes-phase-b.md) records exact native/candidate/copied controls and production unavailable gates. [A evidence](implementation-notes-phase-a.md) distinguishes source passes, missing finite native payloads, numeric budgets and unavailable clean installed baseline. Existing source adapter evidence is reusable where unchanged, but component delivery changes require fresh installed/signing/distribution/account/process evidence. H covers all four agents for full AS09 completion; selected smaller releases remain possible without silently shrinking this milestone. No account credentials, paid inference or publication is authorized merely by this planning document.

Phase A fixes numeric budgets before implementation acceptance. Phase B fixes signed catalog/artifact policy before production installs. Phase C owns installation natively; it cannot require the not-yet-installed Node or an active Agent Host. Phase D/E preserve immutable profile/session/native ownership. Phase G/H prove secure maintenance and actual lean delivery.

## Task tracking

Task prefix is `AS09-<phase>-<NN>`. Each phase defines six tasks with concrete acceptance; A-02–A-05 B-02/B-04/B-05 C-02–C-06 D-02/D-04 and E-05/E-06 source contracts/security are `[DONE]`; A-01/A-06 and B-01/B-03/B-06 retain their stated acceptance gates. Record source fixtures, actual no-account probes, authenticated evidence, signed installed tests and distribution decisions separately. Mark only implemented and accepted tasks `[DONE]`; unresolved acceptance stays visible.

When implementation lands, add phase implementation evidence, update this index/README/roadmap and dated `specs/changelog.md` entries. Preserve historical release records. Follow repository direct-to-master workflow; do not add persisted-data migrations or compatibility shims.

[D evidence](implementation-notes-phase-d.md) accepts static no-start discovery and all-five process-generation leases, with native/host/frontend source checks and explicit production/installed bootstrap/vendor/reinstall gates.

**AS09-E source evidence (2026-10-10):** [Managed agent notes](implementation-notes-phase-e.md) record all-four real copied managed controls, a separate managed OpenCode SDK recipe, independent shared Node reuse and first-party registration. E-05/E-06 source acceptance passes; account/native-policy/clean signed installed/distribution gates for E-01–E-04 remain open. Historical inventories and heavy bundles are retained until H.
