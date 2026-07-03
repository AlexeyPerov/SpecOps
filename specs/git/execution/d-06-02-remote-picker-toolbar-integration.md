# D-06 Task 2 — Remote picker toolbar integration

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-06](../backlog.md) — Remote picker for push/pull  
**Prior task:** [d-06-01-remote-picker-state-model-and-persistence.md](./d-06-01-remote-picker-state-model-and-persistence.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~0.75d

## Goal

Expose remote picker controls in Version Control toolbar and execute fetch/pull/push against selected targets with clear UX and error handling.

## Required context

1. `app/src/lib/components/VersionControlView.svelte` toolbar actions
2. `app/src/lib/git/gitService.ts` (`fetchRemote`, `pullRemote`, `pushRemote`)
3. Existing busy-state helpers: `app/src/lib/git/versionControlRemoteOps.ts`
4. Reference push target dialogs: [`Views/Push.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Push.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Push.axaml)
5. Reference pull behavior controls: [`Views/Pull.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Pull.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Pull.axaml)

## Implementation steps

1. Add compact remote `<select>` in toolbar (visible when remotes exist and repo is writable).
2. Update remote operations to accept explicit remote argument when selected; fallback to existing behavior when none.
3. Add optional branch target input/select for pull/push if operation API supports it; otherwise scope to remote-only selection and document branch-target follow-up.
4. Keep buttons disabled while remote operation is active and while remotes are loading.
5. On command failure, use `reportGitError` and keep picker state intact.
6. Extend manual checklist for remote-selection flows.

## Acceptance checklist

- [ ] Fetch/pull/push use selected remote when set.
- [ ] Toolbar remains functional when no remotes exist (controls disabled with hint).
- [ ] Selection changes do not trigger unnecessary status/history refreshes.
- [ ] Existing no-upstream and auth errors still render user-friendly messages.

## Dependencies

- [d-06-01-remote-picker-state-model-and-persistence.md](./d-06-01-remote-picker-state-model-and-persistence.md)
- D-05 askpass tasks recommended for auth UX completeness

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
