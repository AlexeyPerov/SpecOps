# AS05-A — native SDK and API key bootstrap evidence

**Recorded:** 2026-10-04 21:09 Europe/Volgograd. **State:** source bootstrap implemented; installed, live-account and release acceptance remain open.

## Official contracts checked before implementation

The [official Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) documents embedding the native agent and restricts unapproved third-party subscription login. The [official quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) documents API key auth, optional native platform packages and cloud-provider environments. SpecOps implements the dedicated API key baseline only. Cloud import, browser/device subscription login and inherited developer credentials are unavailable; no OAuth workaround is offered.

The registry and installed official package pin `@anthropic-ai/claude-agent-sdk` **0.3.289**, bundled native executable **2.1.289**. The host lockfile records npm integrity and platform optional package versions. The supported host Node distribution remains **24**; the SDK's declared minimum is Node 18. Darwin arm64 is the actual source probe scope. Other packages listed upstream include Darwin x64, Linux x64/arm64/glibc/musl and Windows x64/arm64, but none has been accepted here. The packaging selector currently supports same-host glibc/default OS packages; Linux musl and cross-target packaging are unaccepted.

The [official package README](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md) and installed README distinguish the root entry, which inlines peers, from the smaller core entry, which requires external peers. SpecOps dynamically imports the root entry in the host only. Build and package-assets copy every shipped JS module/chunk/manifest plus metadata/README/license and the exact platform native executable. The generated asset manifest carries platform, architecture, SDK/native versions and SHA-256 for all copied files; runtime checks the root SDK and executable hashes and probes the actual executable version. A packaged host never falls back to a developer/global installation. Source-only resolution is restricted to the source module location.

The distributed SDK and executable LICENSE files refer to the provider's legal agreements; the overview describes commercial terms and dependency-specific licenses. These upstream notices are included verbatim in generated artifacts. This is a recorded distribution strategy, not legal approval or a completed signed-release/license review.

## Profile/control behavior

Profiles have independent private app-data homes, native configuration directories and private credential files. A strict subprocess environment allowlist excludes ambient provider/OAuth/cloud auth, proxies, Node injection and developer configuration. Project/user native settings are disabled during bootstrap, as are tools and native session persistence. No inference prompt is sent by health/auth discovery.

Import requires the selected profile's private bounded `api-key` file, accessed without symlink following; the UI sends an opaque host handle. The key is persisted privately and its import file consumed only after successful verification. Verification uses a bounded, non-inference `GET /v1/models?limit=1` against the official endpoint; response bodies never cross the control plane. A successful request establishes API authentication, not subscription entitlement or permission to run every catalog model. Rejected credentials, unavailable network, missing SDK and incompatible assets have separate recovery states. Logout invalidates pending generations, aborts work and clears only the selected profile credential/catalog. Restart/read reinitialize and verify that profile; stale completions cannot repersist a credential.

Native `query()` control initialization (`supportedModels()`) discovers catalog rows without a prompt. Catalogs are normalized/deduplicated/bounded; no static model or subscription claims are supplied. Modes are empty. The session-settings schema explicitly describes native settings as unavailable until sessions exist and publishes no actionable fields. Native turns, permissions, tools, budgets and policy application are unavailable rather than simulated. The common profile panel exposes Claude creation/import/verify/logout/reconnect, with no key input or unsupported subscription buttons.

## Verification and remaining gates

- Host type check/build and frontend Svelte check passed.
- Deterministic bootstrap covers private import/consumption, native catalog normalization, ambient auth isolation, missing/incompatible assets, invalid/offline auth, unsupported login, late logout and safe provider failures. Native test is explicitly opt-in (`SPECOPS_CLAUDE_NATIVE_PROBE=1`).
- `node app/host/scripts/probe-claude.mjs` passed on Darwin arm64: SDK 0.3.289 / actual native 2.1.289; **5** discoverable native model rows. It copies the entire runtime outside the checkout and imports it in a fresh Node process with no node_modules/NODE_PATH and a fresh profile home. Only control initialization runs; no real credentials or model inference are used.
- Live API key/cloud/provider inference, same-account installed restart, signed app package resources and platform process cleanup remain unverified. These are release gates, not prerequisites claimed closed by source tests.

## Concrete AS05-B handoff

Reuse the profile store, exact asset resolver and dynamic root SDK loader. Add authenticated `query` streams with immutable native profile/workspace/model settings, authoritative native session history/resume, mapped events and cancellable native child ownership. Preserve native generations and API key boundaries; do not use bootstrap catalog discovery as evidence of inference access. Introduce native session policy/tool/budget controls only with actual pinned SDK application and fixtures. Every currently unavailable native core method throws a typed capability error.
