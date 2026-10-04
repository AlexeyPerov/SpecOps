/** Nonsecret control-plane snapshot. Auth material remains in the host-owned profile home. */
export interface ConnectionProfileSnapshot {
  id: string;
  runtimeId: 'codex';
  label: string;
  createdAt: string;
  generation: number;
  state: 'disconnected' | 'connecting' | 'auth-required' | 'login-pending' | 'authenticated' | 'missing-runtime' | 'incompatible-runtime' | 'error';
  account?: { type: 'apiKey' | 'chatgpt'; email?: string; planType?: string };
  loginId?: string;
  message?: string;
  support: { browser: boolean; device: boolean; apiKey: boolean };
}
export interface ProfileAuthUpdate {
  runtimeId: 'codex';
  connectionProfileId: string;
  generation: number;
  profile: ConnectionProfileSnapshot;
}
export function nativeRoutingKey(runtimeId: string, profileId: string | undefined, nativeSessionId: string): string {
  return JSON.stringify([runtimeId, profileId ?? null, nativeSessionId]);
}
