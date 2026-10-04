# AS02-C implementation and evidence

**Recorded:** 2026-10-04 17:32 MSK

**State:** Source implementation and automated acceptance for the explicitly opted experimental **legacy history** slice. Baseline coding, authenticated account-B inference, installed preview and whole supervised-host acceptance remain open. The default-off persisted profile gate from B remains unchanged.

## Pinned execution / display / configuration ledger

The supported executable remains `codex-cli 0.160.0`. Official [App Server documentation](https://learn.chatgpt.com/docs/app-server) was fetched for configuration/account/history research; actual generated contracts and B's official npm + desktop executable probes determine support. New generated roots are only `GetAccountRateLimitsResponse` and `AccountRateLimitsUpdatedNotification`; the generator now retains 46 schema roots and their 199-file TypeScript dependency closure. Regeneration was byte-identical with aggregate relative-path/content SHA-256 `f97bbf60a16b60f209b751a21b08b3954c8f806c392352dd9a18acbc942a1385`. No model entitlement or live account state is inferred from catalogs or fixtures.

| Native feature | Native execution | SpecOps display | SpecOps configuration / scope | Evidence and deferral |
| --- | --- | --- | --- | --- |
| Workspace instructions | Native harness loads instructions for thread cwd; SpecOps passes cwd, never reconstructs system prompts | Workspace path / native session binding | Native-owned workspace files, no editor in this slice | B create/resume request fixtures; authenticated instruction-obedience smoke remains open |
| Profile config | Native process reads isolated profile `config.toml` | Profile label and session scope description | Native-owned profile file; no general TOML writer. Session overrides do not modify it | Profile-home/config permissions and unchanged-config fixtures |
| Model and effort | Native model catalog validates model + supported effort; selected default effort is model-specific | Separate model/effort controls from optional schema | Session binding/request only | Configuration fixtures, including high-only model default; not an entitlement check |
| Collaboration | Default; plan only on opted profile | Native catalog modes, absent plan control without opt-in | Session mode; independent effort/sandbox/approval | B request tests and persisted profile experimental flag |
| Sandbox / approvals | Native thread creation/resume applies sandbox + approval policy; turn request applies approval policy | Separate optional session controls; approvals use normalized UI | Session override; no profile/global writes | Settings validation, actual typed requests and permission fixtures |
| Native plans / questions | Experimental plan preset and supported blocking questions; secret questions rejected | Catalog plan option and blocking questions only on opted profile | Explicit default-off profile protocol flag; no native-plan editor | B/C conditional capability fixtures; native planning-progress UI deferred |
| Skills | Native configuration may provide skills; independent skill execution not smoke-accepted here | No advertised skill panel | Native-owned files; no SpecOps skill configurator | Deferred to a later extension slice; no catalog/management capability advertised |
| MCP / plugins | Native configuration may provide tools; normalized supported MCP call items can be displayed | Generic native tool result, no server/plugin management panel | Native-owned configuration; no installation or configuration writer | B tool mapping; live extension inventory/execution/configuration deferred |
| Hooks / subagents | Native harness configuration only; independent native behavior not accepted here | No advertised hook/subagent control | Native-owned settings; no SpecOps control | Explicitly deferred; generated nested types alone are not evidence of UX support |
| Native coding actions | Start/read/resume, explicit send, interrupt, correlated approve/deny/answer | Text, reasoning, tool/file hints, terminal/recovery states | Session/profile identity binding | B/C shared and production fixtures; fork/rewind/share/steer/attachments remain absent |
| Account / usage / limits | Official account read/login/logout; rate-limit read and sparse rolling updates | Profile account, per-bucket remaining usage/reset, quota/auth/offline/retry hints | Profile only; no auto account rotation, quota retry or sign-in | Pinned contracts, sparse merge/account identity/logout/expiry fixtures; live limits remain unverified |
| History | Full materialized legacy read/resume only | Authoritative reconstructed messages and retained partial interrupted turns | Same immutable profile/thread; no replay/replacement thread | Production disk + fresh-host tests; missing-thread preserves record. Paginated items method absent in official 0.160.0; unsupported/sparse view fails explicitly with cache preserved |

Unsupported extensions are absent from common UI. The neutral optional session schema is returned with `catalog.models` only when an adapter implements it; common UI has no runtime-specific branch. A core-only adapter works without the extension. No arbitrary native/global/workspace configuration keys are silently accepted as session settings.

## Profile state and recovery

`account/rateLimits/read` is an explicit account verification action; optional usage failure does not disable a healthy authenticated account. Rolling nullable fields retain the last observed bucket/window metadata, keyed by profile and native limit identity. Multiple buckets remain independent. A backend account-ID change or a new login clears prior usage; an observed account identity change also clears it. Raw account tokens, banners and auth material do not enter usage snapshots.

Quota is authoritative: percentages and reset times never imply backend permission to retry. Explicit `ordinaryUsageAllowed:true` from a new read permits recovery and clears prior reached markers. Missing/null updates preserve an existing quota block. Native failures distinguish expiry, quota, connection loss and explicit retry. Sign-out clears only the selected profile's account/usage and native session generation, settles its active work, retires its child, and marks matching known UI sessions `auth-required`; unrelated sessions, profiles and workspace/editor state remain intact. Re-authentication and continuation are explicit user actions. Stale profile generations cannot clear a newer auth-required state. The Rust bridge stamps every notification with the supervised host epoch; client, profile UI and session state compare host epoch plus child generation, accepting a fresh child counter after whole-host replacement while rejecting queued old-host notifications and in-flight old-host account replies.

## Native history / cache reconciliation

The full legacy native snapshot determines message content, order and stable native turn/item identity. Duplicate native turn snapshots prefer terminal over reordered in-progress data; full views dominate sparse views at the same lifecycle rank. Duplicate terminal tool items dominate late started snapshots. Conflicting item types fail explicitly. Bounds remain 10,000 turns/items and the native mapper's existing bounded queues.

In-progress native turns are interrupted during explicit resume, then their available user message, partial text/tools and failed terminal are retained. Completed history replaces divergent cached content and duplicates, including cache entries with orphan native IDs. Only the current unsent user message and assistant placeholder survive the replacement. A prompt client ID already present in native history is never silently sent again. Readable local summary/settings and local parent lineage are preserved outside the native message cache.

A sparse legacy item view fails with actionable unsupported-history copy, preserving the cache; the implementation never calls the pinned unavailable `thread/items/list`. Paginated-native hydration remains deferred until a supported executable supplies the required method. Corrupt/missing local cache can be reconstructed from native history via the production persistence path. Missing native thread yields typed `session-not-found`, preserving the SpecOps binding and cached record; transient native RPC failures remain reconnect/retry failures rather than being misreported as missing history. Persisted diagnostics strictly validate and round-trip profile/native turn/item/generation fields.

## Reproduction and handoff

```sh
node app/host/scripts/generate-codex-contracts.mjs
npm run check --prefix app/host
npm test --prefix app/host
npm run check --prefix app
npm test --prefix app
npm run build --prefix app/host
npm run build --prefix app
```

- 102 host tests passed across 9 files, including native shared behavioral contracts, sparse usage/account identity, profile isolation/logout/expiry, settings scope, terminal/partial turn deduplication, explicit unsupported sparse history and no replay.
- 3,237 frontend tests passed across 294 files. New production fixtures use actual dispatcher/client/pipeline and disk writer with fresh host/app against both divergent/duplicate and corrupt JSON caches; stable native IDs, local lineage/readable summary and missing-native-thread retention are verified. Optional controls/model defaults, interrupted-history UI, strict native diagnostic codec and host/child epoch recovery are covered.
- Host TypeScript and frontend Svelte checks passed (zero frontend errors/warnings); both production builds passed. 17 Rust Agent Host tests passed serially, including supervised epoch serialization. Existing canvas-stub notices, chunk-size advisory and unrelated Rust unused-variable warning remain.
- Generated pinned contracts reproduced byte-identically. No account-free protocol marker or authenticated inference was needed for C; B's actual official distribution evidence remains the pin/support authority. All native fixture values are synthetic; no credential was read from the default desktop home and no authenticated coding task was performed.

03-B receives the exact 0.160.0 pin, 46 generated roots, default-off protocol gate and full-materialized-legacy history restriction. 03-A receives distinct profile recovery/usage states and interrupted-history semantics. D must still accept real account-A preservation/account-B inference, quota/auth recovery, whole supervised-host restart, native filesystem effects and installed/PATH-independent delivery. No persisted-data migration or compatibility shim was added.
