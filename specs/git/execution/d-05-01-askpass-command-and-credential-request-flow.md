# D-05 Task 1 — Askpass command and credential request flow [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-05](../backlog.md) — Custom in-app GIT_ASKPASS  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #10  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~0.75d

## Goal

Define a secure askpass request/response contract between git subprocess execution and the app, so credential prompts can be handled by SpecOps UI instead of terminal fallback.

## Required context

1. Existing git subprocess entry points: `app/src/lib/git/gitService.ts` and `app/src-tauri/src/git.rs`
2. Existing error reporting/busy behavior: `app/src/lib/git/gitErrorUi.ts`, `app/src/lib/git/versionControlRemoteOps.ts`
3. Reference askpass command: [`Commands/Askpass.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Askpass.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Askpass.cs)
4. Reference data flow around prompt invocation: [`ViewModels/Askpass.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/Askpass.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/Askpass.cs)
5. Reference process wiring patterns: [`Commands/Command.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Command.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Command.cs)

## Implementation steps

1. Add a typed askpass request model in `app/src/lib/git/types.ts` including:
   - prompt text, host hint (if derivable), username hint, operation context (`fetch`/`pull`/`push`)
   - request id and timeout metadata for cancellation/cleanup
2. Extend Rust git command runner to support a temporary askpass executable/script path and propagate prompt payload through a controlled IPC or temp-file contract.
3. Add TS helper that builds askpass env (`GIT_ASKPASS`, `SSH_ASKPASS`, related knobs) without mutating global process state.
4. Ensure non-interactive commands without credential needs keep current behavior and no askpass process is spawned.
5. Add timeout + aborted-operation handling so stale askpass requests fail with a mapped `GitCommandError` classification.

## Acceptance checklist

- [x] Pull/push/fetch path can emit a structured askpass request instead of hanging on tty prompt.
- [x] Askpass env injection is per-command and does not leak across subsequent git commands.
- [x] Timeout/abort surfaces clear UI-facing error and clears busy state.
- [x] Unit tests cover env-building and request parsing edge cases (empty prompt, multiline prompt).

## Dependencies

- Existing remote operations (`fetchRemote`, `pullRemote`, `pushRemote`) in `gitService.ts`

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
