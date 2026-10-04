import type { AgentHostStatus } from '../session/host/agentHostClient';
import type { AdapterHealth } from '../session/adapter';
import type { ConnectionProfileSnapshot } from '../session/profiles';
/** A bounded allowlist: never serialize native homes, account URLs or tool output. */
export function sessionSupportSnapshot(host: AgentHostStatus, native?: AdapterHealth, profile?: ConnectionProfileSnapshot): string {
  const bounded = (value: string | null | undefined) => value?.slice(0, 128);
  return JSON.stringify({ host: { version: bounded(host.hostVersion), protocol: host.protocolVersion, generation: host.generation, health: host.health, restartCount: host.restartCount, errorKind: host.lastError?.kind }, runtime: native ? { id: native.runtimeId, version: bounded(native.runtimeVersion), health: native.status, generation: native.generation } : undefined, profile: profile ? { id: bounded(profile.id), runtime: profile.runtimeId, generation: profile.generation, state: profile.state, authCategory: profile.account?.type, recovery: profile.recovery } : undefined }, null, 2);
}
