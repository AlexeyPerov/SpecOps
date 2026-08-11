/**
 * Runtime capability vocabulary (phase B domain).
 *
 * Capabilities describe optional features an adapter/runtime supports. The
 * mandatory session core (create/resume/send/stream/cancel) is always
 * available; everything else is advertised here so common UI can show, hide,
 * or explain actions without referencing vendor concepts. New capabilities
 * may be added without breaking stored sessions (they default to "absent").
 */

export type AgentCapability =
  | "permissions"
  | "questions"
  | "fork"
  | "rewind"
  | "checkpoint"
  | "share"
  | "summarize"
  | "nativeTodos"
  | "nativePlans"
  | "mcp"
  | "skills"
  | "commands"
  | "hooks"
  | "subagents"
  | "providerManagement"
  | "modelManagement"
  | "cloudExecution"
  | "costReporting"
  | "rateLimitReporting";

/** Open capability union: adapters may surface runtime-specific capabilities not yet standardized here. */
export type AgentCapabilityValue = AgentCapability | (string & {});

const KNOWN_CAPABILITY_SET: ReadonlySet<string> = new Set<AgentCapability>([
  "permissions",
  "questions",
  "fork",
  "rewind",
  "checkpoint",
  "share",
  "summarize",
  "nativeTodos",
  "nativePlans",
  "mcp",
  "skills",
  "commands",
  "hooks",
  "subagents",
  "providerManagement",
  "modelManagement",
  "cloudExecution",
  "costReporting",
  "rateLimitReporting",
]);

export function normalizeCapabilities(values: readonly unknown[]): AgentCapabilityValue[] {
  const seen = new Set<string>();
  const out: AgentCapabilityValue[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed as AgentCapabilityValue);
  }
  return out;
}

export function isKnownCapability(value: string): value is AgentCapability {
  return KNOWN_CAPABILITY_SET.has(value);
}

export function hasCapability(
  capabilities: readonly AgentCapabilityValue[],
  capability: AgentCapability,
): boolean {
  return capabilities.includes(capability);
}
