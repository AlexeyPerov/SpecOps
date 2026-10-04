# Selected source baseline — AS06-A

Recorded: 2026-10-04 22:36 MSK.
Scope: prior Codex/OpenCode/Claude source subset plus user-reviewed fresh native-session handoff on Darwin arm64/Unix durable storage. No Cursor/native extension/multiple-Codex-profile acceptance is advertised.
Recommendation: **Do not release the expanded subset yet.** [Prior baseline](baseline-05-d.md) live/installed/legal/platform/cleanup gates remain open.

| Gate | Evidence and outcome |
| --- | --- |
| Bounded review/edit/remove/cancel and exact approved first prompt | Source pass; common packet/redaction/review UI fixtures. No target creation/send before confirmation |
| Fresh native target, immutable account/model/policy, neutral lineage | Source pass; 9/9 ordered Codex/OpenCode/Claude adapter contract pairs, distinct source/target profiles, production host client/pipeline/store/disk |
| Lost create/send acknowledgement, storage failure, concurrency, no duplicate target/prompt | Source pass; strict native CAS/lock/fsync and intent boundary fixtures, single-use send permit, ordinary Retry/cache corruption gates |
| Workspace paths/private files/symlink/capacity | Darwin arm64 native source pass; descriptor-relative no-follow reads and journal writes. Other platforms fail closed where safe storage is unavailable |
| Full regression | Frontend 2,913 passed; host 223 passed/4 opt-in skips; focused 64 passed; full Rust 79 passed (including native intent/excerpt test); final UI 3 passed; Svelte 0/0 and frontend build pass |
| Actual enabled account/provider pair handoff and native policy enforcement | Open; synthetic contract fixtures cannot close this gate |
| Signed installed recovery/start/quit/cleanup and filesystem durability/platform behavior | Open; copied/source assets and Unix tests are insufficient. Windows confirmation remains unavailable until safe durable storage is implemented/accepted |
| Prior auth/platform/legal/descendant-race gates | Open, unchanged from prior selected baseline |

Evidence: [AS06-A implementation notes](../06-handoff-native-extensions/implementation-notes-phase-a.md). Rerun selected 08-A after live/installed evidence or each newly advertised feature; no roadmap completion or release acceptance is inferred from fixture success.
