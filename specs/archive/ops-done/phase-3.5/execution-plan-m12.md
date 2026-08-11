# Phase 3.5 Milestone 12 Execution Plan — Post-completion polish (review observations)

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m11.md](./execution-plan-m11.md) (M11 formally closed
phase 3.5; this milestone lands the remaining "observations worth noting"
surfaced in the second-pass architecture & code-quality review).

**Status:** complete (M12-T1, M12-T2, M12-T3, M12-T4 done).

**Goal:** address the four non-blocking observations recorded in the phase-3.5
architecture & code-quality review. These were explicitly framed as *not*
blocking the phase-closure verdict — phase 3.5 is complete and functionally
correct — so each task here is a `[P2]` robustness / polish / housekeeping
improvement. None change phase-3.5's exit-criteria status.

The review's four observations, mapped to tasks:

| Observation (review) | Task | Severity |
|----------------------|------|----------|
| `ChatMessageList` renders parts by *type-block*, not interleaved; reasoning/subtasks/steps always appear in a fixed position regardless of their order in `parts[]` | M12-T1 | `[P2]` |
| `chatPersistenceCodec.parseParts` drops *all* parts for a message when *one* part is malformed | M12-T2 | `[P2]` |
| 185 `svelte-check` warnings (169 unused-CSS-selector from per-component `@import` of shared stylesheets + ~14 genuine a11y/reactivity warnings) | M12-T3 | `[P2]` |
| `formatCost` renders a genuine zero cost and a *missing* cost identically (`$0.00`); currently accepted-and-documented (M11-T3) | M12-T4 | `[P2]` |

---

## Tasks

- [x] **[P2] M12-T1 — Decide and implement the part-rendering order policy in
  `ChatMessageList`.** *(Done — took the recommended interleaving approach; see
  `specs/changelog.md` 2026-06-19 22:49.)*

  Today `ChatMessageList.svelte` derives each part kind via per-type extractors
  (`reasoningFor` / `subtasksFor` / `stepsFor` / `attachmentsFor` / `diffsFor`
  at `:348-353`) and renders them in a **fixed block order** inside each
  message `<li>` (`:387-469`): steps → reasoning → subtasks → content → tool
  cards → images → files → diffs → totals footer. The underlying `message.parts`
  array *does* preserve order (it is the source of truth stored on the message),
  but the renderer flattens by type. If OpenCode ever interleaves, say, two
  text segments around a reasoning block, that ordering is not preserved.

  This is acceptable for the current OpenCode wire shapes (which emit one text
  block per assistant message), but it is a latent limitation worth resolving
  explicitly.

  - **Recommended approach:** iterate `message.parts` in stored order and
    dispatch each part to its renderer (the renderers already exist —
    `ReasoningBlock` / `SubtaskCard` / `StepSeparator` / `ImageAttachment` /
    `FileAttachmentChip` / `InlineDiff` / `MarkdownRenderer`). Keep the
    per-message footer (`stepTotals`) and the tool-card block outside the
    part loop (they are not parts — tool calls live on `message.toolCalls`,
    totals are derived). Preserve the existing reasoning expand/collapse and
    subtask/diff toggle state by keying off each part's `id`.
  - **Accept-and-document approach (alternative):** if interleaved rendering
    turns out to regress the visual layout (reasoning appearing mid-text can
    read worse than a grouped panel), explicitly accept the type-block
    ordering and add a doc note to `ChatMessageList.svelte` stating the
    policy + the wire-shape assumption it rests on, plus a test that pins the
    current block order so a future change is deliberate.
  - Either way, record the decision (and its rationale) in
    `specs/changelog.md`.
  - Files: `app/src/lib/components/ChatMessageList.svelte`; the extractors in
    `ai/chatReasoning.ts` / `ai/chatSubtasks.ts` / `ai/chatSteps.ts` /
    `ai/chatAttachments.ts` / `ai/chatDiffs.ts` (reused, likely unchanged).
  - Tests:
    - If interleaving is implemented: a message whose `parts` interleave
      `text` / `reasoning` / `text` renders them in that order (component
      test via `_testComponentMount.ts`).
    - If accepted-and-documented: a test pinning the fixed block order
      (steps before reasoning before subtasks before content) so the policy
      can't drift silently.

- [x] **[P2] M12-T2 — Make `chatPersistenceCodec.parseParts` skip a malformed
  part instead of dropping all parts for the message.** *(Done — see
  `specs/changelog.md` 2026-06-19 23:18.)*

  `chatPersistenceCodec.ts:373-389` loops over the persisted parts array and
  calls `parseMessagePart(entry)`; if **any** entry returns `null`, the whole
  message's `parts` becomes `undefined` (all parts dropped). A single
  malformed part — e.g. a future part type not yet known to the codec — strips
  the structure (reasoning / steps / attachments) from an otherwise-valid
  message on load.

  - **Fix:** skip a `null` part and keep the valid ones. Return `undefined`
    only when the value is genuinely not an array (the truly-malformed case),
    OR when *every* part failed to parse (so a fully-corrupt array still
    degrades rather than producing a parts-less-but-present message — match
    the current "no parts → undefined" contract that downstream code relies
    on). Keep the per-part `parseMessagePart` validators unchanged (they
    already return `null` for a bad part); only the aggregation policy changes.
  - This is consistent with the wire-shape tolerance policy used at the
    transport boundary (`opencodeSessionMessages` already drops unknown part
    types one-by-one) and with AGENTS.md's no-migrations stance (no persisted
    shape changes — just a more lenient read of existing data).
  - Files: `app/src/lib/services/chatPersistenceCodec.ts` (`parseParts`
    `:373-389`).
  - Tests: extend `services/chatPersistence.test.ts`:
    - A parts array with one malformed entry among valid ones keeps the valid
      parts (round-trips the valid ones, drops the bad one).
    - An array where *every* entry is malformed still returns `undefined`
      (message degrades, not a parts-less message).
    - A non-array value still returns `undefined` (unchanged).

- [x] **[P2] M12-T3 — Reduce `svelte-check` warnings (185 → target ≤ 30).**
  *(Done — exceeded target; 185 → 0. See `specs/changelog.md` 2026-06-19 23:58.)*

  `npm run check` reported **0 errors / 185 warnings**. The warnings fall into
  two distinct categories that warrant separate handling:

  **T3a — Genuine a11y / reactivity warnings (~14, fix these):**
  - `Elements with the 'dialog' interactive role must have a tabindex value`
    (×5) — `SessionTimelineDialog.svelte`, `SessionListPanel.svelte`,
    `RevertPreviewDialog.svelte`, `ChatModeEditorDialog.svelte`,
    `AgentEditorDialog.svelte`. Add `tabindex="-1"` to the dialog elements.
  - `Visible, non-interactive elements with a click event must be accompanied
    by a keyboard event handler` (×3) — verify each; add the matching keyboard
    handler or convert to a `<button>` where the element is interactive.
  - `This reference only captures the initial value of …` (`state_referenced_locally`,
    ×5) — `StatusPopover.svelte:22`, `TodoPanel.svelte:32`,
    `DiffViewerPanel.svelte:35`, plus 2 more. These call a store factory inside
    the component body capturing a prop's initial value; move the call into a
    `$derived` or `$effect` so it tracks the live prop (or document why the
    initial-value capture is intentional).
  - `<button> cannot have role 'listitem'` (×1) — remove the conflicting role.

  **T3b — "Unused CSS selector" false positives (169, from per-component
  `@import` of shared stylesheets):**
  The 15 settings panels `@import` shared stylesheets
  (`styles/settingsForm.css`, `settingsFormMultiline.css`,
  `settingsPanelLists.css`, `settingsFoldout.css`) inside their own `<style>`
  blocks (e.g. `AgentEditorDialog.svelte:248-251`). svelte-check's per-component
  CSS analyzer cannot trace selector→element across an `@import` boundary, so
  it flags every `.settings-*` / `.connection-row-*` / `.required-section-*`
  selector as unused even though the classes are applied in the component
  markup. These are not dead code — the styles render correctly at runtime.
  - **Recommended fix:** import the shared settings CSS **once globally**
    (e.g. in the app's global stylesheet / root layout) and remove the
    per-component `@import` lines. This eliminates the false positives *and*
    stops the same CSS being re-emitted into 15 component bundles. Verify
    after the move that no selector relied on per-component scoping (the
    shared files are intentionally global-class-based, so they should not —
    but confirm).
  - **Alternative (if the global-import move proves risky):** document the 169
    as an accepted baseline driven by the shared-stylesheet pattern and leave
    them; track a future svelte-check config / suppression if the tooling
    gains one. Record whichever outcome in `specs/changelog.md`.
  - Files (T3a): the dialog / panel / popover components listed above.
  - Files (T3b): the 15 `components/settings/*.svelte` panels + the global
    stylesheet import site.
  - Tests: no new logic tests (these are markup/CSS/a11y fixes). Re-run
    `npm run check` and assert the warning count drops to the documented
    target; the full `npm test` suite stays green.

- [x] **[P2] M12-T4 — Distinguish missing cost from zero cost, or re-affirm the
  accept-and-document decision.** *(Done — re-affirmed; invariant pinned by a
  test. See `specs/changelog.md` 2026-06-20 00:30.)*

  `formatCost` (`ai/chatTokenFormat.ts:36-41`) renders both a genuine zero cost
  (free / fully-cached model) and a *missing* cost as `"$0.00"`. M11-T3
  explicitly accepted this and documented it (`chatTokenFormat.ts:27-35`),
  because the surrounding guards (`extractMessageStepTotals` /
  `extractSessionTotals` return `null` → no footer rendered; the
  session-total badge uses `messageCount`) already let the *session-level* path
  distinguish "no data" from "zero cost". The gap is the **per-message and
  per-step footers**, which can't.

  - **Re-affirm approach (recommended):** verify the documented guards still
    hold end-to-end (the per-message footer is only rendered when
    `extractMessageStepTotals` returns non-null — i.e. at least one step
    contributed cost/tokens — so a "missing cost" message renders *no footer*,
    not a `$0.00` footer). If that invariant holds, the ambiguity is already
    resolved everywhere it matters and M11-T3's acceptance stands; add a test
    pinning the invariant (a message with no cost part renders no footer) and
    close this task as "re-affirmed".
  - **Sentinel approach (only if the invariant does *not* hold):** thread a
    null/"unknown" sentinel through the four consumers (the per-message
    footer in `ChatMessageList.svelte:470-485`, `StepSeparator`, the
    `SessionTotalBadge`, and `extractMessageStepTotals`/`extractSessionTotals`)
    so a missing cost renders "—" or "—" while a true zero renders `$0.00`.
    This is the option M11-T3 deemed disproportionate; only do it if the
    re-affirm check finds a real gap.
  - Either way, record the outcome in `specs/changelog.md`.
  - Files: `ai/chatTokenFormat.ts` (doc only, unless sentinel approach);
    `ai/chatSteps.ts` (`extractMessageStepTotals`); the footer renderer in
    `ChatMessageList.svelte:470-485`.
  - Tests: a message with zero cost-contributing parts renders no footer
    (pins the invariant); if sentinel approach, a missing-cost footer renders
    the "unknown" sentinel and a true-zero renders `$0.00`.

---

## Exit criteria

- The part-rendering order policy in `ChatMessageList` is either interleaved
  (preserves `parts[]` order) or explicitly accepted-and-documented with a
  pinning test — decision recorded in the changelog.
- `parseParts` keeps valid parts when one is malformed; a fully-malformed array
  still degrades; new codec tests pass.
- `svelte-check` warnings reduced (target ≤ 30, or the residual documented as an
  accepted baseline with rationale); the genuine a11y/reactivity warnings fixed.
- The `formatCost` ambiguity is either re-affirmed (invariant pinned by a test)
  or resolved via a sentinel; decision recorded in the changelog.
- `npm test` / `npm run check` / `cargo test` pass.

## Notes

- This milestone is **not** required to consider phase 3.5 complete — it was
  already formally closed by M11-T4. M12 is a quality-of-life follow-up driven
  by the review's "observations worth noting" section. It can ship in any order
  and the tasks are independent of each other.
- Each task carries a "decide, then implement" shape because the review framed
  these as observations rather than defects — the right resolution for several
  is "document and accept", and that is a valid task outcome. Record the
  decision in `specs/changelog.md` regardless of which way it goes.
- Prefer the lowest-risk option in each task: the parseParts lenience (M12-T2)
  and the T3a a11y fixes are unambiguous improvements; the others (M12-T1,
  M12-T3b, M12-T4) have a real "accept and document" fallback that should be
  taken if the "fix" path turns out to regress behaviour or balloon in scope.
