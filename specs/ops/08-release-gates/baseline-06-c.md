# Selected source baseline — AS06-C

Recorded: 2026-10-04 23:17 MSK.
Scope: prior Codex/OpenCode/Claude/handoff/native-extension source subset plus simultaneous named Codex profiles.
Recommendation: **Do not release the expanded subset yet.** Prior [AS06-B baseline](baseline-06-b.md) account/installed/legal/platform/cleanup gates remain open.

| Gate | Evidence and outcome |
| --- | --- |
| Named profile lifecycle and immutable native binding | Source pass: create/select, rename stable UUID, local logout/remove, explicit missing state and retained workspace/application/native history; no sibling deletion/rebinding |
| Durable account identity | Source pass: profile-private persisted native-ID/principal guard; native API key/account ID, token refresh stability, strict unknown-principal failure, wrong-account fresh-host rejection/original-account recovery; no migrations |
| Controlled profile environment/config | Source pass: finite execution environment and private HOME/CODEX_HOME/XDG/Windows roots; credential/runtime/proxy/injection canaries absent; independent home config/history and intentional common workspace |
| Equal IDs/concurrent profile faults | Source pass: two real fixture processes, equal native/thread/turn IDs, Stop/quota/child crash/restart, generation counters, delayed authentication reservation and sibling continuity |
| Application persistence and whole-host loss | Source pass: production dispatcher/client/pipeline/store/disk two-profile reload without transcript transfer/replay; actual bundled-host SIGKILL settles both separate-profile streams |
| Advisory concurrent writers | Source pass: existing common activity/warning identifies runtime/profile/session with native read-only classification; no locks/account rotation |
| Actual two-account concurrent/resume/logout contract | Open: opt-in private-file/paid-native harness exists but was not run; distinct fixture keys are not actual account proof |
| Signed installed, native browser/account A/B, supported platforms/legal/cleanup | Open, inherited; experimental legacy history default-off, immediate unobserved descendant race remains unaccepted |

Evidence: [AS06-C notes](../06-handoff-native-extensions/implementation-notes-phase-c.md). This records selected source verification and keeps AS08-A/release acceptance open.
