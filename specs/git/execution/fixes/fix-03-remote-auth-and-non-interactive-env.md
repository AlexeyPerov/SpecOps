# FIX-03 — Remote auth and non-interactive env

**Priority:** P1 · **Score:** 8 · **Agent:** medium · **Estimate:** ~1.5d

**Source:** Git integration code review (2026-07-04)  
**Backlog:** [D-05](../../backlog.md) — Custom in-app GIT_ASKPASS  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

Remote fetch/pull/push and tag network operations invoke plain `git` with no credential UI. When OS credential helpers fail or SSH needs interaction, operations may hang (until cancel) or fail with opaque stderr. Tag push/delete remote ops are not cancellable.

## Goal

Make remote git operations fail predictably without tty hangs, and wire in-app credential prompts where helpers are unavailable.

## Required context

1. [d-05-01-askpass-command-and-credential-request-flow.md](../d-05-01-askpass-command-and-credential-request-flow.md)
2. [d-05-02-askpass-ui-and-git-service-wiring.md](../d-05-02-askpass-ui-and-git-service-wiring.md)
3. `app/src-tauri/src/git.rs`, `app/src/lib/git/gitService.ts` — env passthrough on `run_git`
4. `app/src/lib/git/gitErrorUi.ts` — auth failure messaging
5. `app/src/lib/components/GitTagsPanel.svelte` — tag push without cancellation

## Implementation steps

### Phase A — Fail fast (can ship independently)

1. Add `buildNonInteractiveRemoteEnv()` helper setting at minimum `GIT_TERMINAL_PROMPT=0` (and document SSH behavior).
2. Apply to `fetchRemote`, `pullRemote`, `pushRemote`, `pushTag`, `deleteRemoteTag`, and `queryRemoteTags` / `git ls-remote` calls.
3. Map common hang/auth stderr patterns in `gitErrorUi.ts` to actionable messages.
4. Unit tests for env helper and error classification.

### Phase B — In-app askpass (implements D-05)

5. Execute D-05 Task 1: askpass request/response contract in Rust + types.
6. Execute D-05 Task 2: prompt UI, service wiring, single-prompt mutex.
7. Wire askpass env per remote operation; clear env after command completes.
8. Add timeout for stale askpass requests; integrate with FIX-09 cancellation where applicable.

### Phase C — Tag remote ops parity

9. Pass `commandId` through tag push/delete remote wrappers; respect toolbar busy/cancel where appropriate.

## Acceptance checklist

- [ ] Remote operations without credentials fail within bounded time (no indefinite tty wait).
- [ ] Auth failures show user-facing guidance (check credentials, SSH agent, etc.).
- [ ] In-app askpass prompt appears when git requests credentials (HTTPS/SSH as supported).
- [ ] Askpass env does not leak to subsequent unrelated git commands.
- [ ] Tag push can be cancelled when invoked during a cancellable remote flow.

## Dependencies

- Existing remote ops and cancellation (D-12 complete)
- FIX-09 for shared timeout/cancel semantics (optional overlap)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`; mark D-05 tasks `[DONE]` when Phase B complete.
