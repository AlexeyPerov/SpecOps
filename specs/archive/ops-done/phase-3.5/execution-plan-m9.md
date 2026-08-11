# Phase 3.5 Milestone 9 Execution Plan — Shared wire-reader extraction

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m8.md](./execution-plan-m8.md) (M8 lands first
so this refactor validates the new live-stream code paths).

**Status:** complete.

**Goal:** eliminate the triplicated wire-reader primitives surfaced in the
review. `readObject` / `readString` / `readNumber` / `readBoolean` /
`readStringList` / `readTokenUsage` are defined **identically and
independently** in three modules (~120 redundant lines). Extract them into one
shared module so the three sites stop drifting.

This is a `[P2]` cleanup: pure, no behaviour change, no public-API change. The
value is preventing drift as the OpenCode wire shapes evolve (M2–M5 already
added tolerance for several field aliases; a single reader makes future
alias-tolerance a one-line change).

---

## Tasks

- [x] **[P2] M9-T1 — Extract shared wire readers.** Create a single module
  hosting the tolerant readers and adopt it everywhere they are currently
  duplicated.
  - New module: `app/src/lib/ai/backends/wireReaders.ts` exporting
    `readObject`, `readString`, `readNumber`, `readBoolean`, `readStringList`,
    `readTokenUsage` (and any small companion helpers like the
    `null`-on-whitespace contract used by `readString`).
  - Adopt in:
    - `app/src/lib/ai/backends/opencodeSessionMessages.ts` (`:21-81` — the
      hydration mapper's local readers).
    - `app/src/lib/ai/backends/workspaceAgentBackend.ts` (`:835-848` and
      `:1026-1053` — `mapStreamFrame` / mapper readers).
    - `app/src/lib/services/chatPersistenceCodec.ts` (`:235-269` — the
      `parseOptionalString/Number/Boolean` / `parseTokenUsage` validators).
      These are stricter (fail-closed for disk persistence) so either reuse the
      shared readers directly (they already return `null` for invalid input,
      which is what the validators want) or thin wrappers that preserve the
      current names. Prefer reusing directly and renaming call sites where the
      name difference is cosmetic.
  - Preserve the existing semantics exactly:
    - `readString` returns `null` for whitespace-only (used to gate *required*
      fields) — keep this contract; it is load-bearing.
    - The codec's fail-closed-on-bad-part behaviour
      (`chatPersistenceCodec.ts:376-383`) is **not** in these helpers and must
      remain at the codec boundary.
  - Do **not** change any tolerance behaviour or alias handling in this
    milestone — that is behavioural change and belongs in M11 if at all.

- [x] **[P2] M9-T2 — Tests unchanged.** The existing tests
  (`opencodeSessionMessages.test.ts`, `workspaceAgentBackend.test.ts`,
  `chatPersistence.test.ts`) already pin the reader semantics. They must pass
  unchanged after the extraction. Add a small `wireReaders.test.ts` only if the
  existing coverage does not exercise an edge case the shared module now owns
  (e.g. whitespace-only `readString` → `null`).

---

## Exit criteria

- One definition of each wire reader; the three previous sites import it.
- No behaviour change: all existing tests pass without modification (except
  import paths / cosmetic renames at call sites).
- ~120 lines of duplication removed.
- `npm test` / `npm run check` pass.

## Notes

- This milestone is a prerequisite for any future wire-shape tolerance work —
  after it lands, adding an alias (e.g. accepting both `topP` and `top_p`
  everywhere) is a single edit instead of three.
- Keep the diff mechanical; resist the urge to "improve" the readers (e.g.
  stricter typing) in the same change — that risks behavioural drift and
  belongs in a separate task if desired.
