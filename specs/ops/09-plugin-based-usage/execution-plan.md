# 09 — Execution plan index: Plugin-based agent usage

**Updated:** 2026-10-11

**Status:** A–H source implemented; 23 accepted source tasks, 25 open full-acceptance tasks. Lean local candidate and exact native no-account controls pass; selected release blocked.

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

A–H source implementation is recorded in each phase evidence file. A-01/A-06,
B-01/B-03/B-06, C-01, D-01/D-03/D-05/D-06, E-01–E-04, F-04–F-06,
G-01/G-03/G-05 and H-01–H-04/H-06 retain their stated installed/account/distribution
acceptance (25 tasks). E/H verify all five exact native candidates with the real
native installer under test-only trust and no-account production resolvers. H removes
heavy base packaging, records local size/inventory and introduces a blocked version-2
selected release schema without modifying historical records. Source evidence does
not establish actual signed installed/account/process acceptance. Full AS09 still
covers all four agents on the first supported target; no accounts, paid inference or
publication are authorized merely by a planning document.


Phase A fixes numeric budgets before implementation acceptance. Phase B fixes signed catalog/artifact policy before production installs. Phase C owns installation natively; it cannot require the not-yet-installed Node or an active Agent Host. Phase D/E preserve immutable profile/session/native ownership. Phase G/H prove secure maintenance and actual lean delivery.

## Task tracking

Task prefix is `AS09-<phase>-<NN>`. Each phase defines six tasks with concrete acceptance; A-02–A-05 B-02/B-04/B-05 C-02–C-06 D-02/D-04 E-05/E-06, F-01–F-03, G-02/G-04/G-06 and H-05 source contracts/security/gates are `[DONE]`; A-01/A-06 and B-01/B-03/B-06 retain their stated acceptance gates. Record source fixtures, actual no-account probes, authenticated evidence, signed installed tests and distribution decisions separately. Mark only implemented and accepted tasks `[DONE]`; unresolved acceptance stays visible.

When implementation lands, add phase implementation evidence, update this index/README/roadmap and dated `specs/changelog.md` entries. Preserve historical release records. Follow repository direct-to-master workflow; do not add persisted-data migrations or compatibility shims.

[D evidence](implementation-notes-phase-d.md) accepts static no-start discovery and all-five process-generation leases, with native/host/frontend source checks and explicit production/installed bootstrap/vendor/reinstall gates.

**AS09-E source evidence (2026-10-10):** [Managed agent notes](implementation-notes-phase-e.md) record all-four real copied managed controls, a separate managed OpenCode SDK recipe, independent shared Node reuse and first-party registration. E-05/E-06 source acceptance passes; account/native-policy/clean signed installed/distribution gates for E-01–E-04 remain open. Historical inventories remain preserved; H removes heavy base bundle declarations after actual native replacement controls.

**Phase F source evidence:** [Installation and recovery UX](implementation-notes-phase-f.md): F-01–F-03 source/fixture acceptance passes; F-04–F-06 UI boundaries implemented. G implements retained/update producers; real installed/account/multi-window accessibility remains open.

**AS09-G source evidence (2026-10-11):** [Maintenance and security](implementation-notes-phase-g.md) implements accepted signed metadata caching/refresh, compatible update/in-use/retained inventory, actual allocated disk ownership/retention, reviewed group removal, fd-relative nofollow mutations, leased request revalidation after revocation and bounded reviewed signing-key overlap. G-02/G-04/G-06 source acceptance passes; actual native-store/clean signed installed/full-disk/reboot/adversarial gates for G-01/G-03/G-05 remain open. Production catalog/hosting/distribution remains unavailable.

**AS09-H source evidence (2026-10-11):** [Lean candidate and release acceptance](implementation-notes-phase-h.md) records actual base build/inventory, repeatable size/cost gates, full source regression and fresh native-managed no-account controls. H-05 source gate acceptance passes; H-01–H-04/H-06 remain open for signed installed/account/baseline/platform/process/publication acceptance. [Selected AS08 version-2 record](../08-release-gates/release-2026-10-11-components.md) is blocked; no downloadable component platform is advertised.
