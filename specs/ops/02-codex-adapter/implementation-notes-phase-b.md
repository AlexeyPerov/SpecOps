# AS02-B implementation and evidence

**Recorded:** 2026-10-04 17:01 MSK

**State:** Experimental developer source slice implemented and automatically verified. Authenticated coding/UI smoke and installed account-B acceptance remain open; no live inference is claimed. C and early 03-A/B can consume the B binding, events and lifecycle.

## Pin and explicit support boundary

The native protocol remains pinned to `codex-cli 0.160.0`. B regenerated 44 contract roots and their 188-file TypeScript dependency closure with the official executable's `--experimental` schema flag. This flag explains additive experimental fields in previously generated contracts, including `GetAccountResponse`; it does not change the runtime pin. Contract regeneration was byte-identical with aggregate path/content SHA-256 `d31a0dd918b79a831ba85e83eb974e90f832ff3868987139aab7abde9c2f7460`.

Official references used: [App Server](https://learn.chatgpt.com/docs/app-server) and [ChatGPT-plan app-server guidance](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server). Generated contracts and actual executable behavior, rather than newer documentation, define the supported pin. Catalog listing remains no proof of model entitlement.

The default handshake still uses `experimentalApi:false`. Experimental behavior requires the user to select **Enable experimental protocol (legacy history, plan and questions)** in the profile panel. The checkbox defaults off, persists as a nonsecret boolean in profile metadata and restarts only that profile. Disabling it settles that profile's active turns; credentials and other profiles are unaffected. A host-only constructor override exists for account-free tests/probes. Native coding creation is blocked before work on profiles without the opt-in, with actionable copy.

This restriction is required by observed history behavior:

| Actual 0.160.0 behavior | Default protocol | Explicit experimental protocol |
| --- | --- | --- |
| `thread/start` | Succeeds; defaults to paginated history | Succeeds with explicitly selected legacy history |
| Metadata-only `thread/read` | Succeeds | Succeeds |
| Full read of a paginated thread | `-32601`, native list-turn implementation unavailable | Not used by the B slice |
| `thread/resume` with `excludeTurns:true` | Experimental field rejected | Available, but B needs legacy full history |
| Full read/resume of an empty legacy thread | Legacy creation is experimental-gated | Explicitly unavailable until first user message materializes rollout |
| Full legacy read/resume after a marker turn | Not used by B | Succeeds with the same thread ID |
| `thread/items/list` | Method unavailable | Method unavailable |
| Plan presets and blocking native user input | Hidden/rejected | Implemented and fixture-verified |

The same limitations were reproduced with the desktop executable and the official npm platform distribution, so the boundary is not inferred from an internal desktop build. The comparison fetched `@openai/codex@0.160.0-darwin-arm64` into a temporary directory only; package tarball SHA-1 was `f78898f04bc6989ab371de42b6acdbf56b54dc9c`. Nothing was installed globally or added to the repository.

The no-account experimental probe used temporary profile/workspace directories, initialized the official npm binary, explicitly created a legacy thread, then sent one local protocol marker to materialize native history. `turn/start` accepted the marker; account state stayed auth-required, and successful inference was **not** accepted. Full `thread/read`, same-ID `thread/resume` and `thread/turns/list` then succeeded. No login, API key or default desktop-home read occurred. Empty native threads are not silently replaced after restart. The unavailable paginated-items method stays outside supported B history; deeper pagination/reconciliation is C work.

Reproduce from the repository root:

```sh
node app/host/scripts/generate-codex-contracts.mjs
node app/host/scripts/probe-codex.mjs
SPECOPS_PROBE_EXPERIMENTAL=true node app/host/scripts/probe-codex.mjs
npm run check --prefix app/host
npm test --prefix app/host
npm run check --prefix app
npm test --prefix app
npm run build --prefix app/host
npm run build --prefix app
```

`SPECOPS_CODEX_EXECUTABLE` can select an absolute pinned official executable. The experimental probe is an explicit opt-in and sends the account-free marker described above; the default probe does not send a turn.

## Native binding, settings and history

Native creation records independent SpecOps and native identities, the selected profile, workspace cwd, model, reasoning effort, collaboration mode, sandbox, approval policy and actual write capability. The host validates supported catalog/model/effort/mode combinations and settings enums. Sandbox policy and native user approval routing are applied to thread creation/resume; reasoning effort and supported collaboration mode reach native turn requests. Read-only is a native sandbox setting. The creation UI exposes effort, sandbox and approval separately; experimental plan modes appear only in opted profile catalogs. A model change picks a supported effort. Steer, attachments and secret questions are outside this slice and cannot be silently interpreted as supported.

Resume reads the bound thread first, rejects missing profile/history or another workspace/native identity and resumes only the same profile/thread. Missing history has a typed `session-not-found` error. There is no hidden thread creation or prompt replay. A fresh host/app reconstructs completed legacy history with stable native turn IDs and user client IDs; the production transcript codec preserves native turn/item IDs. The pipeline hydrates native messages/tools/reasoning/files, replaces completed cached assistant messages and retains the new unsent user message. B covers minimum completed-history continuation; C owns deeper divergent-cache reconciliation and richer history ledgers.

The integration test drives a real synthetic native child through the actual HostDispatcher, typed frontend client, production chat pipeline and disk writer. It reloads disk into fresh app state, starts a fresh adapter/profile child, resumes the same native thread and continues it. Assertions verify settings/profile identity, exactly one original user/assistant pair, one native `thread/start` and only the two explicitly sent prompts in native history. This is a production-path fixture, not a codec-only round trip.

## Events, interactions and settlement

Each native turn has a bounded push queue and a profile/thread/native-turn/generation correlation boundary. Native text/reasoning IDs, tool IDs, per-session monotonic host sequence and native generation flow through normalized events. Text assembly uses authoritative completed native items; duplicate completions and stale deltas are ignored. Tool start/output/result, file hints, reasoning, usage, retry/failure and additive unknown/malformed events are mapped; diagnostic payloads omit raw secrets. Usage takes the first update's last call and then native cumulative increments, avoiding totals from previous turns. Every active stream starts once, ends with one terminal and closes its iterator. Oversized frames/queues fail closed with bounded terminal settlement.

Command and file approvals retain opaque native RPC request correlation, callback/item context, profile/thread/turn and child generation. Allow once, allow for the native session, deny, cancel and timeout each resolve once. Secret/unsupported native interactions are rejected, never automatically approved. Blocking native questions map each supported question to an opaque extension token and collect native answer arrays; duplicate, cross-turn, stale and late replies cannot affect another request. Interaction deadlines default to five minutes; expiry sends cancellation, interrupts native work and settles the turn.

Prompt brokerage retains a pending request across component remount. The stream observer keeps receiving native terminal/failure while the UI awaits an answer, aborts/dismisses the prompt on native loss or cancellation, bounds buffered bytes and cancels/returns the producer when the consumer exits early or overflows. The UI labels session-scoped approval honestly. Tests cover prompt remount, no unanswered promise after interruption, observer UTF-8 byte overflow and early-consumer disposal.

Native `turn/interrupt` is used for Stop. The source requests a 750ms response deadline and settles the iterator; uncertain interruption retires the selected profile child. User cancellation maps to cancelled, unsolicited native interruption to a distinct failed message, and native failure/process loss to failed. No file rollback is attempted. Native profile exit settles active streams; existing client host-status/generation monitoring settles host loss. A production-path fixture kills the child while approval UI is waiting and verifies prompt dismissal, terminal failure and no generating state within 1.5 seconds. Automated cancellation fixtures complete within one second and permit the next explicit send/resume. These bounds are fixture acceptance, not authenticated-runtime measurements.

## Verification and open gates

- 94 host tests passed, including 21 new native/shared-contract tests and all 12 existing isolated-profile/auth tests. The unchanged shared behavioral contract runs against the native process fixture, including replacement adapter resume, typed missing history, deterministic unknown/malformed diagnostics and cancellation iterator closure.
- 3,229 frontend tests passed across 293 files. New tests cover production native persistence/restart/continuation, waiting-approval child loss, prompt remount/abort, separate settings UI and observer terminal/overflow/disposal.
- Host TypeScript and frontend Svelte checks passed; frontend check reports zero errors/warnings. Both production builds passed. Existing canvas-stub notices and frontend chunk-size advisory remain. No Rust source changed in B.
- The official no-account legacy probe and deterministic schema regeneration passed. Default native-account credentials were never copied. No persisted-data migration or compatibility shim was added.

**Still pending:** perform a real coding task through SpecOps UI while desktop account A remains signed in and isolated account B is authenticated; inspect real command/file effects, allow/deny/question/Stop, terminate the whole supervised host mid-turn, launch a fresh app and continue the same materialized thread without replay. Real model entitlement, native interruption timing and actual account-A/account-B preservation cannot be accepted from fixtures or the no-account marker. Installed/PATH-independent packaging, whole-process/descendant recovery acceptance and usable preview remain D + 03-A/B gates. C must retain the default-off experimental support boundary and replace B's minimum settings UI with richer capability/configuration descriptors as appropriate.
