# D-05 Task 2 — Askpass UI and git service wiring

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-05](../backlog.md) — Custom in-app GIT_ASKPASS  
**Prior task:** [d-05-01-askpass-command-and-credential-request-flow.md](./d-05-01-askpass-command-and-credential-request-flow.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 8 · **Agent:** heavy · **Estimate:** ~1.0d

## Goal

Implement credential prompt UI and hook it into remote git operations so users can complete authentication flows directly in SpecOps.

## Required context

1. Dialog service patterns: `app/src/lib/services/tagPushPrompt.ts`, `app/src/lib/services/tagDeletePrompt.ts`
2. Version control entry view: `app/src/lib/components/VersionControlView.svelte`
3. Reference askpass dialog view: [`Views/Askpass.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Askpass.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Askpass.axaml)
4. Reference askpass view model: [`ViewModels/Askpass.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/Askpass.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/Askpass.cs)
5. Reference running-status UX for remote ops: [`Views/PopupRunningStatus.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/PopupRunningStatus.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/PopupRunningStatus.axaml)

## Implementation steps

1. Add `AskpassPrompt.svelte` component with:
   - prompt/body text
   - username/password input modes based on request metadata
   - submit/cancel actions and keyboard support (Enter/Escape)
2. Add `askpassPrompt.ts` service module (registry-runner pattern) that can open prompt, await user input, and return response/cancel.
3. Wire askpass event handling into `VersionControlView.svelte` lifecycle similarly to existing prompt mounts.
4. Integrate `gitService.ts` remote operations with prompt callback plumbing from Task 1 contract; ensure only one askpass prompt is active at a time.
5. On cancel, terminate waiting credential request and show consistent error via `reportGitError`.
6. Include secret-handling safeguards (never log plaintext credential fields to console diagnostics).

## Acceptance checklist

- [ ] Pull/push/fetch that requires credentials opens in-app prompt and resumes command after submit.
- [ ] Canceling prompt aborts operation and clears busy states.
- [ ] Prompt supports repeated challenge cycles (wrong password then retry) until git command exits.
- [ ] No plaintext credentials appear in logs, toasts, or persisted stores.

## Dependencies

- [d-05-01-askpass-command-and-credential-request-flow.md](./d-05-01-askpass-command-and-credential-request-flow.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
