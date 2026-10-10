# Operations — active execution queue

[Roadmap and dependencies](roadmap.md) · [Completed records](done/README.md)

| Order | Scope |
| --- | --- |
| 01 | [Foundation acceptance stabilization](01-foundation-stabilization/README.md) |
| 02 | [Codex native harness and isolated account](02-codex-adapter/README.md) |
| 03 | [Early Codex preview delivery](03-codex-preview-delivery/README.md) |
| 04 | [OpenCode core cutover](04-opencode-adapter/README.md) |
| 05 | [Claude native adapter](05-claude-adapter/README.md) |
| 06 | [Handoff and later native extensions](06-handoff-native-extensions/README.md) |
| 07 | [Cursor native adapter after feasibility](07-cursor-adapter/README.md) |
| 08 | [Repeatable release gates and final closure](08-release-gates/README.md) |
| 09 | [Plugin-based agent usage and on-demand components](09-plugin-based-usage/README.md) |

Folders sort in the default delivery order. Stage 03 is an early gate for installed Codex acceptance in 02-D. Stage 08 runs for each selected release, including the first Codex preview; its final closure follows the complete queue, including the planned on-demand delivery in 09. Completed implementation/review evidence lives in `done`; unresolved acceptance is kept in active plans.

Codex A–G source now includes native session controls, finite ecosystem/configuration and native agent/context cards. The [finite feature ledger](02-codex-adapter/implementation-notes-phase-g.md) and [selected parity submission](08-release-gates/release-2026-10-05-codex-parity.md) distinguish source evidence from open authenticated/installed acceptance.

Stage 09 plans a lean base app with native installation of shared Node and optional agent payloads. All 48 tasks are open; it replaces bundled delivery only after its bootstrap/resolution path is verified and runs a fresh selected 08 gate.
