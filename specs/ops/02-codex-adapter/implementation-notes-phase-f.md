# AS02-F implementation and finite ecosystem support

**Updated:** 2026-10-05 16:41 MSK
**Source:** Codex CLI 0.160.0 app-server; explicit selected-profile experimental opt-in.
**Disposition:** Source verified. Actual authenticated/installed acceptance remains open; historical release evidence unchanged.

## Native authority and ledger

The isolated exact executable generated **264 TypeScript / 65 schema contracts**. Actual private no-account config probes accepted file-only native MCP credentials, canonical private user config, versioned writes/read-after-write and stale-version rejection. No provider inference or global account/config access occurred. Documentation: [official app-server](https://learn.chatgpt.com/docs/app-server), [native configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). Plugin APIs are explicitly under development upstream and not called by production clients.

| Surface | Native execution | Common UI | Boundary |
| --- | --- | --- | --- |
| Skills | `skills/list`, `skills/config/write` | Catalog and enable/disable dropdown | Validated selected-workspace repo or private-home user paths only; system/admin/outside paths read only. Re-scan validates original path/name/scope/state; native skill API has no CAS version |
| MCP inventory | `mcpServerStatus/list` with original native thread | Bounded observed connection/auth state, safe tool descriptions, resource names/counts | No endpoints, raw schemas, resource URIs/content, environment, headers or errors exported |
| Existing tool server control | Private `mcp_servers.<validated name>.enabled` CAS, `config/mcpServer/reload` | Select profile-owned server, Connect/Disconnect, Refresh | Disabled configuration entries remain selectable when absent from current-thread inventory. Reload acknowledgment is not connection success; observe native status after Refresh. Managed/plugin entries are read only |
| Effective configuration | `config/read` selected cwd; private user-layer version | Web-search, reasoning-summary and verbosity finite choices | Native profile file only; session model/effort/mode/sandbox/approval stay frozen. Use a new session for updated defaults. Native overrides can cause visible failure |
| MCP credentials | Forced `mcp_oauth_credentials_store=file` at every launch and new private config | No raw credentials | Known `.credentials.json` is bounded/nofollow and private; recognized snake-case token fields plus native login secrets and user-config env/header/token values mask echoed descriptions/keys before truncation. Actual OAuth storage/lifecycle acceptance remains open |
| OAuth/elicitation | Unknown callbacks fail closed | Explicit unavailable scope | No login/challenge URL or automatic consent/form reply |
| Plugins | Upstream production restriction | Explicit unavailable capability/scope | List/read/install/uninstall issue zero native RPC; no synthetic installed catalog |
| Arbitrary config/server editor | Unavailable | No raw editor | No user paths/keyPaths/URLs/shell payloads passed to native APIs |

## Lifecycle, ownership and storage

Mutation profile reservation occurs synchronously before the first await. Active turns in the profile block configuration writes. Catalog targets are opaque host tokens, bounded and expiring, tied to profile/thread, actual transport instance, auth attempt/principal and native generation. Numeric generation reuse after process replacement cannot restore old permissions. Invalid value/action/target fails before native mutation. Profile configuration is secured again at dispatch; symlink/nonregular config/credential files fail closed.

Native user-layer version is re-read and compared to the inspection version, then passed as `expectedVersion` to the private canonical `config/value/write`. Tokens are consumed before writing. A rejected, overridden or lost acknowledgment requires explicit refresh; nothing automatically retries. Native profile writes persist independently of transcript cache or local session index. Source history/binding is untouched; no local message rewrite or file watcher notification occurs.

Bounds include 256 skills, eight MCP pages of 32 servers, 256 tools/resources/templates per server, bounded projected metadata, 600 rows, 128 config layers, five-minute catalog expiry and 2048 host targets. Credential collection has bounded counts/depth/bytes and masks exact values before static projection truncation. Unsupported or over-limit native state is unavailable, not silently partial success. Private opaque cursors, paths, config versions and credentials stay host-side.

## Verification

- Full serial host suite: **328 passed / 7 optional skipped**, 24 passed files and 2 optional skipped files; no authenticated/paid smoke run.
- Production dispatcher/client/service/persistence and native extension panel/service suites: **42 passed**, three files.
- Host and frontend type checks: pass; Svelte **0 errors / 0 warnings**.
- Exact native generation and isolated no-account config/read-write CAS probe: pass. Native OAuth file-store override accepted; stale version rejected.
- Final focused host action/ecosystem/bootstrap/dispatcher suite: **61 passed**, four files; final ecosystem rerun **8 passed**. Host/frontend production builds pass; frontend keeps an existing handoff-dialog PURE annotation warning. `git diff --check` passes.

Meaningful cases cover selected profile A/B, private native persisted settings through fresh resume, disabled-server reconnect, ignored/raw secret metadata, custom env/header/OAuth token canaries, forged targets/values, changed versions, process/auth replacement, active-turn blocking, symlink config zero writes, lost acknowledgment token consumption, bounded pagination and UI failed-write control invalidation.

Initial focused fixture runs exposed a missing fixture persistence file and an assertion's status casing after disabled-server merge; both were corrected. Actual native probe exposed canonical `/var` to `/private/var` file paths; host now uses native-compatible canonical private homes. These source fixes do not turn external acceptance into a pass.

## Remaining work

Detailed subagent/context rendering and the expanded complete source regression/release submission belong to AS02-G. Actual account/provider/MCP enforcement, OAuth/elicitation, signed installed/platform/redistribution and process cleanup gates remain open. Release recommendation stays blocked.
