import { staticRuntimeDiscovery } from "../../src/lib/session/runtime";
import { agentRuntimeDescriptor } from "../../src/lib/session/runtime";
/**
 * Adapter registry (phase D, task AS01-D-01).
 *
 * Maps a runtime id to its adapter. The host registers the deterministic fake
 * adapter by default so it is drivable end-to-end without a vendor runtime;
 * phase 02–05 add real adapters here. Discovery + health aggregate across the
 * registered runtimes.
 */

import type { AgentRuntimeAdapter, AdapterHealth } from "../../src/lib/session/adapter";
import type { AgentRuntimeDescriptor } from "../../src/lib/session/runtime";
import type { AgentRuntimeId } from "../../src/lib/session/runtime";
import { isAgentRuntimeId } from "../../src/lib/session";

export class AdapterRegistry {
  private readonly adapters = new Map<AgentRuntimeId, AgentRuntimeAdapter>();

  private readonly factories = new Map<AgentRuntimeId, () => Promise<AgentRuntimeAdapter>>();
  private readonly activations = new Map<AgentRuntimeId, Promise<void>>();
  onActivate: (adapter: AgentRuntimeAdapter) => void = () => {};
  registerLazy(id: AgentRuntimeId, factory: () => Promise<AgentRuntimeAdapter>): void { this.factories.set(id, factory); }

  register(adapter: AgentRuntimeAdapter): void {
    this.adapters.set(adapter.runtimeId, adapter);
  }

  async activate(runtimeId: string): Promise<void> {
    if (!isAgentRuntimeId(runtimeId) || this.adapters.has(runtimeId)) return;
    const factory = this.factories.get(runtimeId);
    if (factory) {
      let activation = this.activations.get(runtimeId);
      if (!activation) { activation = factory().then(adapter => { this.register(adapter); this.onActivate(adapter); }).finally(() => this.activations.delete(runtimeId)); this.activations.set(runtimeId, activation); }
      await activation;
    }
  }

  get(runtimeId: string): AgentRuntimeAdapter | undefined {
    if (!isAgentRuntimeId(runtimeId)) return undefined;
    return this.adapters.get(runtimeId);
  }

  require(runtimeId: string): AgentRuntimeAdapter {
    const adapter = this.get(runtimeId);
    if (!adapter) {
      throw new UnknownRuntimeError(runtimeId);
    }
    return adapter;
  }

  list(): readonly AgentRuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  async discovery() {
    const active = await Promise.all(this.list().map(async adapter => ({ ...await adapter.describe(), capabilities: await adapter.describeCapabilities() })));
    return [...active, ...staticRuntimeDiscovery().filter(descriptor => this.factories.has(descriptor.id) && !this.adapters.has(descriptor.id))];
  }

  async descriptors(): Promise<AgentRuntimeDescriptor[]> {
    const entries = await Promise.all(this.list().map((adapter) => adapter.describe()));
    return [...entries, ...[...this.factories.keys()].filter(id => !this.adapters.has(id)).map(id => agentRuntimeDescriptor(id))];
  }

  async health(runtimeId?: string): Promise<AdapterHealth | AdapterHealth[]> {
    if (runtimeId) {
      return this.require(runtimeId).health();
    }
    return Promise.all(this.list().map((adapter) => adapter.health()));
  }
}

export class UnknownRuntimeError extends Error {
  readonly runtimeId: string;
  constructor(runtimeId: string) {
    super(`Unknown runtime: ${runtimeId}`);
    this.name = "UnknownRuntimeError";
    this.runtimeId = runtimeId;
  }
}
