# Selected source baseline — AS07-B

Recorded: 2026-10-05 00:01 MSK.
Scope: prior selected source subset plus Cursor local durable agent/run lifecycle with minimal no-tool settings.
Recommendation: **Do not release the expanded subset yet.** Prior [AS07-A baseline](baseline-07-a.md) gates remain open.

| Gate | Actual evidence |
| --- | --- |
| Profile-bound durable native agents/runs | Source shared lifecycle fixtures pass; original credential/canonical workspace/model/settings checked against private binding and native SDK metadata; actual account-free SDK JSONL create/resume/store wire history pass |
| Native stream/history/cancel/fault | B maps bounded native events, drains stream and waits sole terminal, disposes late work, preserves missing history, refuses duplicate/ambiguous dispatch; production divergent/corrupt cache recovery passes |
| Common secret boundary | Exact/generic split text, tool/object/identity/history envelopes, static native failures and suppressed worker stdout/stderr verified with synthetic canaries |
| Copied native operation assets | Session worker retained in verified payload; outside-checkout copied Node/SDK/assets account-free create/resume pass on Darwin arm64, Node 24.15.0 |
| Checks/builds | Host/frontend type checks, Svelte 0 errors/0 warnings, host/frontend production builds pass; focused Cursor bootstrap/core 40 pass; focused frontend persistence/client 28 pass, including 2 Cursor cache cases |
| Broader regression | Initial parallel broad host run: 277 pass/6 skip and one pre-existing Codex observed-orphan retirement assertion failed under load; targeted Codex 20 pass and serial broad host 278 pass/6 skip; no Codex cleanup source changed |
| Actual inference/policy/installed | Open: paid authenticated success/tools/usage/cancel/restart/fault/account variants, C policy/config scope, D signed installed/enforcement acceptance |
| Distribution/platform/cleanup | Open: license/Terms/native notice clearance, signed installed packaging, Linux/Windows durable/process behavior, immediate unobserved descendant exit; inherited experimental native history/account gates |

Evidence: [B implementation notes](../07-cursor-adapter/implementation-notes-phase-b.md). Source progress and copied account-free assets are not release acceptance.
