# Selected source baseline — AS05-D

Recorded: 2026-10-04 22:10 MSK.
Scope: Codex/OpenCode/Claude common Sessions source, local isolated profiles and dedicated Claude API key; Darwin arm64 source and copied assets. SDK 0.3.289 / native 2.1.289 / Node 24.15.0 for Claude. Existing Codex/OpenCode scope and pinned versions remain in [04-C baseline](baseline-04-c.md). No Cursor, handoff or rich ecosystem extensions advertised.
Recommendation: **Do not release this expanded subset yet.** Installed/live/platform/legal gates below remain open. Earlier-runtime release does not depend on Claude acceptance.

| Repeatable selected gate | Outcome |
| --- | --- |
| Core/contracts and bounded native lifecycle | Source pass; [A–D evidence](../05-claude-adapter/implementation-notes-phase-d.md). Final host regression recorded below |
| Native permission/questions/policy | Pinned SDK callback wire and source fixtures pass; real native provider enforcement unverified |
| Failed profile/runtime, coexistence, host loss | Source pass; independent profile faults and real production host subprocess SIGKILL settle all three runtime streams, including pending approval, without replay/new binding |
| Credential/environment/cache/control/export boundaries | Source pass; fragmented text, errors, identity envelopes, raw diagnostics, private storage, stderr, production disk/corrupt-cache and three-runtime support export canaries |
| Writer/Stop/workspace behavior | Existing early source fixtures pass; native actual concurrent writes/editor refresh acceptance still open |
| Host/native packaging and resolve | Copied asset control-only Darwin arm64 probe passes outside checkout; five discovered models; no developer fallback |
| Live auth/inference/tool/allow/deny/question/cancel/resume/logout and account A/B | Open: no actual key or paid provider smoke |
| Signed installed start/restart/quit/cleanup; native managed policy; distribution legal review | Open: source and copied assets are insufficient |
| Other supported platforms / immediate unobserved descendant exit | Open: no installed Windows/Linux matrix or complete race closure |
| Handoff/extensions/Cursor/full roadmap | Separate phases open; not claimed by this subset |

Repeat commands: `npm --prefix app/host test`; `npm --prefix app/host run check`; `npm --prefix app test -- --run src/lib/session/host/nativeHostDeath.test.ts src/lib/services/chatPersistence.integration.test.ts src/lib/services/sessionSupport.test.ts`; `npm --prefix app run check`; `npm --prefix app run build`; `npm --prefix app/host run build`; `node app/host/scripts/probe-claude.mjs`.

Actual run: selected frontend **13 passed**; Svelte **0 errors / 0 warnings**; host/frontend checks/builds and copied-assets probe passed. Final full host regression: **223 passed / 4 explicit opt-in skips**; D-specific native fault/security suite: **18 passed**. Four host tests are opt-in account-free native probes, not waived release gates. AS08-A remains open; no task is Done solely because fixtures passed.

**Current gate update (2026-10-05):** This is a historical phase snapshot. The [AS08-A expanded record](release-2026-10-05.md) reruns the four-runtime source scope, records repeatable checks and retains all external acceptance blockers. AS08-A source tooling/docs are verified; release and full roadmap closure remain open.
