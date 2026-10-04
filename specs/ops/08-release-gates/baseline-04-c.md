# Selected source baseline — AS04-C

**Recorded:** 2026-10-04 20:52 MSK
**Scope:** Codex and OpenCode native core in shared Sessions; local isolated profiles; macOS arm64 source/native/asset checks. No Claude, Cursor, handoff or rich native controls advertised by this baseline.
**Recommendation:** Release acceptance remains blocked on external evidence.

| Gate | Recorded outcome |
| --- | --- |
| Core source/runtime contracts and production persistence | Pass; [04-C evidence](../04-opencode-adapter/implementation-notes-phase-c.md) |
| SDK/competing-supervisor removal and credential canaries | Pass; host-only private-file import and neutral WebView |
| Runtime/profile isolation, child failure and whole-host loss | Pass with real host process and deterministic native fixtures; no account claim |
| Early writer visibility/Continue/suppression and external refresh | Source fixtures/regressions pass; paid native concurrent writes remain unverified |
| Host/Node/native asset resolver, exact version and no-checkout lifecycle | Source/isolated asset evidence passes; signed installed app acceptance open |
| Live auth/inference/tools/permission/question/cancel/resume/logout | No authenticated account smoke recorded; gate open |
| Installed start/restart/quit, process tree, immediate child-exit race | Installed/manual/platform evidence open |
| Other adapters/profiles/handoff/extensions | Separate implementation/acceptance gates; do not mark Done |

AS08-A remains Planned. Source readiness enables the next requested adapter implementation; neither this subset record nor account-free native smoke closes upstream AS02-D/03-A/B or final roadmap acceptance.
