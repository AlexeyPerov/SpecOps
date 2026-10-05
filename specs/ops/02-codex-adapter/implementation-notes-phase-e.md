# AS02-E implementation and finite session support

**Updated:** 2026-10-05 16:24 MSK
**Source scope:** Codex CLI 0.160.0 app-server; selected explicit experimental profile opt-in and native legacy history.
**Release disposition:** Source evidence only. Native authenticated/installed acceptance open; historical release record unchanged and blocked.

## Pin authority

The official 0.160.0 executable generated the committed TypeScript and JSON schema contracts in an isolated temporary HOME/CODEX_HOME. Documentation is [official app-server documentation](https://learn.chatgpt.com/docs/app-server); the exact pinned generated contract takes precedence over current general examples.

`thread/fork`, `thread/compact/start` and `turn/steer` exist. `thread/rollback` and its old num-turns contract do not exist in this pin. The actual replacement `thread/revert` explicitly requires a paginated thread, excludes `beforeTurnId` and later turns, does not undo files, and returns empty turns plus hydration cursors. The current pinned executable cannot provide the needed authoritative paginated items endpoint; selected legacy coding/history is retained. Rollback therefore remains explicitly unavailable and sends no native request. It cannot be truthfully implemented by copying old documentation or deleting local cached messages.

## Finite feature ledger

| Feature | Native execution | SpecOps surface | Boundary |
| --- | --- | --- | --- |
| Project search, commands, reading/editing files | Native tools in selected cwd/sandbox | Existing native event stream/approvals | No npm SDK replacement or reimplementation required; real enforcement acceptance open |
| Automatic context management | Native-owned | Context-compaction item start/completion normalized as static diagnostic progress | Rich transcript presentation is later work |
| Manual compact | `thread/compact/start`; empty acknowledgment, separate native compact turn | Usage confirmation, progress, native operation activity, composer guard, dedicated Stop, terminal polling | Five-minute native deadline; client bounded deadline, missing state/operation ID/generation/Host loss fail closed; may incur inference usage |
| Fork | `thread/fork` with optional native `lastTurnId`, saved settings and deferred goal continuation | Fresh bound child, local parent lineage persisted before native hydrate | Completed owned checkpoint only; source untouched; lost acknowledgment uncertain, no automatic recreation |
| Active steering | `turn/steer`, `expectedTurnId`, `clientUserMessageId` | Text-only composer action and durable user intent | No interrupt/new-turn fallback; private no-replay receipt survives restart; attachments unsupported |
| Conversation rollback | Pinned `thread/revert` paginated-only | Explicit unavailable explanation in native conversation view | Selected legacy mode unsupported; zero RPC; never file undo |
| Skills/MCP/plugins/configuration management | Native contracts not selected here | Later plan | No feature claimed here |
| Detailed native subagent UI | Existing native generic tool events | Later plan | No detailed parity claimed here |

## Lifecycle and storage

Each operation retains the immutable native profile, original principal, cwd, model, effort, collaboration mode, sandbox and approval policy. Fork validates returned model/cwd/approval/reviewer/effort/sandbox and a safe fresh native ID before private principal binding. Child lineage belongs to SpecOps session metadata/index; native source user client IDs remain stable during child hydration and corrupt-cache recovery. No prompt starts as a side effect of UI hydration.

Owner-token profile reservations are acquired before asynchronous setup for fork/compact. Native compact owns a bounded native turn and observes native events until completion, interruption, error, process loss or timeout; acknowledgment is not completion. A neutral operation runtime flag makes it visible in activity and blocks composer/handoff/deletion while pending. Stop targets the selected native operation rather than a fake coding turn; cleanup clears only its own flag. Native progress is shown only after an observed compaction item.

Steering persists a user intent before dispatch. Host writes a private exclusive fsynced receipt keyed by native thread and client ID before the native request. The receipt contains identifiers and dispatch state, not prompt or credentials; an uncertain response remains conservative and cannot be resent with the same ID after restart. Native accepted client ID hydrates the same user message later. New explicit user input remains a new native operation; nothing is automatically replayed.

Already prepared handoff validates the source operation flag before target validation/create/send; deleting a session while its operation is pending is refused. New checkpoint output masks exact private profile credential values before truncation. Credential-bearing native identities are rejected, not exported as selectable IDs. Unknown/malformed actions fail before native work. Shared action vocabulary expands finitely; other adapters retain their own supported subset.

## Verification

Final focused verification:

- `cd app/host && npm test -- src/codex/actions.test.ts src/codex/thread.test.ts src/dispatch.test.ts src/opencode/extensions.test.ts`: **75 passed / 1 optional skipped**, four files.
- `cd app && npx vitest run src/lib/services/chatPersistence.integration.test.ts src/lib/services/nativeExtensions.test.ts src/lib/components/NativeExtensionsPanel.test.ts src/lib/services/sessionActivity.test.ts src/lib/ai/composerPromptQueue.test.ts`: **56 passed**, five files (27 production persistence/integration cases).
- `cd app/host && npm run check && npm run build`: pass.
- `cd app && npm run check && npm run build`: pass, Svelte 0 errors / 0 warnings. Build retains an existing handoff-dialog PURE annotation warning; it does not block output.
- Exact pinned contract generator: **207 TypeScript contracts / 54 schema contracts**; no account/inference call. `git diff --check`: pass.

The initial focused runs identified a missing capability detail, a pre-start Stop requiring explicit resume and old UI mock argument assumptions; those were corrected and rerun. A prepared-handoff rejection test initially expected a returned failure instead of the existing thrown validation contract; its assertion was corrected and the final production run passed. No external acceptance is inferred from those reruns.

 Fixtures spawn the production native transport against synthetic protocol children and use real Host dispatch/client, pipeline, store and disk writers. They are not authenticated native enforcement or installed app acceptance.

- Native action fixtures cover source-preserving checkpoint fork, original principal child binding and fresh-host resume; pending versus terminal compaction, overlapping send rejection and Stop; exact active-turn steering and stable native user ID; durable receipt replay rejection after restart; native side effects with lost fork/steer acknowledgment; unavailable rollback/malformed settings zero-RPC; credential masking and unsafe IDs.
- Frontend production fixture exercises active steering, child lineage persistence, manual compact, fresh Host/app and corrupt cached child recovery without duplicate native dispatch or source-history change.
- UI/service fixtures cover explicit usage confirmation, observed progress and dedicated Stop; missing operation, changed generation, native failure and bounded pending semantics; no file watcher refresh for context/history-only reconciliation.

## Remaining acceptance

No inference call was made to an actual provider, and no real account credential/native global home was inspected. Real account controls, paid inference usage, native sandbox/approval enforcement, signed installed/platform/process/distribution checks remain open. Successful source fixtures do not close the roadmap or historical blocked release decision.

Source submission: [AS02-E baseline](../08-release-gates/baseline-02-e.md).
