/**
 * Runtime-neutral runtime identity (phase B domain).
 *
 * A runtime is the external coding-agent process an adapter drives (Claude,
 * Codex, OpenCode, Cursor). SpecOps never imports vendor SDKs into the
 * WebView; runtime descriptors here carry only stable identity + display
 * metadata — no types, classes, or process handles from any vendor SDK.
 */

export const AGENT_RUNTIME_IDS = [
  "claude",
  "codex",
  "opencode",
  "cursor",
] as const satisfies readonly string[];

export type AgentRuntimeId = (typeof AGENT_RUNTIME_IDS)[number];

export interface AgentRuntimeDescriptor {
  /** Stable runtime identity (serialized and matched against adapters). */
  readonly id: AgentRuntimeId;
  /** User-visible runtime label. */
  readonly label: string;
}

const RUNTIME_DESCRIPTORS: Readonly<Record<AgentRuntimeId, AgentRuntimeDescriptor>> = {
  claude: { id: "claude", label: "Claude" },
  codex: { id: "codex", label: "Codex" },
  opencode: { id: "opencode", label: "OpenCode" },
  cursor: { id: "cursor", label: "Cursor" },
};

const RUNTIME_ID_SET: ReadonlySet<string> = new Set(AGENT_RUNTIME_IDS);

export function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return typeof value === "string" && RUNTIME_ID_SET.has(value);
}

export function agentRuntimeDescriptor(id: AgentRuntimeId): AgentRuntimeDescriptor {
  return RUNTIME_DESCRIPTORS[id];
}

export function allAgentRuntimeDescriptors(): readonly AgentRuntimeDescriptor[] {
  return AGENT_RUNTIME_IDS.map((id) => RUNTIME_DESCRIPTORS[id]);
}
