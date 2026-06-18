import type {
  OpencodeAgentConfigEntry,
  OpencodeCommandConfigEntry,
  OpencodeConfigDocument,
  OpencodePermissionConfig,
  OpencodePermissionRule,
} from "./workspaceAgentBackend";

/**
 * Pure helpers for the OpenCode config visual editor (M4). The config document
 * is a loose `Record<string, unknown>` (the OpenCode `Config` schema is large
 * and evolves); these helpers read/write the known top-level keys with typed
 * coercion, leaving everything else untouched so the raw-JSON tab and unknown
 * keys survive a read → mutate → write round-trip.
 *
 * All helpers are pure (no I/O) so they unit-test without a backend.
 */

// ---------------------------------------------------------------------------
// Generic readers (tolerant coercion — nullish / wrong-type → fallback).
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// ---------------------------------------------------------------------------
// Top-level config field accessors.
// ---------------------------------------------------------------------------

export function getConfigModel(doc: OpencodeConfigDocument): string {
  return asStringOrEmpty(doc.model);
}

export function getConfigSmallModel(doc: OpencodeConfigDocument): string {
  return asStringOrEmpty(doc.small_model);
}

export function getConfigDefaultAgent(doc: OpencodeConfigDocument): string {
  return asStringOrEmpty(doc.default_agent);
}

export function getConfigUsername(doc: OpencodeConfigDocument): string {
  return asStringOrEmpty(doc.username);
}

export type ConfigShareMode = "manual" | "auto" | "disabled";

export function getConfigShare(doc: OpencodeConfigDocument): ConfigShareMode {
  const value = doc.share;
  return value === "manual" || value === "auto" || value === "disabled" ? value : "manual";
}

export type ConfigAutoupdate = boolean | "notify";

export function getConfigAutoupdate(doc: OpencodeConfigDocument): ConfigAutoupdate {
  const value = doc.autoupdate;
  if (value === "notify") {
    return "notify";
  }
  return typeof value === "boolean" ? value : true;
}

export function getConfigSnapshot(doc: OpencodeConfigDocument): boolean {
  return asBoolean(doc.snapshot) ?? false;
}

export function getConfigInstructions(doc: OpencodeConfigDocument): string[] {
  return asStringArray(doc.instructions);
}

export interface ConfigSkills {
  paths: string[];
  urls: string[];
}

export function getConfigSkills(doc: OpencodeConfigDocument): ConfigSkills {
  const skills = asObject(doc.skills);
  return {
    paths: skills ? asStringArray(skills.paths) : [],
    urls: skills ? asStringArray(skills.urls) : [],
  };
}

export interface ConfigToolOutput {
  maxLines: number | undefined;
  maxBytes: number | undefined;
}

export function getConfigToolOutput(doc: OpencodeConfigDocument): ConfigToolOutput {
  const toolOutput = asObject(doc.tool_output);
  return {
    maxLines: toolOutput ? asNumber(toolOutput.max_lines) : undefined,
    maxBytes: toolOutput ? asNumber(toolOutput.max_bytes) : undefined,
  };
}

export interface ConfigCompaction {
  auto: boolean;
  prune: boolean;
  tailTurns: number | undefined;
  preserveRecentTokens: number | undefined;
  reserved: number | undefined;
}

export function getConfigCompaction(doc: OpencodeConfigDocument): ConfigCompaction {
  const compaction = asObject(doc.compaction);
  return {
    auto: compaction ? asBoolean(compaction.auto) ?? true : true,
    prune: compaction ? asBoolean(compaction.prune) ?? false : false,
    tailTurns: compaction ? asNumber(compaction.tail_turns) : undefined,
    preserveRecentTokens: compaction ? asNumber(compaction.preserve_recent_tokens) : undefined,
    reserved: compaction ? asNumber(compaction.reserved) : undefined,
  };
}

export interface ConfigExperimental {
  disablePasteSummary: boolean;
  batchTool: boolean;
  openTelemetry: boolean;
  continueLoopOnDeny: boolean;
  primaryTools: string[];
  mcpTimeout: number | undefined;
}

export function getConfigExperimental(doc: OpencodeConfigDocument): ConfigExperimental {
  const experimental = asObject(doc.experimental);
  return {
    disablePasteSummary: experimental ? asBoolean(experimental.disable_paste_summary) ?? false : false,
    batchTool: experimental ? asBoolean(experimental.batch_tool) ?? false : false,
    openTelemetry: experimental ? asBoolean(experimental.openTelemetry) ?? false : false,
    continueLoopOnDeny: experimental ? asBoolean(experimental.continue_loop_on_deny) ?? false : false,
    primaryTools: experimental ? asStringArray(experimental.primary_tools) : [],
    mcpTimeout: experimental ? asNumber(experimental.mcp_timeout) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Field setters — return a NEW document so callers can treat config as
// immutable and only call `config.update` when content actually changed.
// Empty/blank values are omitted so we never persist `model: ""`.
// ---------------------------------------------------------------------------

function withField(
  doc: OpencodeConfigDocument,
  key: string,
  value: unknown,
  omitWhenBlank: boolean,
): OpencodeConfigDocument {
  if (omitWhenBlank && (value === "" || value === null || value === undefined)) {
    if (!(key in doc)) {
      return doc;
    }
    const next = { ...doc };
    delete next[key];
    return next;
  }
  return { ...doc, [key]: value };
}

export function setConfigModel(
  doc: OpencodeConfigDocument,
  value: string,
): OpencodeConfigDocument {
  return withField(doc, "model", value.trim(), true);
}

export function setConfigSmallModel(
  doc: OpencodeConfigDocument,
  value: string,
): OpencodeConfigDocument {
  return withField(doc, "small_model", value.trim(), true);
}

export function setConfigDefaultAgent(
  doc: OpencodeConfigDocument,
  value: string,
): OpencodeConfigDocument {
  return withField(doc, "default_agent", value.trim(), true);
}

export function setConfigUsername(
  doc: OpencodeConfigDocument,
  value: string,
): OpencodeConfigDocument {
  return withField(doc, "username", value.trim(), true);
}

export function setConfigShare(
  doc: OpencodeConfigDocument,
  value: ConfigShareMode,
): OpencodeConfigDocument {
  return { ...doc, share: value };
}

export function setConfigAutoupdate(
  doc: OpencodeConfigDocument,
  value: ConfigAutoupdate,
): OpencodeConfigDocument {
  return { ...doc, autoupdate: value };
}

export function setConfigSnapshot(
  doc: OpencodeConfigDocument,
  value: boolean,
): OpencodeConfigDocument {
  return { ...doc, snapshot: value };
}

export function setConfigInstructions(
  doc: OpencodeConfigDocument,
  paths: string[],
): OpencodeConfigDocument {
  const cleaned = paths.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0) {
    return withField(doc, "instructions", undefined, true);
  }
  return { ...doc, instructions: cleaned };
}

export function setConfigSkills(
  doc: OpencodeConfigDocument,
  skills: ConfigSkills,
): OpencodeConfigDocument {
  const paths = skills.paths.map((p) => p.trim()).filter((p) => p.length > 0);
  const urls = skills.urls.map((u) => u.trim()).filter((u) => u.length > 0);
  if (paths.length === 0 && urls.length === 0) {
    return withField(doc, "skills", undefined, true);
  }
  const next: Record<string, unknown> = {};
  if (paths.length > 0) {
    next.paths = paths;
  }
  if (urls.length > 0) {
    next.urls = urls;
  }
  return { ...doc, skills: next };
}

export function setConfigToolOutput(
  doc: OpencodeConfigDocument,
  toolOutput: ConfigToolOutput,
): OpencodeConfigDocument {
  const next: Record<string, unknown> = {};
  if (toolOutput.maxLines !== undefined) {
    next.max_lines = toolOutput.maxLines;
  }
  if (toolOutput.maxBytes !== undefined) {
    next.max_bytes = toolOutput.maxBytes;
  }
  if (Object.keys(next).length === 0) {
    return withField(doc, "tool_output", undefined, true);
  }
  return { ...doc, tool_output: next };
}

export function setConfigCompaction(
  doc: OpencodeConfigDocument,
  compaction: ConfigCompaction,
): OpencodeConfigDocument {
  const next: Record<string, unknown> = { auto: compaction.auto, prune: compaction.prune };
  if (compaction.tailTurns !== undefined) {
    next.tail_turns = compaction.tailTurns;
  }
  if (compaction.preserveRecentTokens !== undefined) {
    next.preserve_recent_tokens = compaction.preserveRecentTokens;
  }
  if (compaction.reserved !== undefined) {
    next.reserved = compaction.reserved;
  }
  return { ...doc, compaction: next };
}

export function setConfigExperimental(
  doc: OpencodeConfigDocument,
  experimental: ConfigExperimental,
): OpencodeConfigDocument {
  const next: Record<string, unknown> = {
    disable_paste_summary: experimental.disablePasteSummary,
    batch_tool: experimental.batchTool,
    openTelemetry: experimental.openTelemetry,
    continue_loop_on_deny: experimental.continueLoopOnDeny,
  };
  if (experimental.primaryTools.length > 0) {
    next.primary_tools = experimental.primaryTools;
  }
  if (experimental.mcpTimeout !== undefined) {
    next.mcp_timeout = experimental.mcpTimeout;
  }
  return { ...doc, experimental: next };
}

// ---------------------------------------------------------------------------
// `agent:` config key — maps to/from OpencodeAgentConfigEntry (M4-T4).
// ---------------------------------------------------------------------------

/** Reads the `agent:` map as typed entries keyed by agent name. */
export function getConfigAgents(
  doc: OpencodeConfigDocument,
): Record<string, OpencodeAgentConfigEntry> {
  const agents = asObject(doc.agent);
  if (!agents) {
    return {};
  }
  const result: Record<string, OpencodeAgentConfigEntry> = {};
  for (const [name, raw] of Object.entries(agents)) {
    const entry = asObject(raw);
    if (!entry) {
      continue;
    }
    const mapped = mapAgentConfigEntry(entry);
    if (mapped) {
      result[name] = mapped;
    }
  }
  return result;
}

function mapAgentConfigEntry(
  entry: Record<string, unknown>,
): OpencodeAgentConfigEntry | null {
  const mode = entry.mode;
  if (
    mode !== undefined &&
    mode !== "subagent" &&
    mode !== "primary" &&
    mode !== "all"
  ) {
    return null;
  }
  const temperature = asNumber(entry.temperature);
  const topP = typeof entry.topP === "number" ? asNumber(entry.topP) : asNumber(entry.top_p);
  const steps = asNumber(entry.steps);
  const maxSteps = asNumber(entry.max_steps ?? entry.maxSteps ?? entry.maxsteps);
  const tools = asObject(entry.tools);
  const permission = entry.permission;
  const result: OpencodeAgentConfigEntry = {};
  const model = asString(entry.model);
  if (model) {
    result.model = model;
  }
  const variant = asString(entry.variant);
  if (variant) {
    result.variant = variant;
  }
  if (temperature !== undefined) {
    result.temperature = temperature;
  }
  if (topP !== undefined) {
    result.topP = topP;
  }
  const prompt = asString(entry.prompt);
  if (prompt) {
    result.prompt = prompt;
  }
  if (tools) {
    const toolMap: Record<string, boolean> = {};
    for (const [toolName, enabled] of Object.entries(tools)) {
      if (typeof enabled === "boolean") {
        toolMap[toolName] = enabled;
      }
    }
    result.tools = toolMap;
  }
  if (entry.disable !== undefined) {
    result.disable = Boolean(entry.disable);
  }
  const description = asString(entry.description);
  if (description) {
    result.description = description;
  }
  if (mode) {
    result.mode = mode;
  }
  if (entry.hidden !== undefined) {
    result.hidden = Boolean(entry.hidden);
  }
  const color = asString(entry.color);
  if (color) {
    result.color = color;
  }
  if (steps !== undefined) {
    result.steps = steps;
  }
  if (maxSteps !== undefined) {
    result.maxSteps = maxSteps;
  }
  if (permission !== undefined) {
    result.permission = permission as OpencodePermissionConfig;
  }
  return result;
}

/** Converts a typed agent entry back into the raw config shape (snake_case). */
export function agentConfigEntryToRaw(
  entry: OpencodeAgentConfigEntry,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  if (entry.model !== undefined) {
    raw.model = entry.model;
  }
  if (entry.variant !== undefined) {
    raw.variant = entry.variant;
  }
  if (entry.temperature !== undefined) {
    raw.temperature = entry.temperature;
  }
  if (entry.topP !== undefined) {
    raw.top_p = entry.topP;
  }
  if (entry.prompt !== undefined) {
    raw.prompt = entry.prompt;
  }
  if (entry.tools !== undefined) {
    raw.tools = entry.tools;
  }
  if (entry.disable !== undefined) {
    raw.disable = entry.disable;
  }
  if (entry.description !== undefined) {
    raw.description = entry.description;
  }
  if (entry.mode !== undefined) {
    raw.mode = entry.mode;
  }
  if (entry.hidden !== undefined) {
    raw.hidden = entry.hidden;
  }
  if (entry.color !== undefined) {
    raw.color = entry.color;
  }
  if (entry.steps !== undefined) {
    raw.steps = entry.steps;
  }
  if (entry.maxSteps !== undefined) {
    raw.max_steps = entry.maxSteps;
  }
  if (entry.permission !== undefined) {
    raw.permission = entry.permission;
  }
  return raw;
}

/** Upserts an agent into the `agent:` map. */
export function setConfigAgent(
  doc: OpencodeConfigDocument,
  name: string,
  entry: OpencodeAgentConfigEntry,
): OpencodeConfigDocument {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return doc;
  }
  const agents = { ...asObject(doc.agent) };
  agents[trimmedName] = agentConfigEntryToRaw(entry);
  return { ...doc, agent: agents };
}

/** Removes an agent from the `agent:` map. */
export function removeConfigAgent(
  doc: OpencodeConfigDocument,
  name: string,
): OpencodeConfigDocument {
  const agents = asObject(doc.agent);
  if (!agents || !(name in agents)) {
    return doc;
  }
  const next = { ...agents };
  delete next[name];
  // Drop the `agent:` key entirely when empty so we don't persist `{}`.
  if (Object.keys(next).length === 0) {
    const without = { ...doc };
    delete without.agent;
    return without;
  }
  return { ...doc, agent: next };
}

// ---------------------------------------------------------------------------
// `command:` config key — maps to/from OpencodeCommandConfigEntry (M4-T6).
// ---------------------------------------------------------------------------

export function getConfigCommands(
  doc: OpencodeConfigDocument,
): Record<string, OpencodeCommandConfigEntry> {
  const commands = asObject(doc.command);
  if (!commands) {
    return {};
  }
  const result: Record<string, OpencodeCommandConfigEntry> = {};
  for (const [name, raw] of Object.entries(commands)) {
    const entry = asObject(raw);
    if (!entry) {
      continue;
    }
    const template = asString(entry.template);
    if (!template) {
      continue;
    }
    const mapped: OpencodeCommandConfigEntry = { template };
    const description = asString(entry.description);
    if (description) {
      mapped.description = description;
    }
    const agent = asString(entry.agent);
    if (agent) {
      mapped.agent = agent;
    }
    const model = asString(entry.model);
    if (model) {
      mapped.model = model;
    }
    const variant = asString(entry.variant);
    if (variant) {
      mapped.variant = variant;
    }
    if (entry.subtask !== undefined) {
      mapped.subtask = Boolean(entry.subtask);
    }
    result[name] = mapped;
  }
  return result;
}

export function commandConfigEntryToRaw(
  entry: OpencodeCommandConfigEntry,
): Record<string, unknown> {
  const raw: Record<string, unknown> = { template: entry.template };
  if (entry.description !== undefined) {
    raw.description = entry.description;
  }
  if (entry.agent !== undefined) {
    raw.agent = entry.agent;
  }
  if (entry.model !== undefined) {
    raw.model = entry.model;
  }
  if (entry.variant !== undefined) {
    raw.variant = entry.variant;
  }
  if (entry.subtask !== undefined) {
    raw.subtask = entry.subtask;
  }
  return raw;
}

export function setConfigCommand(
  doc: OpencodeConfigDocument,
  name: string,
  entry: OpencodeCommandConfigEntry,
): OpencodeConfigDocument {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return doc;
  }
  const commands = { ...asObject(doc.command) };
  commands[trimmedName] = commandConfigEntryToRaw(entry);
  return { ...doc, command: commands };
}

export function removeConfigCommand(
  doc: OpencodeConfigDocument,
  name: string,
): OpencodeConfigDocument {
  const commands = asObject(doc.command);
  if (!commands || !(name in commands)) {
    return doc;
  }
  const next = { ...commands };
  delete next[name];
  if (Object.keys(next).length === 0) {
    const without = { ...doc };
    delete without.command;
    return without;
  }
  return { ...doc, command: next };
}

// ---------------------------------------------------------------------------
// `permission:` config object — visual ruleset editor (M4-T5).
//
// OpenCode's permission config is polymorphic: a bare action string
// ("allow"/"deny"/"ask") applies to every tool, or a per-tool map where each
// value is either an action string or `{ pattern: action }` object. The visual
// editor works in terms of the `PermissionRule` rows (`{ permission, pattern,
// action }`) that OpenCode's runtime permission ruleset uses. We translate
// between the editor's flat rule list and the per-tool map on write.
// ---------------------------------------------------------------------------

export const PERMISSION_TOOLS = [
  "bash",
  "edit",
  "read",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "task",
  "external_directory",
  "todowrite",
  "question",
  "lsp",
  "skill",
  "doom_loop",
] as const;

export type PermissionTool = (typeof PERMISSION_TOOLS)[number];

export const PERMISSION_ACTIONS = ["allow", "deny", "ask"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** True when the permission config is a bare action string applying to all tools. */
export function isPermissionGlobalAction(
  permission: OpencodePermissionConfig | undefined,
): permission is PermissionAction {
  return (
    permission === "allow" || permission === "deny" || permission === "ask"
  );
}

/**
 * Reads the default action for every tool. When permission is a bare string it
 * applies globally; otherwise each tool falls back to `"ask"`.
 */
export function getGlobalPermissionAction(
  doc: OpencodeConfigDocument,
): PermissionAction {
  const permission = doc.permission as OpencodePermissionConfig | undefined;
  if (isPermissionGlobalAction(permission)) {
    return permission;
  }
  return "ask";
}

/**
 * Extracts the flat rule list from the `permission:` map. Tools whose value is
 * a bare action produce no rows (handled by the global default); tools whose
 * value is a `{ pattern: action }` object produce one row per pattern.
 */
export function getConfigPermissionRules(
  doc: OpencodeConfigDocument,
): OpencodePermissionRule[] {
  const permission = doc.permission as OpencodePermissionConfig | undefined;
  if (isPermissionGlobalAction(permission) || permission === undefined) {
    return [];
  }
  const rules: OpencodePermissionRule[] = [];
  for (const [tool, value] of Object.entries(permission)) {
    const perPattern = asObject(value);
    if (!perPattern) {
      continue;
    }
    for (const [pattern, action] of Object.entries(perPattern)) {
      if (action !== "allow" && action !== "deny" && action !== "ask") {
        continue;
      }
      rules.push({ permission: tool, pattern, action });
    }
  }
  return rules;
}

/**
 * Serializes a flat rule list back into the `permission:` map. Rules are
 * grouped by tool into `{ pattern: action }` objects. An empty rule list
 * returns `undefined` so the key can be dropped.
 */
export function buildPermissionMap(
  rules: readonly OpencodePermissionRule[],
): OpencodePermissionConfig | undefined {
  if (rules.length === 0) {
    return undefined;
  }
  const grouped = new Map<string, Record<string, PermissionAction>>();
  for (const rule of rules) {
    const tool = rule.permission.trim();
    const pattern = rule.pattern.trim();
    if (tool.length === 0 || pattern.length === 0) {
      continue;
    }
    if (rule.action !== "allow" && rule.action !== "deny" && rule.action !== "ask") {
      continue;
    }
    const bucket = grouped.get(tool) ?? {};
    bucket[pattern] = rule.action;
    grouped.set(tool, bucket);
  }
  if (grouped.size === 0) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const [tool, patterns] of grouped) {
    result[tool] = patterns;
  }
  return result;
}

export function setConfigPermission(
  doc: OpencodeConfigDocument,
  permission: OpencodePermissionConfig | undefined,
): OpencodeConfigDocument {
  if (permission === undefined) {
    if (!("permission" in doc)) {
      return doc;
    }
    const next = { ...doc };
    delete next.permission;
    return next;
  }
  return { ...doc, permission };
}

export function addPermissionRule(
  rules: OpencodePermissionRule[],
): OpencodePermissionRule[] {
  return [...rules, { permission: "bash", pattern: "", action: "ask" }];
}

export function updatePermissionRule(
  rules: OpencodePermissionRule[],
  index: number,
  patch: Partial<OpencodePermissionRule>,
): OpencodePermissionRule[] {
  if (index < 0 || index >= rules.length) {
    return rules;
  }
  return rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
}

export function removePermissionRule(
  rules: OpencodePermissionRule[],
  index: number,
): OpencodePermissionRule[] {
  if (index < 0 || index >= rules.length) {
    return rules;
  }
  return rules.filter((_, i) => i !== index);
}

// ---------------------------------------------------------------------------
// Raw JSON serialization helpers (M4-T8).
// ---------------------------------------------------------------------------

/** Pretty-prints the config document as 2-space JSON. */
export function serializeConfigJson(doc: OpencodeConfigDocument): string {
  return JSON.stringify(sortConfigKeys(doc), null, 2);
}

/**
 * Parses a raw JSON string into a config document. Throws on invalid JSON or a
 * non-object top-level value so the caller can surface a parse error.
 */
export function parseConfigJson(raw: string): OpencodeConfigDocument {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Config must be a JSON object.");
  }
  return parsed as OpencodeConfigDocument;
}

/**
 * Sorts config keys for stable pretty-printing. `$schema` stays first if
 * present (matching OpenCode's convention); the rest are alphabetical.
 */
export function sortConfigKeys(
  doc: OpencodeConfigDocument,
): OpencodeConfigDocument {
  const keys = Object.keys(doc).sort();
  const hasSchema = keys.includes("$schema");
  const ordered = hasSchema ? ["$schema", ...keys.filter((k) => k !== "$schema")] : keys;
  const result: OpencodeConfigDocument = {};
  for (const key of ordered) {
    result[key] = doc[key];
  }
  return result;
}
