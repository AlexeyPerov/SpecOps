# D-07 Task 2 — Stash checkout deal-with-local-changes flow

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-07](../backlog.md) — Stash → checkout flow  
**Prior task:** [d-07-01-stash-core-git-service-operations.md](./d-07-01-stash-core-git-service-operations.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 8 · **Agent:** heavy · **Estimate:** ~1.0d

## Goal

Add user-facing checkout flow that offers stash options when working tree is dirty, then performs checkout and optional stash apply/pop safely.

## Required context

1. `app/src/lib/components/GitBranchesPanel.svelte` checkout actions and disabled states
2. Existing dialog services in `app/src/lib/services/*Prompt.ts`
3. Reference decision dialog: [`Views/DealWithLocalChangesMethod.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/DealWithLocalChangesMethod.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/DealWithLocalChangesMethod.axaml)
4. Reference stash checkout helper: [`Views/CheckoutBranchFromStash.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/CheckoutBranchFromStash.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/CheckoutBranchFromStash.axaml)
5. Reference stash VM flow: [`ViewModels/StashesPage.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/StashesPage.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/StashesPage.cs)

## Implementation steps

1. Add a prompt service/component for “local changes detected” choices:
   - cancel checkout
   - stash and continue
   - keep current MVP block path (for safe fallback)
2. Integrate with branch checkout action:
   - detect dirty tree
   - run stash before checkout when chosen
   - optional apply/pop after successful checkout
3. Handle failure stages independently (stash failed, checkout failed, apply failed) with clear toasts and suggested recovery.
4. Keep state refreshes scoped (`mutationChangesHead`) and avoid duplicate history reloads.
5. Add manual checklist entries for dirty checkout + stash-assisted flow.

## Acceptance checklist

- [ ] Dirty checkout prompts user instead of only hard-block behavior.
- [ ] “Stash and continue” results in successful checkout when no conflicts.
- [ ] Failed stash/apply does not lose user state silently; errors are surfaced.
- [ ] No branch checkout occurs when user cancels.

## Dependencies

- [d-07-01-stash-core-git-service-operations.md](./d-07-01-stash-core-git-service-operations.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
