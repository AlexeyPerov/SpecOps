# AS05-C — native interaction and policy source evidence

Updated: 2026-10-04 21:58 MSK. SDK 0.3.289 / native executable 2.1.289.

AS05-C-01 through -04 source scope is implemented. Native turns now default enabled for an authenticated selected API key profile; an explicit embedding/test disable switch remains. This is source acceptance, not installed/live/account or release acceptance. AS05-D owns those remaining gates.

## Pinned contracts and actual evidence

- Distributed `sdk.d.ts`: `CanUseTool` supplies native request/tool IDs, cancellation signal, native permission suggestions and suppression flags; allow results return original native input and optionally native permission updates. `OnUserDialog` requires opt-in declared kinds and unknown kinds must return cancelled. No dialog kind has a matched payload renderer here, so the declaration is empty and the callback cancels. The actual distributed SDK dispatcher was inspected and exercised over a deterministic child-process control wire: native `can_use_tool` maps to the callback, the normalized permission is answered, and the SDK writes the matching native response. An unknown `request_user_dialog` returns cancelled through that same real SDK. The wire child is a protocol fixture, not a real provider/native inference acceptance claim.
- Official [user-input documentation](https://code.claude.com/docs/en/agent-sdk/user-input) confirms `AskUserQuestion` through `canUseTool`, original questions plus an answer record, and comma-joined labels for multiple selections. Up to four questions are presented sequentially using the common prompt. Single/multiple selections, option descriptions and free text are displayed; optional native previews are explainably unavailable and never executed as HTML. Prototype-like question text remains an own answer-record key.
- Distributed `sdk.d.ts` Options / `sdk-tools.d.ts` ToolInputSchemas pin native approval modes, preset/empty built-in tools, allowed/disallowed tools, maxTurns, maxBudgetUsd, settingSources, strictMcpConfig and skills filters. The adapter exposes a finite supported built-in name subset. Unknown names, arbitrary rule syntax, conflicting allow/deny sets, empty-tool conflicts, unsafe approval modes, invalid/nonfinite limits and unknown configuration are rejected before native initialization/dispatch. Native managed policy can further restrict behavior; allow rules may resolve before the permission callback. The host does not claim every tool traverses the callback.
- Source filesystem setting scope is `settingSources: []`: user/project/local sources are excluded. The pinned contract requires project source to load project instruction files. This is not an assertion that all native managed instructions, managed policy or memory are suppressed. Strict empty selected MCP configuration and an empty skill filter are explicit. No global profile/workspace settings file is written.
- Real Darwin arm64 bundled native control create/history probe passed with C options, without account credentials or inference. It used a deliberately non-live placeholder and fixture auth verifier. It confirms option intake/control initialization and reserved UUID/history behavior, not paid tool enforcement or callback generation by a provider.

## Interaction guarantees

A callback lives in one selected profile/native session/turn/generation. UI IDs are opaque unique epoch-qualified handles and every reply validates the native binding and active turn. Duplicate/wrong-kind/profile/turn/generation replies cannot approve another callback. Native request IDs are deduplicated, capacity is finite, and unsupported/overcapacity interactions are denied.

Once allow returns original native input. Session approval is available only for a finite set of native `addRules` suggestions whose destination is exactly session, behavior allow, tool exactly matches and nonempty rule scope is present. The original scope is copied, redacted and displayed before choice. No user/project/local/CLI persisted rules, mode changes, broad whole-tool empty rules or directory grants are converted into approval. Suppression removes the choice. Generic permission UI now displays the native operation and rule scope and hides unavailable session approval.

Manual rejection/answer finishes the common prompt. Native callback cancellation, callback deadline, Stop, reconnect, logout or process failure resolves pending handles once and ends the affected turn; deadline/callback cancellation fail closed and retire owned native work. Terminal events close stale prompts through the production pipeline. Reconnect excludes ended turns from its active-read shortcut, increments the profile generation and interrupts pending callbacks. Resume never represents an old callback as surviving a process restart and never resends a prompt.

The mapper remains bounded and redacts exact credential canaries in callback metadata, diagnostics and persisted events. No permission/tool input is rewritten as a natural-language prompt. Existing profile environment, credential digest, native history, process birth stamps, late query closure, cumulative cost delta and immutable binding guards remain authoritative.

## Native feature ledger

| Feature | Native execution in selected scope | Common display | Editing/action |
| --- | --- | --- | --- |
| Models | Explicit selected discovered native model | Common catalog | Before native session creation; immutable afterward |
| Approval/tools/turn limit/budget | Validated native Options | Neutral select/string/number descriptors | Session creation only; budget per query, not account cap |
| File writes | Native preset may write; approval/planning is not a sandbox | Possible writer, or unknown for empty tools | No synthetic read-only control |
| Permission/questions | Native callbacks, correlated once resolution | Common operation scope and sequential single/multiple/free text questions | Allow/deny/safe session rules/answer/reject; deadlines interrupt |
| User dialogs / previews | Unsupported kinds cancelled; no kind declared | Preview limitation explained in question UI | No unknown renderer or executable HTML |
| Workspace/profile instructions and settings | Filesystem setting sources excluded; managed policy/memory may still apply | Isolated scope and qualification in descriptors | No configuration loader/editor; additional scope requires separate validated extension |
| MCP | Strict empty selected SDK configuration | Capability explains absent surface | No catalog/server editing/reconnect action |
| Skills | Empty native skill filter | Capability explains absent surface | No skill catalog/editor/reload action |
| Hooks/plugins | No configurable SDK hooks/plugins selected; managed policy qualification applies | Capability explains limitation | No hook/plugin editor or SDK hook injection |
| Subagents | Native built-in Agent tool can remain part of the native preset | Existing tool events; unrecognized native events remain bounded diagnostics | No dedicated subagent catalog/policy/progress editor advertised |
| Commands | Native session behavior remains native; no command API exposed | No command catalog | No slash-command action wrapper |
| Lifecycle | Scoped Stop/interrupt retires query and owner; selected-profile reconnect retires callbacks | Terminal activity and auth generation | Explicit resume; no old approval replay |
| Fork/checkpoints/share | Not selected or advertised | Hidden | No no-op actions |

## Verification and remaining gates

- Full host suite: 205 passed, 4 explicit opt-in skips; focused final C/core/wire: 43 passed, one native opt-in skip. Capability/wire follow-up after prototype-key and unknown-dialog fixes: 12 passed. Common prompt/writer follow-up: 10 passed.
- Focused frontend common prompts, writer states, production pipeline and divergent/corrupt native cache persistence: 34 passed. Neutral number/string values and optional budget removal are typed; single/multiple selection and free text preserve answer labels.
- Host/frontend type checks and production builds passed; real control create/history probe: 1 passed. No real key, model call, subscription entitlement or invoice was used.
- Native accepted inference with real permissions/questions, native policy enforcement/budget behavior, managed policy/memory scope, real account separation, signed installed asset/legal acceptance, supported platform cleanup and the unobserved immediate descendant-exit race remain open. No release claim follows from fixture or control-only evidence.

AS05-D should preserve this finite manifest, run installed/live acceptance only with supplied authorization/evidence, exercise process faults/coexistence and publish recovery/support boundaries. Extra config/MCP/skill/hook/subagent surfaces require their own matched native contract and bounded profile-owned implementation; they are not silently enabled by this phase. No persisted-data migration or compatibility shim was added.
