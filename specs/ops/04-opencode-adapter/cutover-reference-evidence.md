# Retained native extension comparison evidence

**Updated:** 2026-10-04 20:52 MSK

This finite ledger replaces deleted frontend rich-feature code/tests as comparison evidence. All rows below are unavailable in current common Sessions. Native vendor functionality is separate from a supported host extension. No code from the removed frontend runtime is an active execution or credential path.

| Removed frontend surface | Required later behavior/evidence | Owner/target |
| --- | --- | --- |
| Fork/revert/unrevert | Explicit native checkpoint/fork controls; preserve parent identity and reconcile changed native history | AS06-B-02 |
| Share/unshare | Explicit opt-in native sharing, safe URL and native revoke; no auto-share | AS06-B-02 |
| Manual summarize, native session browsing | Capability-gated lifecycle actions, interrupted-state reconciliation; core compaction events stay supported | AS06-B-02 |
| Commands/arguments | Native catalog schema and argument dispatch, unavailable state where unsupported | AS06-B-02 |
| Todos | Authoritative native projection/reconciliation, real terminal/status updates | AS06-B-02/04 |
| Session diff/file status panels | Native fetch/reconciliation with bounded cache and UI errors; core patch events stay supported | AS06-B-02/04 |
| Language services/formatting diagnostics | Native status/actions and bounded capability UI | AS06-B-03 |
| MCP catalog/connect/disconnect/auth | Native management with host-only credentials and explicit profile/workspace scope | AS06-B-03 |
| Skills/custom/subagents management | Native config/catalog with scope and capability gating; basic primary-mode selection stays core | AS06-B-03 |
| Provider/config/permission/instruction editor | Supported native schema and isolated config scope; no WebView secret editor | AS06-B-03/04 |
| File/text/symbol search | App-owned workspace integration; not a turn or cutover prerequisite | Future workspace integration owner |
| Transcript export | Product-owned local artifact export; not a native cutover requirement | Future export owner |
| Native web/TUI/terminal management | No common Sessions surface or core gate | Future native management owner |

Generic fixture expectations retained for later extension tests: checkpoint actions return native identity and require fresh history; native revoke invalidates a previously shared link; command catalog entries carry required/optional arguments; todos expose stable IDs/status; file differences carry paths/counts/patches; ecosystem/config panels expose bounded structured status and actionable unavailable errors. These are comparison requirements, not claims of implemented contracts. AS06-B-01 must prioritize this ledger; AS06-B-04 owns new host-side fixtures/stores and acceptance.
