# Foundation stabilization evidence and review dispositions

**Date:** 2026-10-04 15:48 MSK

**Scope:** AS01-S, source-checkout macOS 14.4 with Node 24.15.0, protocol version 1, fake runtime. No real credentials or production adapters are used. Historical reviews remain unchanged.

## Implemented boundaries

- The production store writes full binding entries immediately. Index read/modify/write operations are serialized per workspace; debounced thread writes preserve binding fields and use independent timers per workspace/session. The send pipeline awaits the index writer before a native turn. Model, mode, runtime metadata/settings, parent and share hints round-trip. A different runtime/native ID returned by resume raises an explicit error; the old binding remains and no prompt is sent to the replacement.
- Rust owns an eight-message stdin writer queue and at most 64 pending requests. Pipe writes happen on a separate thread, outside the state mutex. A request timeout retires only its generation and kills/reaps the process group, releasing blocked writes and other pending calls. Starts/stops serialize on a lifecycle mutex. Shutdown permits its RPC while rejecting new ordinary requests, closes stdin, gives the leader a grace window and kills the entire remaining group, including TERM-resistant descendants.
- Frontend streams await listener setup, bound their event queues to 256, settle on cancel/stop/restart or generation/liveness failure and remove their subscriptions/listener/timers. Active streams check status every 500 ms with a 1 s status deadline. Recovery keeps the native binding and requires a new user action; restarting the host does not replay a prompt.
- Host responses and events share a serialized writer with a 4 MiB queue ceiling, callback/drain acknowledgement, a 1 s drain deadline and a symmetric 1 MiB JSON-frame limit. Write failure retires the transport; it does not attempt a second failure event on a broken pipe. An oversized adapter event becomes a bounded failed-turn event. Missing terminal delivery, invalid host framing or a full/disconnected Tauri event queue retire the generation, making stream loss observable through status.
- Input framing uses a stateful UTF-8 decoder, limits its queue to 64 frames, pauses/resumes readable input, rejects flooding peers and discards an oversized frame through its delimiter. Pending reads reject on stream error; early iterator return removes listeners. Malformed envelopes with recoverable scalar IDs receive an invalid-request error; invalid IDs receive an error with null ID and never route to an adapter. Dispatch deadlines suppress late responses.
- Typed/protocol/internal errors, synthetic failures, diagnostics and persisted runtime metadata are redacted at their output boundaries. OAuth token/secret/cookie keys, common token prefixes and secret assignments are covered. Rust does not copy untrusted stderr contents into application logs.
- Contract fixtures drain through iterator completion with a deadline, reject duplicate/trailing terminals, resume serialized native refs through a fresh adapter and require unknown/malformed/secret/typed-error fixtures. Advertised standardized capabilities require extension evidence. Catalogs live in the optional extension; rebinding clears source-runtime model/mode/capability descriptors. Transcript replay preserves the first terminal and sums per-call usage; explicit subtask terminal kinds are available. Strict codecs reject malformed optional fields and preserve step tokens/cost usage.

## Recorded bounds and support

| Path | Bound/policy |
| --- | --- |
| Ordinary bridge request | 30 s maximum; caller deadline clamped to 1–30,000 ms |
| Initialize | 10 s |
| Shutdown | RPC up to 3 s, then leader grace up to 3 s; remaining group killed and leader waited |
| Quit during start | Waits for the serialized initialize (up to 10 s), then bounded shutdown |
| Host cancel/drain | Up to 1 s for adapter cancellation plus 1 s for stream drain; a noncooperating stream is detached and settled |
| Frontend death detection | 500 ms poll interval + at most 1 s for status response |
| JSON message | 1 MiB excluding newline, both directions |
| Queues | Host input 64 frames, output 4 MiB; Rust writer 8 frames/pending 64; frontend 256 events |

Process/orphan fixtures were exercised on macOS. Linux uses the same Unix process-group implementation but is not accepted as supported until its platform smoke in AS03-B-05/AS08-A. Windows host launch explicitly fails before spawning: Job Object/tree cleanup and platform smoke are required before enabling it. No cross-platform or installed-build support is claimed by this record.

## Verification

- Production disk integration: `chatPersistence.integration.test.ts` creates an isolated temporary directory, writes through the real store and production persistence functions (with a filesystem-backed atomic-write adapter), resets store state, reloads disk and resumes the saved native ID through a new adapter. Credentials in metadata are redacted.
- Fresh-process integration: `host/src/process.test.ts` stops the first host, initializes a new process, resumes a serialized native reference and completes another turn.
- Failure fixtures: split Cyrillic/emoji bytes, pending read errors, oversized/flooding input, invalid envelope IDs, hung dispatch/late response, failed stdout, ignored cancel/shutdown, host death/replacement/listener failure and secret-bearing diagnostics/errors.
- Rust process fixtures: filled unread stdin, concurrent starts, ignored shutdown, crash/liveness polling with TERM-resistant grandchildren and stale-reader isolation. All children are cleaned up by the tests.
- Full frontend, host and Rust suites, type checks and production build are recorded in the changelog after the final run.

## Critical/Major disposition ledger

“Fixed” means the common foundation implementation and listed fixtures cover the reviewed failure. Future vendor adapters still require their own native/credential acceptance.

| Review | Disposition and evidence/owner |
| --- | --- |
| R1-C1 | Fixed — production disk/store restart integration and send write barrier |
| R1-C2 | Fixed — separate bounded writer; unread-stdin Rust fixture and request deadline cleanup |
| R1-C3 | Fixed — tracked pump rejection, failed-output transport retirement, EPIPE fixture |
| R1-M1 | Fixed — bounded cancel/drain and noncooperating-stream shutdown fixture |
| R1-M2 | Fixed — pending framing read rejects on error; read-error fixture |
| R1-M3 | Fixed — stateful decoding; Cyrillic/emoji split at every byte |
| R1-M4 | Fixed — bounded input/output and real response/event backpressure; flood/slow-consumer fixtures |
| R1-M5 | Fixed — typed/protocol/error and synthetic-event redaction; canary fixtures |
| R1-M6 | Fixed — enforced initialize/request deadlines, TIMEOUT response, late-response suppression |
| R1-M7 | Fixed — symmetric output size/queue limits; bounded failure on oversized adapter output |
| R1-M8 | Fixed — invalid envelopes answer recovered IDs; malformed-envelope fixture |
| R1-M9 | Assigned — [AS03-B-01](../03-codex-preview-delivery/execution-plan-phase-b-packaging-diagnostics.md#as03-b-01--package-host-and-compatible-node): reproducible packaged host metadata/build |
| R1-M10 | Fixed — shutdown RPC is allowed while stopping; bounded leader grace and group escalation |
| R1-M11 | Fixed — serialized lifecycle; concurrent-start single-generation fixture |
| R1-M12 | Fixed — liveness exit retires generation, settles pending requests and kills group; crash/orphan fixture |
| R1-M13 | Restricted — Windows launch disabled; [AS03-B-05](../03-codex-preview-delivery/execution-plan-phase-b-packaging-diagnostics.md#as03-b-05--verify-component-compatibility-and-installed-lifecycle) owns Windows tree cleanup/platform acceptance before enabling |
| R1-M14 | Assigned — [AS03-B-01](../03-codex-preview-delivery/execution-plan-phase-b-packaging-diagnostics.md#as03-b-01--package-host-and-compatible-node): bundled/compatible Node and GUI launch smoke outside developer PATH; checkout setup requires Node on PATH |
| R1-M15 | Fixed — shared collector drains to completion; duplicate/trailing terminal and stuck-completion negative fixtures |
| R1-M16 | Fixed — required factory fault hooks for unknown/malformed events, secret canaries and typed missing-history errors; fresh-instance/process resume |
| R1-M17 | Fixed — scripted diagnostic raw/message redaction; host/domain canary tests |
| R1-M18 | Fixed — reducer ignores duplicate start and post-terminal turn mutations; terminal immutability fixture |
| R1-M19 | Fixed — per-call usage/cost sums and preserved cost parts; codec/usage fixtures |
| R1-M20 | Fixed — typed optional/usage/model/reason validation; negative codec fixtures |
| R1-M21 | Fixed — expanded OAuth/secret/cookie keys and token prefixes; recursive redaction bounds |
| R1-M22 | Fixed — explicit subtask completed/failed event kinds and both reducers |
| R1-M23 | Fixed — optional catalog-only interface, catalog capability-extension mapping |
| R1-M24 | Fixed — rebind clears old runtime descriptors/capabilities; binding suite |
| R1-M25 | Fixed — every part variant, tool status, reasoning, diagnostics, compaction, step tokens and malformed optional fields round-trip tests |
| R1-M26 | Assigned — [AS02-A-05](../02-codex-adapter/execution-plan-phase-a-protocol-auth.md#as02-a-05--build-neutral-discovery-and-profile-creation-ui): catalog ensure-start/retry ownership before native login acceptance |
| R1-M27 | Fixed — listener failures, status/generation monitoring, local bounded cancel and subscription cleanup fixtures |
| R1-M28 | Fixed — incompatible resumed IDs explicitly rejected before send; native binding retained |
| R1-M29 | Assigned — [AS02-A-05](../02-codex-adapter/execution-plan-phase-a-protocol-auth.md#as02-a-05--build-neutral-discovery-and-profile-creation-ui): runtime/profile/model/settings creation flow |

No Critical item is deferred. Remaining Major UI/build work has an explicit next-phase gate; unsupported targets cannot silently launch a host without proven tree cleanup. Profile identity is intentionally added by AS02-A-02/AS02-B-01, without persisted-data migrations or compatibility shims.
