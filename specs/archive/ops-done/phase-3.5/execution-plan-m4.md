# Phase 3.5 Milestone 4 Execution Plan — Configuration management

**Spec:** [phase-3.5.md](./phase-3.5.md)
**Index:** [execution-plan.md](./execution-plan.md)
**Prerequisite:** [execution-plan-m0.md](./execution-plan-m0.md) M0-T1/T2

**Goal:** visual editors for OpenCode config, providers, MCP, agents,
permissions. This is the "better than OpenCode" differentiator.

Full visual editor for all major config sections plus raw JSON tab (see
[questions.md Q5, Q6](./questions.md)).

---

## Tasks

- [x] **M4-T1 — OpenCode config panel.** New settings tab under Workspaces.
  Read `config.get`, edit via `config.update`. Sections: model / small_model /
  default_agent / username / share / autoupdate / snapshot / compaction /
  tool_output / instructions / experimental. Form-based with JSON fallback for
  unknown keys.
  - Files: new `settings/OpenCodeConfigPanel.svelte`;
  new `ai/backends/opencodeConfig.ts`.

- [x] **M4-T2 — Provider management panel.** List providers (`provider.list`).
  For each: show name, auth status, model count. "Connect" button: set API key
  via `provider.auth` or start OAuth flow (`provider.oauth.authorize` +
  callback). Enable / disable via config. Model whitelist / blacklist editor.
  - Files: new `settings/ProviderManagementPanel.svelte`;
  update `ai/backends/opencodeConfig.ts`.

- [x] **M4-T3 — MCP server management panel.** List MCP servers (`mcp.status`).
  Add local (stdio): name, command, args, env, timeout. Add remote (HTTP/SSE):
  name, URL, headers, OAuth config. Connect / disconnect. Show tools /
  resources contributed by each MCP.
  - Files: new `settings/McpManagementPanel.svelte`;
  new `ai/backends/opencodeMcp.ts`.

- [x] **M4-T4 — Agent management panel.** List all agents (built-in + custom).
  For each: show name, mode, model, description, permission summary. Create
  custom agent: form with name, prompt (markdown editor), model, mode,
  description, steps, permission rules. Edit / delete custom agents. Writes to
  `opencode.json` `agent:` key via `config.update`.
  - Files: new `settings/AgentManagementPanel.svelte`;
  new `AgentEditorDialog.svelte`.

- [x] **M4-T5 — Permission rules editor.** Visual editor for the `permission:`
  config object. Per-tool rows (bash, edit, read, glob, grep, list, webfetch,
  websearch, etc.). Each row: action (allow/deny/ask) + glob patterns. Add /
  remove rows. Writes via `config.update`.
  - Files: new `settings/PermissionRulesPanel.svelte`.

- [x] **M4-T6 — Slash command management.** List config-defined commands
  (`command.list`). Create / edit: name, description, agent, model, template
  (markdown editor). Writes to `opencode.json` `command:` key.
  - Files: new `settings/CommandManagementPanel.svelte`.

- [x] **M4-T7 — Instructions & skills management.** View `instructions:` file
  list; add / remove paths. View `skills:` paths; add / remove. View
  auto-discovered `.opencode/agent/*.md` and `.opencode/command/*.md` files
  (read-only, with "open in editor" action).
  - Files: new `settings/InstructionsPanel.svelte`.

- [x] **M4-T8 — Config preview / raw JSON.** In the OpenCode config panel, add
  a "Raw JSON" tab that shows the current config as formatted JSON with
  syntax-highlighted editing. Syncs with form fields bidirectionally.
  - Files: extend `OpenCodeConfigPanel.svelte`.

- [x] **M4-T9 — Tests.** Config round-trip (form → config.update → config.get),
  provider auth flow mock, MCP add/connect lifecycle, agent create/edit/delete,
  permission rule serialization.
