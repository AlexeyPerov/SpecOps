# AS02-E — Native session controls

**Updated:** 2026-10-05
**Status:** Source implemented and fixture verified; authenticated/installed acceptance open. Conversation rollback unavailable for the selected pinned history mode.

## Selected scope and ownership

Continue using the official pinned Codex CLI 0.160.0 app-server. Native Codex owns search/commands/file execution, tools, context management and history. SpecOps exposes verified native session operations through its neutral Host/client/UI; no model SDK wrapper, hidden follow-up, prompt-policy emulation or persisted-data migration.

This plan is one sequential orchestration unit. It follows the historical A–D and AS06-C profile work. Ecosystem management and detailed subagent/rich compaction presentation are separate later plans; this plan does not claim desktop-wide parity.

## Tasks

| ID | Task | Source state |
| --- | --- | --- |
| AS02-E-01 | Regenerate exact executable TS/schema contracts for fork, compact, steer and current native revert | DONE |
| AS02-E-02 | Native fork through an owned completed turn; preserve source history, account/settings binding and durable local parent lineage | DONE |
| AS02-E-03 | Manual native compact; distinguish control acknowledgment from native completion, surface observed progress, Stop and bounded failure | DONE |
| AS02-E-04 | Native active-turn steering with `expectedTurnId`, stable native client user identity and durable no-replay receipt | DONE |
| AS02-E-05 | Expose conversation rollback only where the pinned supported history mode permits authoritative recovery | UNSUPPORTED: `thread/rollback` absent; `thread/revert` accepts paginated history only; selected coding/resume is legacy |
| AS02-E-06 | Production dispatcher/client/pipeline/store/disk, failure/security/UI fixtures and type/build checks | DONE |
| AS02-E-07 | Real authenticated native controls, installed lifecycle and external release acceptance | OPEN |

## Acceptance boundaries

- Fork sends no prompt, preserves the source and stores child profile/principal/model/settings plus local parent lineage before hydration. A lost acknowledgment is uncertain; no automatic recreation occurs.
- Compact uses native inference, so UI requires usage confirmation. An empty control response only acknowledges dispatch; an owned native turn and completion notification settle the operation. Pending controls block competing sends; native Stop is separate from file undo.
- Steering adds text to the exact active native turn without interrupting it. Stable client ID is persisted before dispatch; a private exclusive fsynced Host receipt rejects re-dispatch even after restart. Rejected/lost acknowledgments do not fall back to a new turn.
- Current native revert changes conversation history only, never files. It is not invoked against legacy threads. A runtime/history-support change requires a separate verified plan; no guessed deprecated endpoint or local history manipulation is used.
- Account/profile/cwd/model/settings and generation guards remain authoritative. Secret-safe bounded projection, no automatic retry/account rotation and explicit stale selection outcomes are required.

Evidence and finite support ledger: [implementation notes](implementation-notes-phase-e.md). The historical [2026-10-05 release decision](../08-release-gates/release-2026-10-05.md) predates this phase and remains blocked; it does not certify these changes.
