# AS09-F — Installation and recovery UX source evidence

**Date:** 2026-10-10

**Disposition:** F-01–F-03 source/fixture acceptance passes. F-04–F-06 UI boundaries are implemented; G maintenance metadata/retained update offers and actual clean installed/account/multi-window accessibility acceptance remain open. The signed production catalog still offers no available downloads; this UI cannot fabricate a working Install action.

## Implemented behavior

Settings has a Software tab, separate from Sessions account profiles. Sessions and handoff reviews expose the same scoped software panel. Inventory shows exact versions, authenticated platform/reason, compressed and installed bytes when a manifest exists, shared prerequisite versions, selected/retained status and unavailable/unsupported reasons. An unavailable manifest displays unavailable sizes rather than estimates invented from source artifacts. Native diagnostics now export these bounded catalog fields without archive URLs or private paths.

Opening settings, changing runtime/profile dropdowns, inventory refresh and event subscriptions start no download or host/provider execution. A reviewed plan binds the finite agent/shared runtime versions, exact estimated transfer/free-disk bytes, trusted catalog revision, digest and expiry. Only Install reviewed components sends a confirmation. Dismiss/Escape creates no software job, account change or native session. Runtime/profile selection remains in its owning Sessions/handoff view; saved session and saved approved handoff bindings remain persisted by their existing owners. No new persisted-data format or migration was added.

Progress renders native downloading, verifying and installing/probing states, known or indeterminate totals and actual cancellation completion. A cancel request stays pending until a native terminal state arrives. Event operation/generation/sequence filtering rejects stale progress; read-only diagnostics restore jobs after reopening and refresh each window every 1.5 seconds and on focus. Foreign operation errors tell the user to use the original window. Installation completion offers explicit connection review, without authentication, native session creation, prompt submission or replay. Account connection still requires its existing explicit action.

Retry reviews the same unexpired finite plan and confirms through the native retry API. Expired or reopened reviews require a new native plan and a fresh confirmation. Missing network, disk, integrity, target/probe compatibility, catalog/distribution, storage and ownership failures have bounded actionable wording. Neither retries nor late failed jobs overwrite healthy inventory state. A selected runtime's connection commands are gated by installed verified software; runtime changes reset the readiness guard before awaiting discovery.

Tested-update, retained-version selection and reviewed removal controls use finite native commands; removal review explains preserved workspace/account/history data and shared/running blockers. Cache cleanup preserves installed software. Native software/version selection already enforces full compatibility and running-version locks. **Current native inventory does not yet emit tested-update offers or a complete retained-version/space-reclamation ledger; G owns that producer and complete native-data compatibility policy.** The fixture controls validate the UI boundary and do not imply a live production update offer or compatible rollback exists.

Handoff confirmation additionally requires installed destination software, and the existing profile/model/catalog requirements remain. A missing destination's software review/dismiss keeps the saved profile, target identity and exact approved first prompt; no native creation/send occurs. The source transcript and session binding are unchanged. Installation continuation returns to review, and a saved handoff approval retains its model/policy/prompt instead of catalog defaults replacing them.

Controls use native keyboard buttons, visible focus rings, review focus/return focus, Escape dismissal and polite live stage/progress announcements. Offline wording keeps the editor and installed runtimes available subject to native provider requirements. Missing components require network; no unverified import path is offered.

## Verification

App 0.3.0; Agent Host compatibility 0.1.0; Darwin arm64 source environment; component fixture versions Node 24.15.0, Codex 0.160.0, OpenCode 1.17.4. Browser tests are bounded no-account fixtures. Production catalog revision 1 remains unavailable; no distribution/account result is inferred from source tests.

| Check | Result |
| --- | --- |
| Six focused frontend suites: SoftwarePanel, ConnectionProfilePanel, SessionHandoffDialog, settings navigation, component event decoder and passive connection runtime | Pass: 35 tests |
| Exact versions/dependencies/byte review; no implicit install; dismiss/Escape focus return; finite explicit confirmation | Pass: UI fixtures |
| Stage/unknown total, actual cancel pending, late status rejection, same-plan reviewed retry and explicit post-install continuation | Pass: UI fixtures |
| Restored job after unmount/reopen and foreign-window cancel recovery | Pass: UI fixtures |
| Update review, retained selection/in-use error, reviewed removal/cache cleanup and finite failure families | Pass: UI fixtures; live G inventory producer remains open |
| Missing destination keeps saved handoff approval/profile/exact prompt, no create/send/install after dismissal | Pass: UI fixture |
| Svelte official docs/autofixer on all edited components; app check | Pass: no Svelte issues; 0 errors / 0 warnings |
| Repository Markdown links | Failed: pre-existing untracked editor-spec link in `docs/architecture.md` and missing archived terminal-question anchor; no F link failures |
| App production build | Pass; existing large-chunk/pure-comment bundler notices remain |
| Native manager suite | Pass: 15 tests; 1 explicitly opt-in real-candidate test skipped (previous E actual candidate evidence remains separate) |
| Native diagnostic metadata test | Pass: exact catalog platform/sizes/dependency with path-free diagnostic assertion |
| Actual signed installed first use/reinstall/accounts, app restart/recovery with real large production payloads, multi-window keyboard/screen-reader/manual UX | Not-run; production distribution unavailable; G/H acceptance remains open |

The first UI run caught focusing a disabled Install button; review now enables the button before transferring focus. The pre-existing handoff fixture lacked installed component/running host state after D; it now declares that fixture prerequisite explicitly. Final focused tests pass. No tests start provider work, download vendor payloads, publish artifacts or alter account/history data.
