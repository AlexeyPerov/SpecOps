# AS02-A implementation and evidence

**Recorded:** 2026-10-04 16:28 MSK

**State:** Source implementation and automated/bootstrap evidence accepted; live account-B acceptance remains manually gated. Native turns/resume are B work. Installed delivery remains 03-A/B + 02-D work.

## Supported native contract

The source adapter pins `codex-cli 0.160.0`, launches `codex app-server --listen stdio://`, sends native `initialize` followed by `initialized`, and rejects another version before a profile child starts work. The generated A contract dependency closure contains 33 TypeScript files and 13 JSON Schema contracts; handshake, login and catalog request types are consumed by the adapter. Required responses are checked at the transport/account/catalog/thread boundaries. Unknown additive notifications increment a bounded diagnostic counter; their raw payloads are discarded.

Official protocol/auth/config guidance: [App Server](https://learn.chatgpt.com/docs/app-server), [Authentication](https://learn.chatgpt.com/docs/auth), [Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced). The executable, rather than newer documentation fields, defines the supported pin. Registry metadata checked with `npm view @openai/codex@0.160.0 version license dist.tarball --json` reports version `0.160.0`, license `Apache-2.0`, and the official `@openai/codex` npm distribution. This change does not bundle or redistribute the desktop application's executable/resources; packaged runtime distribution is a downstream gate.

Reproduce from the repository root:

```sh
node app/host/scripts/generate-codex-contracts.mjs
node app/host/scripts/probe-codex.mjs
npm run check --prefix app/host
npm test --prefix app/host
npm run check --prefix app
npm test --prefix app
```

`SPECOPS_CODEX_EXECUTABLE` may point to an absolute pinned CLI executable; otherwise discovery searches the host's PATH. A missing or incompatible binary produces an explicit selected-profile state. The actual source-checkout probe used `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`; it created a temporary isolated home and never read the default home, opened login, or sent a prompt. `initialize`, `initialized`, `account/read` (auth-required), UUID-shaped `account/login/cancel`, `account/logout`, `model/list`, and `thread/list` succeeded. Generation was 1. Browser/device/API-key variants are present in the pinned generated contracts and synthetic fixtures; no actual authenticated variant was accepted by this probe.

Regeneration produced identical file/content hashes: `779c751773875f51cd55c8083f25cadc67fed3bfadf7e8b1c40e3e274e4f4876`.

## Isolation and account lifecycle

Rust passes the application-data `connection-profiles` directory to Agent Host. On macOS the production location is `~/Library/Application Support/com.alexeyperov.specops/connection-profiles/<profile-id>/home`. The standalone host fallback is `~/Library/Application Support/SpecOps/connection-profiles`. `SPECOPS_PROFILE_ROOT` is a host setup override for tests/development. Homes and profile directories use 0700; metadata/config/credential files use 0600. Symlink profile directories and credential files, including dangling symlinks, are rejected. Profile metadata persists only identity, label, runtime and creation time; homes are outside workspace session storage/exports. Default auth/config is never copied.

Only a selected profile child receives its CODEX_HOME. Inherited Codex/OpenAI/ChatGPT/Azure auth/provider variables and cloud-provider credential overrides are removed while tool PATH/HOME/workspace variables remain available. File credential storage and the native OpenAI provider are explicit child config overrides; keyring is not used. Native stderr/error text is excluded from the bridge. Auth URLs, query strings, keys and device codes are never returned as frontend profile state, persisted metadata or diagnostic payloads.

The profile panel lists/creates profiles, discovers runtimes, selects the draft connection, and offers browser login, supported macOS device login, API-key import, account verification, cancellation, profile-local logout and reconnect. API-key import deliberately uses a private host broker file, avoiding a key field in WebView state: place the key in `<profile home>/api-key` with mode 0600, then use **Import private API key**. Successful import removes that file; native credentials remain inside the isolated profile home. Device codes appear in a native system dialog; its asynchronous completion/opener is guarded by attempt and child generation. Login-open is pending, never authenticated. A successful matching native completion reads and displays the actual selected account. Stale login IDs/generations do not update the selected attempt. UI errors are recoverable through retry/verify/reconnect.

One child is shared across a profile's native threads. Reconnect retires that profile's child and descendants without restarting Agent Host or another profile. Children remain in the outer supervised host process group so host crash cleanup still owns them. Child startup cancellation cannot spawn late or close a newer generation. Transport uses stateful UTF-8 decoding, bounded RPC frames/pending requests/output buffering, deadlines and generic safe errors.

## Neutral session creation

Workspace Sessions use a persisted neutral `sessionsEnabled` setting independent of provider transport enablement. Fresh sessions default to Codex and discover catalogs through ensure-start before first send; the fake runtime remains selectable for account-free development. Explicit runtime/profile draft selections persist through the production thread codec. Native creation returns runtime/profile/thread identity, which flows through the actual index, abstract session codecs, requests, reply binding, health and event routing. Existing binding and draft metadata reject profile reassignment. Composite routing keys separate equal native IDs from different runtime/profile namespaces. Dedicated `profile.authUpdated` notifications do not enter turn transcript streams.

A exposes native creation but honestly advertises native turns as unsupported. B must implement coding turns, approvals/questions, cancel and native resume before developer coding acceptance.

## Verification and remaining acceptance

- 73 host tests passed, including 12 Codex process/profile/auth fixtures: missing/incompatible binary, malformed init, ambient credentials, permissions/symlinks, API-key/device/browser synthetic login, stale completion/generation, cancellation, opener recovery, exact newly-created profile identity, bounded additive diagnostics, profile collision and descendant cleanup.
- 3,222 frontend tests passed, including production profile/draft codec round-trips, immutable profile binding, neutral settings persistence, catalog retry after host replacement, equal-ID stream routing and separate auth updates.
- Frontend and host type checks passed; frontend and host production builds passed.
- 16 Agent Host Rust tests passed serially, including real bundled host lifecycle, crash/generation recovery and descendant cleanup. One existing unrelated unused-variable warning remains. Repository-wide formatting check reports existing formatting differences in unrelated Rust modules; the changed Rust block is formatted.
- Account-free canaries prove default-home fixture content remains unchanged and secrets are excluded from frontend snapshots/storage/errors. The real no-account probe never touched the desktop home, so it does **not** establish authenticated account-A/account-B preservation.

**Manual gate still open:** under supported account conditions, keep desktop account A signed in, sign into B through the SpecOps browser/device flow, verify B's actual identity, sign B out and verify A remains signed in without exporting credentials. Actual API-key/device access, login-port behavior, installed/PATH-independent executable discovery and packaging remain unaccepted. No task is marked fully Done solely from synthetic account fixtures. These gates remain explicit for final D acceptance; no persisted-data migration or compatibility shim was introduced.
