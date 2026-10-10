# 09 — Plugin-based agent usage

**Updated:** 2026-10-10

**Status:** A contracts and B trusted artifact pipeline implemented (7/12 local tasks accepted); finite native/copy source evidence recorded. Production hosting/signing/installed acceptance and C–H remain open.

**Source of truth:** [Roadmap](../roadmap.md) · [Execution index](execution-plan.md)

## Product goal

Ship a lightweight SpecOps that works as an editor without agent software or network access. When a user explicitly installs an agent, download its compatible execution components and shared prerequisites, verify them and enable the existing native Sessions experience. Cover Codex, OpenCode, Claude, Cursor and the contract for future supported adapters.

Here, a plugin is a first-party optional execution component with a tested adapter shipped in SpecOps. It is not a marketplace, arbitrary downloaded adapter code or a vendor's native plugin feature. Downloaded vendor runtimes execute only through the existing owned native harness.

## Full-scope decisions

- Base app contains editor/workspace/Sessions UI, shipped descriptors and adapters, small Agent Host JS, native installation manager and embedded trusted catalog metadata. No Node runtime, mandatory agent sidecar, heavy SDK/native executable or helper payload is bundled.
- Rust/Tauri installs components without Node or Agent Host. Shared compatible Node is downloaded once with the first confirmed agent plan; Agent Host and vendor processes start only for explicit agent operations.
- First use presents agent/version/dependencies/bytes and an Install action. Selecting a runtime, opening settings or launching the editor does not authorize a download or provider execution. Installing software never submits a prompt automatically.
- Store verified immutable component versions in application data, outside the app bundle and checkout. Separate software/staging/cache from credentials, connection profiles, native history and session data.
- Download exact tested versions from approved sources, verify trusted signed metadata and hashes, extract within bounded private staging and activate atomically. The catalog is not a generic URL-to-executable mechanism.
- Offer deliberate compatible updates and retain versions needed by live process leases. Executable rollback is allowed only with native-store compatibility evidence; no data migrations, compatibility codecs or history upgrade/downgrade paths.
- Uninstall removes owned software/cache, preserving accounts, session history and workspace files. Shared prerequisites cannot disappear beneath dependents or running workers.
- After installation, software remains available offline. Provider inference/authentication may still require connectivity; unavailable vendor service is separate from installation health.
- Use current distribution/signing/notice evidence for each exact target before advertising installation. Download-on-demand does not resolve vendor permissions by itself.
- Full milestone completion covers all four agents on the first accepted platform (initial target Darwin arm64). Additional OS/architectures require their own signed installed/distribution/process evidence. Subset previews can ship through a selected AS08 gate without declaring AS09 complete.

## Current source boundary

Today the host build prepares Claude/Cursor assets, release packaging adds Node and copies native assets, and Tauri includes an OpenCode sidecar. Runtime resolvers generally expect adjacent packaged resources. This milestone replaces that production delivery/resolution assumption while preserving native adapter behavior, account isolation, activity, history, policy and process ownership. Existing pins are inputs for inventory; they are not an indefinite promise that vendor latest works.

The approximate prepared Node/Claude/Cursor payload size previously discussed is planning context, not a measured installer reduction. AS09-A establishes actual package/startup/disk budgets and AS09-H measures the outcome.

## Active scope

| Phase | Plan | State |
| --- | --- | --- |
| AS09-A | [Component contracts and distribution decisions](execution-plan-phase-a-component-contracts.md) | Source contracts/decisions accepted; A-01/A-06 open |
| AS09-B | [Trusted component artifacts and catalog](execution-plan-phase-b-artifact-pipeline.md) | Source pipeline/security verified; B-01/B-03/B-06 release/integration gates open |
| AS09-C | [Native bootstrap and durable installer](execution-plan-phase-c-native-install-manager.md) | Planned |
| AS09-D | [Lazy Agent Host and installed component resolution](execution-plan-phase-d-lazy-host-runtime-resolution.md) | Planned |
| AS09-E | [All four agent components and future adapter registration](execution-plan-phase-e-agent-components.md) | Planned |
| AS09-F | [Agent installation, first use and recovery UX](execution-plan-phase-f-installation-ux.md) | Planned |
| AS09-G | [Updates, storage maintenance and security hardening](execution-plan-phase-g-maintenance-security.md) | Planned |
| AS09-H | [Lean release packaging and installed acceptance](execution-plan-phase-h-release-acceptance.md) | Planned |

[Phase A evidence](implementation-notes-phase-a.md) records strict native contracts, measured prepared payload bytes, numeric budgets and truthful unavailable distribution entries. The tracked OpenCode sidecar is a developer PATH wrapper; observed Codex is incompatible with the tested pin. Clean signed installed/process/account acceptance remains open.

## Dependencies and delivery

A establishes contracts and distribution decisions. B produces trusted fixture/release artifacts. C installs without Node. D moves bootstrap/resolution to managed components. E moves all four runtimes. F delivers first-use and maintenance UI. G hardens lifecycle/storage/security. H removes mandatory payloads and proves signed installed acceptance.

Source implementation may use existing 01–07 source contracts without waiting for every older external gate. That never converts those older gates to accepted: H repeats relevant native/account/installed acceptance for the new delivery mode. Stage 08 remains the recurring release gate and runs again for 09; it is not a once-only predecessor.

## Definition of done

- [ ] Base installed app works offline without Node, agents, checkout or developer PATH.
- [ ] Explicit install bootstraps shared Node and each of the four complete verified runtime payloads.
- [ ] Catalog trust, safe extraction, interrupted-install recovery and multi-window ownership are verified.
- [ ] Updates/removal/cleanup obey process leases and preserve accounts/history/files.
- [ ] Native sessions, profiles, controls, interactions, resume and advertised handoff retain accepted behavior.
- [ ] Actual signed installed/account/distribution/process matrix passes for each advertised target.
- [ ] Measured base package/startup and component/cache costs meet agreed numeric budgets.
- [ ] New selected AS08 release evidence and public setup/support docs are accepted; historical records stay intact.

No task is complete merely because a plan exists or mocks pass. No persisted-data migrations or compatibility shims are authorized.

[B artifact evidence](implementation-notes-phase-b.md) records exact five-component finite assembly, copied no-account source controls and native Ed25519 catalog verification. [Release/retention/revocation policy](artifact-release-procedure.md) keeps production unavailable until reviewed release approval; bundled resources remain until the replacement bootstrap is functional.
