# AS07-C — Finite native settings and capability ledger

Recorded: 2026-10-05 00:15 MSK. Selected source configuration verified; authenticated enforcement, installed acceptance and public distribution remain open.

## Pinned contracts and selected settings

The official [TypeScript SDK documentation](https://cursor.com/docs/sdk/typescript) was checked on 2026-10-05 alongside distributed `@cursor/sdk` 1.0.35 `options.d.ts`, `tools-option.d.ts`, `index.js` and local executor source. The SDK default local quickstart executes tools automatically. Public options expose native tool restrictions, a boolean local sandbox request and model-specific parameter enums; they do not supply a programmatic human approval callback. None of these facts establish a filesystem read-only guarantee.

The common session configuration extension now offers immutable native presets: `none` (default), `files-read` (read/grep/glob/ls/readLints), and `files-write` (those plus edit/delete). Shell, shell input, task, MCP, questions, web tools and all other tool names are excluded. Task is specifically excluded because the pinned SDK states its children retain their own curated toolsets instead of inheriting the main loop's tool restriction. These are tool allowlists, not filesystem permission modes. Selected file edits/deletes execute without interactive approval where native policy allows them.

Native sandbox accepts exactly `enabled` (default) or `disabled`; options go to `local.sandboxOptions.enabled`. No fallback automatically disables it when the native platform rejects sandbox initialization. The setting requests native policy; it does not guarantee read-only, exclusive workspace access or fully tested OS confinement. Native source resolves the workspace's sandbox configuration independently of normal settings layers and can also read sandbox policy inside the isolated private profile home. UI descriptions and capability notes state this qualification. No normal global account/settings home is inherited or copied.

For model parameters, only the selected profile's current native catalog definitions are projected. Parameter IDs and values are bounded finite enums, unique, syntactically validated and rejected if exact credentials or generic secret shapes would change under redaction. Raw provider labels/variants, arbitrary model options and inferred defaults are not exposed. Empty selection omits that parameter and uses the native default. Each model has at most 16 parameters/32 values; common schema has at most 32 parameter fields/64 KiB. Model-specific options remain disabled for models without their definition. Parameter arrays are sorted canonically and passed through `model.params` both at native creation/resume and every send. Actual entitlement/parameter inference remains untested without an authorized account.

Validation rejects unknown settings/modes, no-op options, unsupported tools, invalid sandbox values and enum values before SDK authentication/operation. Catalog definitions are rechecked after asynchronous authentication. Canonical settings join original profile/credential/workspace/model binding in both private durable bindings and native store metadata. The exhaustive persisted schema accepts only the selected current shape; no persisted-data compatibility shim or migration exists. Resume cannot alter policy, native metadata corruption fails closed, and the same native tool restriction is supplied again on every native resume.

Workers explicitly pass empty MCP configuration, empty filesystem setting sources, `autoReview: false` and native agent retry disabled. This does not suppress independently enforced native administrative or sandbox policy. No file hook bridge, custom callback tool or prompt policy is installed. SDK module globals remain inside isolated worker processes, and credentials remain private host inputs.

## Finite feature ledger

Status distinguishes source support from authenticated/native/platform acceptance. “Unsupported” means deliberately unavailable in SpecOps's selected local adapter even when another native SDK surface exists.

| Surface | Status | Native execution / display / configuration evidence |
| --- | --- | --- |
| Local native create/resume/send/stream/history/cancel | Supported source; conditional live | B's durable native store/decoder/production recovery; C preserves lifecycle, generation and no-replay guards. Actual authenticated success/cancel remains open |
| Model catalog | Supported source; conditional entitlement | Native selected-key account/catalog probe and safe descriptors; no generic model fallback or entitlement inferred from listing |
| Per-model enum parameters | Supported source; conditional live | Current-profile catalog enum schema, strict pre-request validation and production worker exact `model.params` fixture; no authenticated parameter generation ran |
| Native built-in tool allowlist | Supported source; conditional execution | Exact finite presets; actual account-free official SDK accepts each on create/resume; production worker forwards restrictions. No tools by default |
| Filesystem read-only policy | Unknown / unavailable guarantee | File-read tool preset does not establish OS enforcement; writer activity remains unknown; no prompt-based substitution |
| File edit/delete access | Conditional | Native allowlist explicitly offers edit/delete only when selected; UI shows automatic execution and activity says possible writes. Actual file effects/native sandbox enforcement remain open |
| Native sandbox | Conditional | Boolean native option, explicit default enabled and no automatic fallback; workspace/private-profile native policy may apply independently. Helper launch is asset evidence only |
| Ask/interactive permission mode | Unsupported | Public native callback/correlation contract unavailable; no invented permission request/reply or silent auto-approval presented as interaction |
| User questions | Unsupported | Question tool excluded; no verified correlated native answer bridge |
| File hooks | Native availability; SpecOps execution/display/editing unsupported | Native filesystem hooks exist, normal filesystem sources excluded; no bridge or hook editor. Native private/workspace sandbox policy is separately qualified |
| Fork/checkpoint/restore | Unsupported | Native internal checkpoint storage is not a verified user-facing local fork/restore contract; dispatcher refuses actions without SDK work |
| Token usage | Supported source; conditional live | B maps actual provided token messages; no cost inference from token counts |
| Billed usage/cost/account limits | Unsupported display | Native usage APIs exist; no request or uncorrelated dollar estimate added; actual billed run identity differs from client run identity |
| Restart | Supported source; conditional installed | Owner generation invalidation/worker disposal and explicit same-native history resume, no automatic model run reattachment/replay |
| MCP servers/custom tools | Unsupported | Empty native server configuration and excluded tool family; no execution, display, editing or OAuth promise |
| Skills/project rules/plugins/commands | Unsupported | Filesystem setting sources empty; no editor, copied global configuration or execution/display claim |
| Native task/subagents | Unsupported | Task excluded because child toolsets do not inherit main restriction; no synthetic child sessions/structured UI claim |
| Native administrative policy | Unknown account-dependent | SDK may enforce authenticated controls independently; no settings-source exclusion is described as disabling managed policy |
| Browser/device authentication | Unsupported host lifecycle | Official browser key minting exists; A/B did not implement its host challenge/cancel lifecycle. User/service API-key path remains baseline |
| Cloud execution / routing / storage / navigation | Unsupported / deferred | Worker always constructs local options. No cloud options, remote list, tags or execution ID enter active Sessions |

The runtime's `cloudExecution` capability detail is the existing descriptor extension point. A later separately scoped implementation may add bounded runtime-specific metadata there after evidence; C does not retrieve remote agent metadata, widen the native core or add a Cloud context. Cloud/ask/hook/tool-server settings submitted to the local configuration fail before native operations.

## Common UI and safety evidence

Common session controls render the configuration explanation visibly, including automatic file tool execution, native sandbox policy qualification and unavailable approval/tool families. Empty parameter choices display “Native default”. Native restrictions are frozen after binding; the profile panel now describes implemented local sessions instead of obsolete bootstrap-only text. Writer activity marks explicit native file writes as possible and everything without a filesystem guarantee as unknown. Stop remains native cancellation and does not undo edits.

Exact-key and generic secret rejection happens before schema truncation/serialization; bounded identifiers and enum values never silently change native semantics through scrubbing. Production dispatcher fixtures prove configuration delivery and fail-closed permission/question/fork/restore rejection with no extra SDK work. Existing native lifecycle/canary/cache fixtures remain the shared boundary; no raw provider settings, SDK types, credential or cloud metadata is added to frontend state.

## Verification

- Cursor native configuration/policy suite: 16 passed, including all three actual account-free SDK preset create/resume cases, exact production worker option capture, unsupported settings before requests, immutable/corrupt policy, catalog canaries and production dispatcher rejection.
- Serial broad host regression: 294 passed/6 optional skipped; host type check and production build pass.
- Focused frontend common configuration/profile/activity/production persistence/client: 36 passed across 5 files, including new visible native settings, explicit possible writers and unchanged Cursor cache recovery.
- Frontend Svelte/type check: 0 errors/0 warnings; production build passes. Existing bundler handoff pure-annotation/chunk-size notices remain build warnings.
- Repeated copied SDK/Node/assets account-free control/session/search/helper probe outside checkout: pass on Darwin arm64, Node 24.15.0. Native durable identity/create/resume pass; reported sandbox enforcement unverified, inference/authentication/signed installed false.
- `git diff --check`: pass.

 No actual user/global auth was read and no authenticated/paid inference request ran. Official account-free native create/resume validates option acceptance, not sandbox initialization during inference or filesystem execution. Signed installed lifecycle, Darwin enforcement, Linux/Windows, account variants, immediate unobserved descendant exit and distribution/notice clearance remain open for D/release gates.
