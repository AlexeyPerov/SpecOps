# 01 — Phase D implementation notes

**Date:** 2026-08-12
**Scope:** [`execution-plan-phase-d-agent-host.md`](execution-plan-phase-d-agent-host.md)

Phase D delivers the bundled Agent Host: a Node sidecar that owns runtime
adapters outside the WebView and exposes them through a versioned JSON-RPC
protocol over stdio. It registers the deterministic fake adapter from phase C
so it is drivable end to end without a vendor runtime. The WebView imports no
host code — the host is a separate package (`app/host/`) that shares the
phase B/C common contracts.

## Package layout (`app/host/`)

A self-contained Node package that reuses the app's installed toolchain (esbuild,
tsc, vitest) via Node module-resolution walk-up — no extra `npm install` is
required. The single shared dependency is the phase B/C session domain, imported
as `../../src/lib/session`.

- `package.json`, `tsconfig.json` (`moduleResolution: bundler`, strict, includes
  the shared session domain for type-check), `vitest.config.ts` (node env),
  `.gitignore` (`dist/`, `node_modules/`).
- `scripts/build.mjs` — esbuild bundles `src/index.ts` into a single self-contained
  `dist/index.js` (ESM, node20 target) and injects build metadata
  (`__HOST_VERSION__`/`__BUILD_GIT__`/`__BUILD_TIME__`) via `define`.

### AS01-D-01 — host package + build artifact
- `src/version.ts` — deterministic `HOST_VERSION` (from package.json at build) +
  `PROTOCOL_VERSION`; informational `BUILD_GIT`/`BUILD_TIME`/`RUNTIME_NODE`;
  `buildInfo()` aggregator. Tests assert structure, not absolute timestamps.
- `src/host.ts` — `createHost` wires registry → dispatcher → framing over stdio,
  with SIGTERM/SIGINT → graceful shutdown. `createDefaultRegistry` registers the
  fake adapter with two well-known dev prompts (`ping` → finish, `long-running`
  → hang-until-cancelled) so the host is exercisable and supervisable end to end.
- `src/index.ts` — CLI entry (`node dist/index.js`), bundled with the shebang banner.
- `src/registry.ts` — `AdapterRegistry` maps runtime id → adapter; `descriptors`,
  `health`, `require` (raises `UnknownRuntimeError` for unregistered runtimes).

### AS01-D-02 — versioned JSON-RPC protocol
- `src/protocol.ts` — JSON-RPC 2.0 over newline framing. `PROTOCOL_VERSION = 1`,
  limits (`MAX_MESSAGE_BYTES`, timeouts, `MAX_CONCURRENT_TURNS`), standard +
  custom error codes (`PROTOCOL_VERSION_MISMATCH`, `MESSAGE_TOO_LARGE`,
  `TIMEOUT`, `CANCELLED`, `SHUTTING_DOWN`, `NOT_INITIALIZED`, `ADAPTER_ERROR`).
  Methods: initialize/discover/auth/catalog.*/session.*/turn.send/cancel/
  permission.reply/question.reply/health/shutdown; notifications `session.event`
  and `runtime.healthChanged`. Per-method param decoders return `DecodeResult`
  and fail explicitly. `classifyIncoming` rejects non-RPC and response envelopes.
  **Version negotiation:** incompatible client versions fail at initialize with
  `PROTOCOL_VERSION_MISMATCH` and the host exits.

### AS01-D-03 — framing, dispatch, backpressure
- `src/framing.ts` — newline-delimited JSON. `readMessages` attaches listeners
  eagerly (data written before iteration is not lost), reassembles split
  messages, and rejects oversized/malformed lines plus an unterminated-oversized
  high-water reset (memory cannot grow without bound). `writeMessage` refuses
  oversized payloads. stderr is never parsed.
- `src/dispatch.ts` — `HostDispatcher` routes requests, correlates one response
  per request, and drives turn streams as `session.event` notifications. The
  `turn.send` ack is written before any event; events are written in adapter
  order and each write awaits stdout drain (pull-based **backpressure**). A
  bounded `MAX_CONCURRENT_TURNS` caps active streams. **Cancellation** via
  `turn.cancel`/shutdown asks the adapter to cancel; the adapter emits
  `turn.cancelled` which the pump forwards. If a stream rejects mid-flight, the
  host synthesizes `turn.failed` (seq = last seen + 1) so exactly one terminal is
  always observed. **Graceful shutdown** cancels and awaits every active turn
  before resolving.
- `src/errors.ts` — maps adapter/registry/internal failures to `RpcError`
  (adapter errors keep their `adapterCode`; messages are redacted).

### AS01-D-04 — redaction + protocol fixtures
- `src/redact.ts` — reuses the session domain redactor for stderr logs, error
  `data`, and exported fixtures; `containsSecretCanary` guard for the suite.
- `src/fixtures.ts` — golden fixtures categorized valid/malformed/oversized/
  unknown/timed-out (oversized built from `MAX_MESSAGE_BYTES`, not embedded).

## Tests (`app/host/src/*.test.ts`, 48 tests, all green)
- `protocol.test.ts` (13) — constants/methods/error codes, `classifyIncoming`,
  version negotiation, per-method decoders (valid + invalid), message builders,
  golden-fixture classification.
- `framing.test.ts` (9) — one/multi/split messages, malformed + oversized
  rejection, unterminated-oversized reset, trailing-line flush, stream-error
  propagation, oversized write refusal.
- `dispatch.test.ts` (17) — initialize + version mismatch, not-initialized +
  method-not-found + invalid-params guards, unknown-runtime + adapter-error
  mapping, discovery/sessions/health, turn streaming (ack-then-events order,
  exactly one terminal, monotonic seq), concurrent-turn rejection, cancel →
  `turn.cancelled`, gated-permission flow, graceful + request shutdown,
  backpressure ordering.
- `redact.test.ts` (3) — bearer/api-key stripping, nested-field redaction,
  canary detection.
- `process.test.ts` (6) — spawns the built host over real stdio: full fake
  lifecycle (initialize→discover→session.create→turn.send→health→shutdown,
  exit 0), version-mismatch exit, survives malformed/oversized lines,
  `METHOD_NOT_FOUND`, and the timed-out model (long-running turn → cancel →
  `turn.cancelled`).

## Verification

- `node host/scripts/build.mjs` → `dist/index.js` (single ESM file, ~51 KB).
- `host: npm run check` (tsc --noEmit) → 0 errors.
- `host: npm test` (vitest) → **48 pass**; run twice → deterministic.
- Manual stdio smoke + `process.test.ts` confirm the host starts from the
  packaged path and reports `protocolVersion:1`, `name:"specops.agent-host"`,
  `hostVersion:"0.1.0"`, and the fake runtime descriptor.
- `grep` of `app/src/` confirms the WebView imports **no** host code.

## Handoff

Phase E may start: the host can be driven end to end from a standalone harness
and terminates cleanly on protocol shutdown (exit 0). Tauri process supervision
and process-tree cleanup land next.
