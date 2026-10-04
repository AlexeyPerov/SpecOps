# AS04-C — Core cutover evidence

**Updated:** 2026-10-04 20:52 MSK
**State:** Source cutover verified. Installed, account and release acceptance remain open.

## Ownership and clean storage

Agent Host is the sole native runtime owner. Removed the frontend vendor SDK/dependency, direct HTTP/backend factory, Rust runtime supervisor/commands, temporary owner switch, frontend native configuration/resource/catalog/auth-secret stores and obsolete comparison tests. Common Sessions enablement, runtime/profile/model/primary-mode selection now use the selected host runtime. Removed native session-browser/configuration/MCP/command/provider-editor panels until supported host extensions land. Git badges no longer fall back to unauthenticated runtime HTTP.

Profiles refresh with selected-runtime/epoch guards. A missing bound profile has an explicit recovery state and preserves local metadata and native binding; native missing-history recovery continues to preserve the existing record without creating a replacement or replaying prompts. Native model and primary mode selection use the shared catalog controls; native mode labels imply no sandbox guarantee.

OpenCode local provider import accepts only the host-owned `profile-api-key` credential reference and selected native provider ID. Create an `api-key` file in the selected profile home (under the application data `connection-profiles/opencode/<profile-id>` directory), with private 0600 permissions on Unix. The host rejects raw key options, missing/public/symlink/oversized files, reads the private file and consumes it only after successful native auth. No WebView key input or raw credential state remains. External origins are explicit owner-managed profiles; credential mutation, browser/device login and authenticated external endpoints remain unavailable.

There is no persisted-data migration or compatibility shim. Removed transport settings and `provider-secrets.json` are ignored, never imported. Existing old credentials remain user-owned on disk; users may remove them manually. Use the new isolated profile/auth setup. Local Sessions indexing continues to use the current neutral codec and native authoritative history.

## Finite core/deferred disposition

Required A/B core lifecycle/catalog/event/history/permission/question/cancel categories have production host replacements and regression evidence. Frontend/native legacy launchers are deleted. Later rich controls remain unavailable, not simulated by the fake runtime. Their finite retained/deferred evidence is [the cutover reference ledger](cutover-reference-evidence.md); 06-B remains Planned. Native functionality can still exist in the vendor runtime without an advertised common Sessions panel.

## Early activity and installed infrastructure

Extended shared early 03-A infrastructure to both runtimes: workspace activity includes runtime, profile, model, pending permission/question and scoped Stop. Write capability uses the actual Codex sandbox setting; OpenCode is unknown because native policy is authoritative. A warning before another possible writer offers Continue and cancellation of the proposed send, with a persisted suppression/reset checkbox. Continue imposes no lock, serialization, profile/cwd change or automatic git action. Stop during a pending warning prevents native create/send after Continue. Active normalized changed-path hints produce bounded best-effort overlap evidence; absent paths prove no isolation. Stop explicitly does not undo files. Normal filesystem watchers preserve dirty buffers; normalized native diff events also refresh git/file-status consumers.

Extended 03-B packaging: the Tauri build creates and includes the host bundle and packaged Node 24 executable/license/identity manifest. Packaging checks target identity and macOS system-only dylib dependencies, and records executable/host SHA-256. Host timestamps use source commit time or explicit SOURCE_DATE_EPOCH; two identical builds yielded identical SHA-256. The normal release resolver uses bundled Node/host/native files or explicit absolute overrides, never a checkout or developer PATH. Source-only debug resolution remains separate. Native installed candidates use exact filenames; an absent packaged OpenCode executable disables implicit host PATH discovery while leaving other runtimes usable. An isolated copied Node/host initialized/discovered/exited outside checkout with a normal system PATH. This is asset/process evidence, not a signed installed app smoke.

A minimal allowlisted support copy reports host/protocol/native version, profile ID/nonsecret auth category, generations, health and typed error kind. It omits homes, auth fields, account email, URLs, raw errors and tool output. Native missing/incompatible executable setup errors are explicit. Full signing, production app installation, binary replacement and non-macOS acceptance stay open.

## Recorded verification

- Frontend full regression: 276 files / 2863 tests passed; Svelte check zero errors/warnings; production build passed (existing chunk-size warning).
- Host full regression with bundled macOS arm64 native smoke enabled: 157 tests passed, including real no-account 1.17.4 bootstrap/create/read/resume/restart. Ordinary suite: 155 passed, two opt-in tests skipped. Host TypeScript/build passed.
- Full Rust suite: 78 tests passed, including host supervision and exact installed native candidate checks. Existing unrelated git unused-variable warning remains.
- Actual bundled host process plus production frontend client: two Codex streams settle on SIGKILL; cross-runtime fixture keeps Codex usable after OpenCode child loss, resumes the same OpenCode history after scoped restart, then settles both on whole-host SIGKILL without prompt replay. Native persisted requests are checked before fault injection.
- Production dispatcher/client/pipeline/disk fixtures retain Codex/OpenCode immutable bindings and reconcile divergent/corrupt native history. Writer classification/Continue/suppression, Stop during pending warning, private-file import/redaction and allowlisted support canaries pass. Existing filesystem/dirty-buffer/version-control regressions pass.
- WebView SDK/direct-backend and Rust competing-supervisor absence scans pass. Removed tests are replaced by active host/core coverage; retained rich evidence is documentary only.

## Acceptance and next implementation

Source C is ready for the next implementation plan. This does not mark delivery acceptance Done: paid/live-provider auth/inference/tool/permission/question/cancel/account-A/B, actual signed installed macOS start/restart/quit and descendant inspection, immediate descendant spawn/exit race, Windows/Linux packaging/tree cleanup and upstream AS02-D/03-A/B acceptance remain open. [The selected-scope 08-A record](../08-release-gates/baseline-04-c.md) recommends no release yet. Future Claude/Cursor/handoff/06-B work does not retroactively satisfy these checks.
