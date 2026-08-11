# Phase 3.5 Milestone 11 Execution Plan — Polish & spec housekeeping

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m10.md](./execution-plan-m10.md) (M10 lands
first so the token/structural cleanup happens against the refactored baseline).

**Status:** done.

**Goal:** close out the remaining review findings — the non-blocking polish
items plus the spec housekeeping needed to actually mark phase 3.5 complete.

This milestone mixes `[P1]` (visible-enough polish + the spec housekeeping that
unblocks the phase-closure verdict) and `[P2]` (minor correctness / consistency)
items.

---

## Tasks

- [x] **[P1] M11-T1 — Fix the `--space-*` token scale.** The M6-T1 additions
  are non-monotonic with duplicate values, which invites author mistakes:
  `--space-1` = `--space-2` = 2px; `--space-3` = `--space-6` = 6px;
  `--space-3` (6px) > `--space-4` (4px). The numeric suffix does not imply
  order.
  - Fix: collapse duplicates and make the scale monotonic (e.g. a 2px-stepped
    base scale: 2, 4, 6, 8, 12, 16, 20, 24). Audit every consumer of the
    changed tokens (the M5/M6 components) and adjust spacing where the old
    value was load-bearing — most consumers use these for small gaps where the
    exact pixel value is not visually critical, but verify.
  - Files: `app/src/lib/styles/tokens.css` (`:13-21` light + dark);
    `app/src/lib/styles/structuralTokens.test.ts` (assert monotonicity + no
    duplicates).
  - Tests: extend `structuralTokens.test.ts` to pin the new ordering invariant
    so it can't silently regress.

- [x] **[P2] M11-T2 — Decide and document the `compaction` / `cost` part
  render path.**
  - `cost` parts are produced by the hydration mapper
    (`opencodeSessionMessages.ts`) and consumed by `extractMessageStepTotals`
    (`chatSteps.ts`) — fine, but confirm no renderer tries to draw them
    directly.
  - `compaction` parts are produced and validated by the codec but appear to
    have **no UI consumer at all** — likely dead. Either wire a compaction
    marker renderer (the M1 spec called for "compaction markers") or prune the
    part type from the domain / codec / mapper and document the decision.
  - Files (if pruning): `domain/chat.ts`, `services/chatPersistenceCodec.ts`,
    `ai/backends/opencodeSessionMessages.ts`. If rendering: new small component
    or a row in `ChatMessageList.svelte`.
  - Record the decision in `specs/changelog.md` regardless of which way it
    goes.

- [x] **[P2] M11-T3 — Minor correctness & consistency items.** Bundle the
  small, independently-safe fixes from the review:
  - `summarizeSession` (`workspaceAgentBackend.ts:2598`): replace the
    stringly-typed `raw === true || raw === "true"` with a `readBoolean`-style
    coercion so a future object response (`{ ok: true }`) doesn't silently
    report failure.
  - `mapAgentEntry` (`opencodeSearch.ts:28-48`): the `MentionAgentEntry`
    interface advertises `isSubagent?: boolean` but the mapper never sets it —
    either populate it from the catalog or remove the field.
  - `opencodeSearch.ts:21` header comment claims "File search is debounced" but
    the debounce lives at the call site, not in the module — fix the comment
    (or move the debounce in, if that's cleaner).
  - `composerPromptQueue.ts` / `promptHistory.ts`: pick one mutation style
    (immutable reassign vs in-place `splice`/`count += 1`) and apply it
    consistently. Prefer immutable reassign so the queue/history are safe to
    lift into a Svelte `$state` proxy later.
  - `chatTokenFormat.ts:28-30` `formatCost`: zero-cost vs missing-cost both
    render `$0.00`; the session-total path works around this via `messageCount`
    but the per-message/per-step footers can't distinguish. Either accept and
    document, or thread an "unknown" sentinel for missing cost.
  - Files: per-item as listed above.
  - Tests: extend the relevant existing test files; no new test files needed.

- [x] **[P1] M11-T4 — Phase 3.5 spec housekeeping.** The exit-criteria
  checklist in `phase-3.5.md` is still all `[ ]` despite M0–M6 being DONE, and
  `Status:` still reads `draft`.
  - Tick the exit-criteria checklist (`phase-3.5.md:184-196`) to reflect
    reality **after** M7–M10 land (M7 fixes the M5 diff-store correctness that
    the "TODO panel + diff viewer render live session data" item depends on;
    M8 fixes the M1 live-stream criterion). Items that remain genuinely open
    (if any) stay `[ ]` with a note.
  - Flip `Status: draft` → `Status: complete` (or `post-review follow-ups
    tracked in M7–M11`) once M7–M10 are done.
  - Update `execution-plan.md` index table to list M7–M11 with their
    dependency order.
  - Add a `phase-3.5.md` changelog row for the post-review follow-up plan.
  - Files: `specs/ops/phase-3.5/phase-3.5.md`, `specs/ops/phase-3.5/execution-plan.md`.

---

## Exit criteria

- `--space-*` scale is monotonic with no duplicate values; consumers audited;
  ordering pinned by a test.
- `compaction` / `cost` part render path decided and documented (rendered or
  pruned).
- Minor correctness items (summarize boolean, isSubagent, debounce comment,
  mutation style, formatCost ambiguity) resolved or explicitly accepted with a
  documented note.
- `phase-3.5.md` exit-criteria checklist reflects actual state; `Status`
  updated; index table lists M7–M11.
- `npm test` / `npm run check` / `cargo test` pass.

## Notes

- M11-T4 (spec housekeeping) is the formal "phase 3.5 closed" gate. It should
  be the **last** task across M7–M11 to land, once the functional/correctness
  items it references are actually done.
- The `--space-*` change is the one item here with non-trivial visual blast
  radius — do it behind a careful audit of the M5/M6 components, and prefer
  visually-equivalent values where the old token was load-bearing.
