# 01 — Phase C implementation notes

**Date:** 2026-08-12
**Scope:** [`execution-plan-phase-c-adapter-contract.md`](execution-plan-phase-c-adapter-contract.md)

Phase C introduces the mandatory adapter contract, the optional capability
extensions, the deterministic fake runtime, and a shared contract suite — all in
`app/src/lib/session/adapter/`. It is the runtime-neutral surface the Agent Host
(phase D) drives and that phase 02–05 vendor adapters implement. No vendor SDK
type appears in any public payload; the only runtime added to the domain is the
deterministic dev `fake` (foundation infrastructure, not a product runtime).

## Deliverables (`app/src/lib/session/adapter/`)

### AS01-C-01 — mandatory adapter core
- `errors.ts` — typed `AdapterError` + `AdapterErrorCode` union
  (`authentication-required|failed`, `session-not-found`, `turn-not-found`,
  `turn-not-active`, `capability-not-supported`, `cancelled`,
  `runtime-unavailable`, `malformed-event`, `internal`) so the host can map
  failures to protocol codes without parsing vendor text. `isAdapterError` /
  `adapterErrors.*` factories.
- `adapter.ts` — the mandatory `AgentRuntimeAdapter` interface: `describe`,
  `describeCapabilities`, `authenticate`, `createSession`, `resumeSession`,
  `send` (`AsyncIterable<SessionEvent>`), `cancel`, `health`, plus optional
  `describeCatalog`. Request/result types (`NativeSessionRef`,
  `AgentAuthRequest/Result/Challenge`, `CreateAgentSessionRequest`,
  `ResumeAgentSessionRequest`, `AgentTurnRequest`, `CancelAgentTurnRequest`,
  `AdapterHealth`, `AgentRuntimeCapabilities`, `AgentCatalogSummary`).
  Terminal-state semantics are documented in code: `turn.started` first, exactly
  one terminal event (`turn.finished|failed|cancelled`), monotonic `seq`, and
  idempotent `cancel()`. SpecOps owns `turnId` (passed in the request, echoed on
  events); the adapter owns `nativeSessionId` + `seq`.

### AS01-C-02 — capabilities + extensions
- `extensions.ts` — optional interfaces an adapter MAY implement: `Catalog`,
  `Permission`, `Question`, `Lifecycle`, `Checkpoint`, `Share`,
  `Configuration`, `Mcp`, `Skills`, `Commands`, `Todos`, `Diffs`,
  `Diagnostics`. Each has an `is*Extension` type guard; `CAPABILITY_EXTENSION_MAP`
  maps standardized capability ids to their required extension; `inferCapabilities`
  lets an adapter compute its advertised capabilities honestly from what it
  implements. Unsupported actions stay absent (no required no-ops); runtime
  settings extend the UI through `ConfigurationExtension` instead of new core
  methods.

### AS01-C-03 — deterministic fake runtime
- `fake/fakeScript.ts` — declarative `FakeRuntimeConfig` / `FakeTurnScript` /
  `FakeScriptedEvent`: per-prompt scripts (text/delta, reasoning, tool,
  usage/diff/step/subtask/attachment, status, permission, question, diagnostic,
  unknown-native, malformed), outcomes (finish/fail/hang), auth/health/catalog
  toggles, `tick`, `awaitReply`, and failure injection.
- `fake/fakeRuntimeAdapter.ts` — `createFakeRuntimeAdapter` implements the core
  + catalog/permission/question/lifecycle/checkpoint/configuration/todos/diffs/
  diagnostics extensions. No network, clock drift (fixed timestamp), or vendor
  binary. `seq` is monotonic per native session across turns and resume;
  `resumeSession` recovers or adopts unknown ids (restart simulation);
  `forkSession` mints a linked child. Cancellation + replies are deterministic:
  reply waiters are registered **before** the permission/question event is
  yielded so a reply received right after the event resolves; `cancel()` wakes a
  blocked/hanging stream to emit `turn.cancelled`.
- `fake/index.ts`, `index.ts` — barrels.

### AS01-C-04 — shared contract suite
- `adapter.contract.ts` — `runAdapterContractSuite(factory)` registers the
  universal invariants against any adapter: descriptor/runtime match, versioned
  capability details, **capability honesty** (advertised standardized capability
  ⇒ implemented extension), authenticate resolves, create/resume refs,
  `turn.started` first, exactly one terminal event, strictly monotonic `seq`
  within and across turns, `cancel()` ends the stream with `turn.cancelled`,
  `cancel()` idempotent when no turn is active, and `health()` reports a status.
  Parameterized by a `ContractAdapterFactory` (prompts + workspace root) so the
  phase 02–05 adapters plug in **unchanged**; adapter-specific content (specific
  unknown-event coercion) stays in adapter-local tests.
- `fake/fakeRuntimeAdapter.test.ts` — invokes the shared suite for the fake and
  adds fake-specific coverage: text/tool streaming, fail outcome, unknown-native
  and malformed → redacted diagnostics (secret canaries never survive),
  permission/question gating + reply, cancel-while-gated, error injection on
  create/auth/resume, fork, capability advertisement, catalog/health.

## Verification

- `npx vitest run src/lib/session/` → **65 pass** (8 files): Phase B suites still
  green (38) + Phase C adapter/fake (27). The contract suite contributes 12 of
  the 27; the remaining 15 are fake-specific.
- `npx tsc --noEmit` → no errors in `src/lib/session/` (Phase C added 0).
- Domain change (additive): `AgentRuntimeId` now includes `fake` as deterministic
  dev infrastructure; the four product runtimes stay first-class via
  `PRODUCT_RUNTIME_IDS` / `productRuntimeDescriptors()` so delivery order is
  preserved. No provider-prefixed types; no vendor SDK types in any payload.
- Secret canaries (`Bearer supersecret`) do not appear in `redactedRaw` (redaction
  runs before diagnostic coercion, re-asserted in the fake suite).

## Handoff

Phase D may start: the adapter core + fake are stable and provider-independent,
so the Agent Host can transport them over a versioned JSON-RPC protocol and
register the fake adapter as the first runtime.
