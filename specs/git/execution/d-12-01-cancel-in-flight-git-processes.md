# D-12 Task 1 — Cancel in-flight git processes

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-12](../backlog.md) — Cancel in-flight git subprocess  
**Spec:** [version-control-idea.md](../version-control-idea.md) phase 4 task 4.5 follow-up  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 9 · **Agent:** heavy · **Estimate:** ~1.5d

## Goal

Support user-initiated cancellation for long-running git commands (fetch/pull/push and other network operations) with safe process termination and UI recovery.

## Required context

1. Existing remote-op busy state: `app/src/lib/git/versionControlRemoteOps.ts`
2. Git invocation plumbing: `app/src-tauri/src/git.rs`, `app/src/lib/git/gitService.ts`
3. Existing error toast/reporting: `app/src/lib/git/gitErrorUi.ts`
4. Reference running-status cancel UX: [`Views/PopupRunningStatus.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/PopupRunningStatus.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/PopupRunningStatus.axaml)
5. Reference command lifecycle and process management: [`Commands/Command.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Command.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Command.cs)

## Implementation steps

1. Introduce cancellable command handles in Rust command layer:
   - command id registration
   - terminate signal abstraction per platform
   - completion cleanup
2. Expose `cancelGitCommand(commandId)` Tauri API and wire through `gitService.ts`.
3. Attach command ids to long-running operations in `VersionControlView.svelte`.
4. Add cancel button/secondary action in busy UI state; disable after cancel is requested.
5. Map cancellation outcome to non-error informational toast unless command already completed.
6. Add tests for cancellation race conditions (cancel after completion, repeated cancel, unknown id).

## Acceptance checklist

- [ ] User can cancel active fetch/pull/push from UI.
- [ ] Cancel terminates subprocess and clears busy state promptly.
- [ ] Cancellation does not leave stale lock state in VC toolbar.
- [ ] Race conditions are handled safely and test-covered.

## Dependencies

- Existing remote-op busy flow in phase 4

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
