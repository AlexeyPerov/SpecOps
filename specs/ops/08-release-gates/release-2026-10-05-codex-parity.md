# Selected native parity release submission — 2026-10-05

**Recommendation: blocked.** AS02-E/F/G finite source parity is implemented and source verified. This is a new selected submission; [historical AS08-A evidence](release-2026-10-05.md) remains unchanged.

[Machine record](release-2026-10-05-codex-parity.json) identifies the tested source as parent `70fbc46b80f07e5bee09e8814a9432654cf44525` plus pending AS02-G working-tree changes. AS02-E (`141df64`) and AS02-F (`70fbc46`) were already committed. The record includes fresh source payload and built/copied asset SHA-256 values; it does not certify the later review commit by an invented hash.

Recorded at **2026-10-05T14:04:48.772Z** (17:04:48 MSK), Darwin arm64/macOS 14.4 build 23E214, Node 24.15.0. Distribution is a source checkout with copied adjacent no-account payload; signed installed acceptance remains open. Runtime pins remain native CLI 0.160.0, native HTTP SDK/runtime 1.17.4, coding SDK 0.3.289/native CLI 2.1.289 and local SDK 1.0.35.

The private repeatable runner command was:

```sh
node scripts/release/run-source-gate.mjs /tmp/specops-codex-parity-source-20261005-1703
```

| Step | Fresh result |
| --- | --- |
| Host type check | Pass |
| Host build | Pass |
| Host serial full tests | 348 pass, 7 explicit skips; 25 files pass, 2 files skipped |
| Frontend check | Pass; 0 errors, 0 warnings |
| Frontend build | Pass |
| Frontend full tests | 2948 pass; 283 files |
| Rust tests | 79 pass |
| Coding SDK copied assets | Pass; isolated pinned package/native version, no account inference |
| Local SDK copied assets | Pass; durable JSONL worker/assets/native executables, auth/inference/installed/sandbox enforcement unverified |
| Record validator tests | 13 pass |

All ten sequential steps exited 0. Runner removes credential/paid-smoke/profile overrides. Raw local runner logs are private diagnostic material and are not a secret-safe support export. Synthetic native fixtures test protocol/control and production ownership/history behavior, not actual provider account enforcement.

E evidence covers native fork/checkpoints/durable lineage, owned compact acknowledgment/progress/Stop/timeout/faults and exact active steering with a durable single-use receipt. F evidence covers bounded skills/MCP inventory, existing owned server toggles/reload, private finite config CAS, opaque scoped permissions and credential masking. G evidence covers exact child states/activity and separate native context-compaction cards through transport/adapter, dispatcher/client/pipeline, production disk/cache recovery and real message-list UI; malformed/late/foreign/oversized/secret/capacity/concurrent ownership fixtures pass. Control-tool completion is never equated with child completion, and native compaction never invents local removed-message accounting. The [finite feature ledger](../02-codex-adapter/implementation-notes-phase-g.md) explains native harness ownership and explicit unavailable controls.

Targeted host controls/thread/activity checks (60 tests before the two final activity cases) and production persistence/message-list/reducer checks (46 tests) passed. Final activity suite (18 tests) also passed before full submission. An initial targeted run exposed withheld short-text deltas and quadratic secret scanning on long lexical atoms; the affected carry/redaction paths were corrected and targeted/full suites passed. New validator cases accept truthful dirty or clean source identities; the final runner validator step captured all 13 tests. No functional source changes followed the successful full runner.

The original 24 required gates remain; identified E–G scope adds three source proof gates plus actual-account and signed-installed native controls gates. The latter two are not-run. The validator accepts both historical and new records and intentionally returns exit **2** for the new `--decision` because **16 required external gates** remain open: four real runtime lifecycles, four installed lifecycles, actual simultaneous native accounts, actual 16-pair handoff, native policy/extensions, redistribution, selected installed platform, manual descendant cleanup, and actual-account/installed parity controls.

Conversation rollback remains unsupported for selected legacy history, upstream plugin APIs remain unavailable, and MCP OAuth/elicitation/new-server editing is outside verified scope. No real key/account reads or paid inference, no global home/config imports, no migrations or fallback SDK were used. Source passes do not close AS03-A/B, live/native enforcement/distribution/process acceptance or the full roadmap.
