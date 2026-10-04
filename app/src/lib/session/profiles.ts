export interface ProfileLimitSnapshot {
  id: string; name?: string;
  primary?: { usedPercent: number; windowDurationMins?: number; resetsAt?: number };
  secondary?: { usedPercent: number; windowDurationMins?: number; resetsAt?: number };
  spendControlReached?: boolean; reachedType?: string;
}
export interface ProfileUsageSnapshot {
  accountId?: string;
  limits: Readonly<Record<string, ProfileLimitSnapshot>>;
  ordinaryUsageAllowed?: boolean;
  updatedAt: string;
}
/** Nonsecret control-plane snapshot. Auth material remains in the host-owned profile home. */
export interface ConnectionProfileSnapshot {
  id: string;
  runtimeId: 'codex' | 'opencode' | 'claude' | 'cursor';
  label: string;
  createdAt: string;
  experimental?: boolean;
  hostGeneration?: number;
  generation: number;
  state: 'missing-profile' | 'disconnected' | 'connecting' | 'auth-required' | 'login-pending' | 'authenticated' | 'missing-runtime' | 'incompatible-runtime' | 'error';
  account?: { type: 'apiKey' | 'chatgpt'; email?: string; planType?: string };
  usage?: ProfileUsageSnapshot;
  recovery?: 'auth-required' | 'quota' | 'offline' | 'retry';
  loginId?: string;
  message?: string;
  support: { browser: boolean; device: boolean; apiKey: boolean };
}
export interface ProfileAuthUpdate {
  runtimeId: 'codex' | 'opencode' | 'claude' | 'cursor';
  connectionProfileId: string;
  hostGeneration?: number;
  generation: number;
  profile: ConnectionProfileSnapshot;
}
export function nativeRoutingKey(runtimeId: string, profileId: string | undefined, nativeSessionId: string): string {
  return JSON.stringify([runtimeId, profileId ?? null, nativeSessionId]);
}

/** Child counters restart at one when the supervised host is replaced. */
export function isNewerProfileSnapshot(current: ConnectionProfileSnapshot, incoming: ConnectionProfileSnapshot): boolean {
  const previousEpoch = current.hostGeneration ?? 0; const nextEpoch = incoming.hostGeneration ?? 0;
  return nextEpoch > previousEpoch || (nextEpoch === previousEpoch && incoming.generation >= current.generation);
}
