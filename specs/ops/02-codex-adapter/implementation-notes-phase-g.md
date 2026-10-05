# AS02-G — Native activity and agreed finite feature parity

Source implementation retains the pinned 0.160.0 native app-server. SpecOps hosts the native harness in a private profile process and renders its protocol; project search/grep, shell commands, file reading/editing and automatic context management execute inside that harness. Adding a TypeScript SDK wrapper would not supply additional native engine tools or automatically create their UI/control surfaces. The npm automation SDK is not used by this adapter.

| Feature | Selected source support |
| --- | --- |
| Native workspace tools, streaming, approvals, questions, usage and recovery | A–D existing native engine/protocol integration |
| Full authoritative native history, isolated original account and workspace/settings binding | A–D materialized legacy history, explicit experimental profile opt-in |
| Fork/checkpoints | E native fork; durable child binding/local parent lineage; source preserved |
| Manual compact | E owned operation with acknowledgment distinct from terminal; progress, Stop, timeout, guards |
| Active steering | E exact native turn precondition, stable user identity, durable no-replay receipt |
| Skills | F native list and selected owned skill enable/disable |
| MCP | F bounded current-thread inventory; existing owned server enable/disable plus native reload; acknowledgment does not prove connection |
| Native defaults | F finite versioned private configuration controls; existing session settings stay frozen |
| Native agents | G child-state/activity cards from exact receiver/state maps and activity items; no child thread navigation or complete child transcript claim |
| Context compaction | G separate native context event/card; observed start/completion, no fabricated removed-message count |
| Conversation rollback | Unsupported: pinned rollback endpoint absent; revert needs paginated history unavailable in the selected full legacy coding/history contract |
| Plugin management | Unsupported: upstream plugin APIs under development; no production list/install/uninstall calls |
| MCP OAuth/elicitation/new server editor | Unavailable in this verified finite slice |
| Desktop-only UI/worktree/automation/extensions | No blanket desktop feature parity claim |

Native statuses preserve pendingInit→pending, running, interrupted, completed, errored→failed, shutdown and notFound→not-found. Control-tool completion remains separate from child completion. started/interacted/interrupted/completed activity items update the same child card. Sender must match the owned parent thread, and parent profile/session/generation/turn correlation remains authoritative. Children are descriptive native identities only. On parent terminal, unfinished child/context cards become unknown with an explicit unobserved-completion explanation. Context completion remains observed even if the parent later fails.

Native item IDs, child identity/path, prompt and last observed output/error pass through neutral events, live message folding, history hydration, codecs, message layout/cards, disk persistence and normal transcript serialization. Agent/context cards share neutral subtask rendering with an explicit category; native context events never invoke local compaction.applied removal accounting. Stable child/context IDs replace in place without duplicate generic tool cards. Manual compact consumes structured context progress and retains its own terminal operation status.

At most 64 receivers/states per native control item, 256 projected activities per turn, 65,536 characters per prompt/result, 4,096 per path and 256 per identity. Existing native frame/queue/state bounds remain. Malformed/unknown states and foreign senders fail closed. Queue overflow during terminal finalization records one failed terminal; no late success. Selected-profile config/read discovers bounded MCP credentials before projection; no global config/auth reads. Exact login/file credentials and opaque long env/header values are masked before truncation and across multiword split fragments. Short ordinary environment flags are excluded from substring credentials. Single-atom credentials retain lexical carry without delaying ordinary safe prose. Word-boundary secret matching avoids quadratic work on long lexical atoms.

Verification and fresh counts: see [selected parity release submission](../08-release-gates/release-2026-10-05-codex-parity.md). Targeted native transport/adapter/activity/control tests and production dispatcher/client/pipeline/disk/message-list checks passed before full submission. Fixture credentials are synthetic; no real account or provider inference was used. The historical AS08-A release evidence is unchanged. Source passes do not accept actual accounts, installed native controls, redistribution, enforcement or manual process cleanup.
