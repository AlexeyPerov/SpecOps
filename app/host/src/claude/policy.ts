import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfigurationSchema } from "../../../src/lib/session/adapter/extensions";
const modes = ["default", "acceptEdits", "plan", "dontAsk"] as const;
export const claudeToolNames = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "NotebookEdit", "WebFetch", "WebSearch", "TodoWrite", "Agent", "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "TaskStop"] as const;
const toolSets = ["native", "none"] as const;
/** Native approval controls are not filesystem isolation. No policy promises read-only access. */
export function claudePolicy(values: Readonly<Record<string, unknown>> = {}) {
  const keys = ["permissionMode", "toolSet", "allowedTools", "disallowedTools", "maxTurns", "maxBudgetUsd", "configScope", "workspaceRootPath", "writeCapability"];
  if (Object.keys(values).some(key => !keys.includes(key))) throw new Error("Unsupported native session setting");
  const permissionMode = values.permissionMode ?? "default";
  const toolSet = values.toolSet ?? "native";
  if (!modes.includes(permissionMode as any) || !toolSets.includes(toolSet as any)) throw new Error("Unsupported native tool or approval policy");
  if (values.configScope !== undefined && values.configScope !== "isolated") throw new Error("Only isolated native configuration is supported");
  const list = (value: unknown): string[] => {
    if (value === undefined || value === "") return [];
    if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid native tool list");
    const entries = value.split(",").map(x => x.trim());
    if (entries.length > 64 || entries.some(x => !claudeToolNames.includes(x as any)) || new Set(entries).size !== entries.length) throw new Error("Use unique native tool names separated by commas");
    return entries;
  };
  const allowedTools = list(values.allowedTools), disallowedTools = list(values.disallowedTools);
  if (allowedTools.some(x => disallowedTools.includes(x)) || (toolSet === "none" && (allowedTools.length || disallowedTools.length))) throw new Error("Conflicting native tool policies");
  const maxTurns = values.maxTurns ?? 50;
  const maxBudgetUsd = values.maxBudgetUsd;
  if (typeof maxTurns !== "number" || !Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 1000) throw new Error("Native turn limit must be an integer from 1 to 1000");
  if (maxBudgetUsd !== undefined && (typeof maxBudgetUsd !== "number" || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0 || maxBudgetUsd > 10000)) throw new Error("Native budget must be greater than zero and at most 10000 USD");
  if (values.writeCapability !== undefined && values.writeCapability !== "unknown" && values.writeCapability !== "possible") throw new Error("Native approval modes do not enforce a read-only sandbox");
  return { permissionMode: permissionMode as typeof modes[number], toolSet: toolSet as typeof toolSets[number], allowedTools: allowedTools.join(","), disallowedTools: disallowedTools.join(","), maxTurns, ...(maxBudgetUsd === undefined ? {} : {maxBudgetUsd}), configScope: "isolated", writeCapability: toolSet === "native" ? "possible" : "unknown" };
}
export function claudeQueryPolicy(values: Readonly<Record<string, unknown>>): Partial<Options> {
  const p = claudePolicy(values);
  return { permissionMode: p.permissionMode, tools: p.toolSet === "none" ? [] : { type: "preset", preset: "claude_code" }, allowedTools: p.allowedTools ? p.allowedTools.split(",") : [], disallowedTools: p.disallowedTools ? p.disallowedTools.split(",") : [], maxTurns: p.maxTurns, ...(p.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: p.maxBudgetUsd }), settingSources: [], strictMcpConfig: true, mcpServers: {}, skills: [] };
}
export const claudeConfiguration: SessionConfigurationSchema = {
  schemaVersion: 1, scope: "session",
  description: "Immutable native controls. Approval is not a filesystem sandbox. User/project/local setting sources are disabled; native managed policy can still apply. No selected MCP servers or skills; external configuration editing is unavailable. Tool allow rules may skip prompts; budget limits spending per query, not the account.",
  fields: [
    { id: "permissionMode", label: "Approval", kind: "select", options: modes, default: "default", description: "Native default prompts; acceptEdits approves edits; plan follows native planning policy; dontAsk denies unapproved actions. None guarantees read-only access." },
    { id: "toolSet", label: "Tools", kind: "select", options: toolSets, default: "native" },
    { id: "allowedTools", label: "Allow tools", kind: "string", default: "", description: `Supported names: ${claudeToolNames.join(", ")}. Native allow rules may skip approval prompts.` },
    { id: "disallowedTools", label: "Deny tools", kind: "string", default: "", description: "Comma-separated native tool names; not a filesystem sandbox." },
    { id: "maxTurns", label: "Turn limit", kind: "number", default: 50 },
    { id: "maxBudgetUsd", label: "Budget USD", kind: "number", description: "Optional native spend limit for each query; greater than zero." },
    { id: "configScope", label: "Config", kind: "select", options: ["isolated"], default: "isolated" },
  ],
};
