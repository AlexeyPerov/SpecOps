/**
 * Runtime-neutral runtime identity (phase B domain, extended in phase C).
 *
 * A runtime is the external coding-agent process an adapter drives (Claude,
 * Codex, OpenCode, Cursor). SpecOps never imports vendor SDKs into the
 * WebView; runtime descriptors here carry only stable identity + display
 * metadata — no types, classes, or process handles from any vendor SDK.
 *
 * Phase C adds the deterministic `fake` runtime so the foundation fake adapter
 * can flow through the same domain end to end. It is dev/test infrastructure,
 * never a product delivery runtime; the delivery order is preserved separately
 * in {@link PRODUCT_RUNTIME_IDS}.
 */

/**
 * Product runtimes in their initial delivery order (Claude → Codex → OpenCode →
 * Cursor). The deterministic `fake` runtime is intentionally excluded — it is
 * foundation dev/test infrastructure, not a shipped runtime.
 */
export const PRODUCT_RUNTIME_IDS = [
  "claude",
  "codex",
  "opencode",
  "cursor",
] as const satisfies readonly string[];

/**
 * All valid runtime ids, including the deterministic `fake` runtime used by the
 * foundation fake adapter (phase C). Stored sessions may carry any of these.
 */
export const AGENT_RUNTIME_IDS = [
  ...PRODUCT_RUNTIME_IDS,
  "fake",
] as const satisfies readonly string[];

export type AgentRuntimeId = (typeof AGENT_RUNTIME_IDS)[number];

/** Runtime ids that represent real vendor runtimes (excludes the dev `fake`). */
export type ProductRuntimeId = (typeof PRODUCT_RUNTIME_IDS)[number];

export interface AgentRuntimeDescriptor {
  /** Stable runtime identity (serialized and matched against adapters). */
  readonly id: AgentRuntimeId;
  /** User-visible runtime label. */
  readonly label: string;
  /** True for real vendor runtimes; false for the deterministic dev fake. */
  readonly dev?: boolean;
}

const RUNTIME_DESCRIPTORS: Readonly<Record<AgentRuntimeId, AgentRuntimeDescriptor>> = {
  claude: { id: "claude", label: "Claude" },
  codex: { id: "codex", label: "Codex" },
  opencode: { id: "opencode", label: "OpenCode" },
  cursor: { id: "cursor", label: "Cursor" },
  fake: { id: "fake", label: "Fake Runtime", dev: true },
};

const RUNTIME_ID_SET: ReadonlySet<string> = new Set(AGENT_RUNTIME_IDS);

export function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return typeof value === "string" && RUNTIME_ID_SET.has(value);
}

/** True for one of the four product (vendor) runtime ids. */
export function isProductRuntimeId(value: unknown): value is ProductRuntimeId {
  return typeof value === "string" && (PRODUCT_RUNTIME_IDS as readonly string[]).includes(value);
}

export function agentRuntimeDescriptor(id: AgentRuntimeId): AgentRuntimeDescriptor {
  return RUNTIME_DESCRIPTORS[id];
}

export function allAgentRuntimeDescriptors(): readonly AgentRuntimeDescriptor[] {
  return AGENT_RUNTIME_IDS.map((id) => RUNTIME_DESCRIPTORS[id]);
}

/** Product runtime descriptors only (excludes the dev fake). */
export function productRuntimeDescriptors(): readonly AgentRuntimeDescriptor[] {
  return PRODUCT_RUNTIME_IDS.map((id) => RUNTIME_DESCRIPTORS[id]);
}
