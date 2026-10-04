# Selected source baseline — AS07-A

Recorded: 2026-10-04 23:33 MSK.
Scope: prior Codex/OpenCode/Claude/handoff/extensions/named-profile source subset plus Cursor local SDK bootstrap.
Recommendation: **Do not release the expanded subset yet.** Prior [AS06-C baseline](baseline-06-c.md) gates remain open.

| Gate | Actual evidence |
| --- | --- |
| Official local SDK feasibility | Source/native control pass: SDK 1.0.35 exact pin, native JSONL create/dispose/resume without inference; public stream/cancel/hook/policy surface ledger recorded |
| Secret-safe isolated profiles/auth/catalog | Source fixtures pass: private API-key import/status/read/logout, explicit SDK account/catalog calls, selected-key catalog, generation/abort, finite private environment, bounded nonsecret results; actual credentials not tested |
| Installed asset resolution | Copied payload/Node outside checkout pass on Darwin arm64; full chunks/dependencies/platform parser/search/sandbox assets retained, manifest checks; no global CLI or developer module fallback |
| Browser/interactions/cloud | Honest unsupported state; native browser key-minting documented but host lifecycle absent; no fabricated approval/question or Cloud implementation |
| Native authenticated local turns and policy | Open: B/C source mapping/policy and paid native/installed acceptance remain necessary |
| Distribution/OS/cleanup | Open: SDK/Terms/native notice review, signed installation, Windows/Linux/native enforcement, immediate unobserved descendant race; inherited experimental legacy Codex history/account gates remain open |

Evidence: [AS07-A notes and feasibility ledger](../07-cursor-adapter/implementation-notes-phase-a.md). Source progress is not full A acceptance or AS08-A closure.
