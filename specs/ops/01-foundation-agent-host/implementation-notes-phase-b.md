# 01 — Phase B implementation notes

**Date:** 2026-08-12
**Scope:** [`execution-plan-phase-b-session-domain.md`](execution-plan-phase-b-session-domain.md)

Phase B introduces the runtime-neutral session domain as a self-contained
`app/src/lib/session/` module. It is the stable contract that Phase C adapters
produce and consume, Phase D/E hosts transport, and Phase F integrates into the
UI. It does **not** wire the live OpenCode workspace-session store/UI onto the
new domain — that switchover is Phase F ("Replace provider-specific… stores").
Nor does it implement host transport or a real adapter (Phase C/D/E).

## Deliverables (`app/src/lib/session/`)

### AS01-B-01 — ids, binding, lifecycle
- `runtime.ts` — `AgentRuntimeId` (`claude` | `codex` | `opencode` | `cursor`) +
  descriptors (id + label only — no vendor SDK types).
- `ids.ts` — branded ids: `SpecOpsSessionId`, `SpecOpsTurnId`, `NativeSessionId`.
  Unique-symbol brands make SpecOps vs native ids un-confusable at the API
  surface (cross-assignment is a compile error). Minted ids are deterministic
  (`sos-session-{n}`, `sos-turn-{n}`); validators reject empty/oversized ids.
- `binding.ts` — `AgentNativeBinding`, `AgentSessionRef`, model/mode
  descriptors, lifecycle statuses (`idle|running|waiting-permission|
  waiting-question|completed|failed|cancelled`), terminal-status helpers.
  **Immutable runtime:** `createSessionRef` fixes the runtime at creation;
  there is no in-place runtime mutator. `assertRuntimeImmutable` rejects
  runtime reassignment; `rebindRuntime` is the only path to a different runtime
  and returns a **new** session id (linking the source via `parentSessionId`).
  `updateSessionRef` patches mutable fields only (runtime/native untouched).

### AS01-B-02 — normalized turns + events
- `events.ts` — `SessionEvent` discriminated union: text (delta/finished),
  reasoning (delta/ended), tool (started/progress/completed), subtask.started,
  step (started/finished/failed), attachment.posted, diff.posted,
  usage.recorded, compaction.applied, permission.requested, question.requested,
  status.changed, turn (started/finished/failed/cancelled), and `diagnostic`.
  Carries `nativeSessionId` + monotonic `seq` + `at`.
- `redact.ts` — `redactForSerialization` strips bearer tokens / API keys /
  secret-named keys and bounds string size before persistence/logging.
  `toUnknownNativeDiagnostic` + `toMalformedDiagnostic` coerce unrecognized or
  malformed native events into `diagnostic` events (redacted) so they are
  preserved rather than dropped or reinterpreted.
- `transcript.ts` — `SessionTurn`/`SessionTurnPart`/`SessionTranscript` and the
  pure `applySessionEvent` reducer (folds events into the cached transcript) +
  `replaySessionEvents`. Deterministic: a replayed stream reproduces the same
  transcript. Aligned with the existing workspace backend stream-event shape so
  Phase C adapters normalize 1:1.

### AS01-B-03 — persistence schema + codecs
- `record.ts` — versioned `SessionRecord` (session ref + cached transcript) and
  per-workspace `SessionStoreIndex`/`SessionStoreIndexEntry` around the native
  binding. **No provider-prefixed fields** (`opencode*`/`chatHttp` are gone).
- `codec.ts` — `encodeSessionRecord` / `encodeSessionStoreIndex` emit
  canonical (recursively key-sorted, secret-redacted) JSON. Decoders return
  `DecodeResult<T>` and fail explicitly on any structural violation (bad
  version, unknown runtimeId/status, runtime/native mismatch, malformed
  turn/part) — **no silent partial decode**.

### AS01-B-04 — tests (`*.test.ts`, 37 tests, all green)
- `ids`/`binding`: brand separation (`@ts-expect-error` cross-assign),
  immutability (`assertRuntimeImmutable` throws; `rebindRuntime` mints a new
  id), validation, lifecycle classification.
- `events`/`redact`: every event kind constructible; bearer/key redaction;
  unknown-native + malformed diagnostic coercion.
- `transcript`: reducer accumulates text/reasoning/tools/parts/usage and
  completes a turn; failed turn keeps partial content; compaction +
  diagnostics; deterministic replay.
- `codec`: deterministic round-trip (encode→decode→encode byte-identical);
  canonical key order; secrets absent from output; immutable runtime + rebind
  link survive round-trip; explicit failure on 8 corrupt-record shapes and 3
  corrupt-index shapes.

## Verification

- `npm run check`: 0 errors in `app/src/lib/session/` (modules + tests).
  Phase B introduced **zero** new errors (total stays at the pre-Phase-B
  baseline; all remaining errors pre-date phase 01).
- `npm test`: 3011 pass / 5 fail. The 5 failures pre-date phase 01 and touch no
  session/chat code (`gitService`, `MarkdownOutlinePanel`,
  `workspaceFileCatalog.integration`) — out of Phase B scope.
- Grep of `app/src/lib/session/` for provider-prefixed persisted fields finds
  none: the only runtime mentions are the `AgentRuntimeId` enum (the
  runtime-neutral runtime identity defined by the roadmap) and doc comments
  stating the no-vendor-types invariant.
- No serialized fixture carries credentials or raw un-redacted native payloads
  (codec redaction + diagnostic redaction).

## Handoff

Phase C may start: the schema is stable and provider-independent, so the
adapter core + deterministic fake runtime can be defined against
`AgentSessionRef` / `SessionEvent` / `SessionTranscript` without
provider-specific exceptions.
