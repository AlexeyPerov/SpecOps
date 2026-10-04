# Selected source baseline — AS06-B

Recorded: 2026-10-04 22:58 MSK.
Scope: prior Codex/OpenCode/Claude/handoff source subset plus selected optional local-profile native extensions on Darwin arm64. External endpoints remain core-only; unowned inference/configuration/OAuth/editor/search/export actions are excluded by the finite retained ledger.
Recommendation: **Do not release the expanded subset yet.** Prior [AS06-A baseline](baseline-06-a.md) account/installed/legal/platform/cleanup gates remain open.

| Gate | Evidence and outcome |
| --- | --- |
| Sole host runtime owner and capability absence | Source pass; finite typed extension RPC, unknown-action and advertised/method gates, neutral frontend UI. No vendor SDK import in frontend or old supervisor path |
| Profile/workspace/model/mode/parent and generation isolation | Source pass; native metadata validation, reservations before awaits, pending-create guards, generation checks between native calls and UI selection checks after awaits |
| Fork/checkpoint/revert/restore native history | Source pass; native HTTP fixtures, fresh child index/parent persistence, explicit authoritative history reconciliation and watcher refresh; no prompt replay |
| Native status/catalog/command argument display and MCP connect/disconnect | Source pass; finite fields, unavailable states and selected configured targets. Native command hints are preserved without inventing required/optional argument schema |
| Credential and capacity boundaries | Source pass; known private credentials/transport password scrub before truncation/keys, safe bounded HTTPS share link, bounded native auth file, 16 MiB control body before parsing, 512 KiB/256-row projections, 100 checkpoint messages/240-character labels |
| Real isolated pinned native control smoke | Source pass on Darwin arm64: nine view endpoints plus native empty-session fork/resume; no account/inference or remote publication. A 4 MiB trial was too small for the real provider catalog; 16 MiB finite control limit accepted |
| Source regression | Focused host/native/dispatcher and UI/client/pipeline/persistence fixtures, Svelte/host checks and production builds pass; exact final counts recorded in implementation notes |
| Actual provider file restoration, live catalogs/tool management, remote publish/revoke and account A/B isolation | Open; synthetic fixtures/empty native views cannot close these gates |
| Signed installed startup/recovery/quit, platform/legal/process cleanup and prior runtime/handoff acceptance | Open, unchanged; immediate unobserved descendant exit race remains unaccepted |

Evidence: [AS06-B notes](../06-handoff-native-extensions/implementation-notes-phase-b.md), [finite retained ledger](../04-opencode-adapter/cutover-reference-evidence.md). This record adds selected source evidence and preserves a blocked release recommendation; it does not close AS08-A or the roadmap.
