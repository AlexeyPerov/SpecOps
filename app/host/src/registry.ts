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

  register(adapter: AgentRuntimeAdapter): void {
    this.adapters.set(adapter.runtimeId, adapter);
  }

  get(runtimeId: string): AgentRuntimeAdapter | undefined {
    return isAgentRuntimeId(runtimeId) ? this.adapters.get(runtimeId) : undefined;
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

  async descriptors(): Promise<AgentRuntimeDescriptor[]> {
    const entries = await Promise.all(this.list().map((adapter) => adapter.describe()));
    return entries;
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
