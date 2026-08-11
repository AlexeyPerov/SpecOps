# OpenCode Milestone 1 Gap Analysis (Contract Alignment)

**Goal:** document what Milestone 1 delivered and what must be corrected before continuing Milestone 2 Task 2+.

## Summary

Milestone 1 delivered strong runtime foundations (sidecar lifecycle, URL mode, settings, backend seam), but the adapter contract currently diverges from canonical OpenCode session/prompt/event APIs. A bridge milestone (`m1-5`) is required to avoid building M2/M3 on unstable assumptions.

## What M1 delivered well

- Sidecar lifecycle and health controls are implemented and tested.
- URL mode settings and health status model exist.
- Workspace backend abstraction exists and is wired into workspace send path.
- Session mapping metadata persistence primitives exist.

## Critical contract mismatches

1. **Run-centric transport assumption**
   - Current adapter still models `/sessions/{id}/runs` and run event streams.
   - OpenCode phase-3 target model is session prompt + event subscription.

2. **Event type drift**
   - Current normalization centers on custom/legacy aliases.
   - Needed for M2: deterministic mapping from OpenCode event names for text/tool/permission/question lifecycles.

3. **Reply APIs missing at backend interface**
   - M2 Task 3/4 require permission/question reply commands.
   - Current backend surface does not provide first-class reply methods.

4. **Model/provider alignment gap**
   - Workspace selectors still need explicit OpenCode provider/model catalog and fallback rules.
   - Current selection/metadata path is only partially aligned.

5. **Restore reconciliation not fully integrated**
   - Mapping helpers exist, but runtime restore/recovery semantics need explicit contract checks against backend session state.

## Why this blocks M2 Task 2+

- Tool cards, permission modal, and question modal depend on correct normalized events and reply commands.
- If contract remains run-centric, M2 UI work risks rework during cutover.
- M3 HTTP removal requires confidence that workspace runtime is entirely OpenCode-contract compliant.

## Bridge strategy (M1 -> M1-5 -> M2)

- Add a focused M1-5 milestone for contract realignment and validation.
- Resume M2 from Task 2 only after M1-5 exit criteria are met.
- Keep M3 dependent on M2 completion plus M1-5 alignment.
