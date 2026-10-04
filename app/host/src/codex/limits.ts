import type { ProfileUsageSnapshot, ProfileLimitSnapshot } from '../../../src/lib/session/profiles';
import { object } from './transport';

/** Null/absent rolling fields mean unavailable, never a reset or permission to retry. */
export function mergeUsage(previous: ProfileUsageSnapshot | undefined, raw: unknown): ProfileUsageSnapshot {
  if (!object(raw)) throw new Error('Invalid usage snapshot');
  const accountId = typeof raw.accountId === 'string' ? raw.accountId : previous?.accountId;
  if (previous?.accountId && accountId && previous.accountId !== accountId) previous = undefined;
  const limits = { ...previous?.limits };
  const merge = (value: unknown, key?: string) => {
    if (!object(value)) throw new Error('Invalid usage limit');
    const id = typeof value.limitId === 'string' && value.limitId ? value.limitId : key ?? 'default';
    const next: ProfileLimitSnapshot = { ...limits[id], id };
    if (typeof value.limitName === 'string') next.name = value.limitName;
    for (const name of ['primary', 'secondary'] as const) {
      const window = value[name];
      if (window == null) continue;
      if (!object(window) || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent) || window.usedPercent < 0) throw new Error('Invalid usage window');
      const old = next[name];
      next[name] = { usedPercent: window.usedPercent, ...(old?.windowDurationMins !== undefined ? { windowDurationMins: old.windowDurationMins } : {}), ...(old?.resetsAt !== undefined ? { resetsAt: old.resetsAt } : {}) };
      for (const field of ['windowDurationMins', 'resetsAt'] as const) {
        if (window[field] == null) continue;
        if (typeof window[field] !== 'number' || !Number.isFinite(window[field]) || window[field] < 0) throw new Error('Invalid usage reset');
        next[name]![field] = window[field];
      }
    }
    if (typeof value.spendControlReached === 'boolean') next.spendControlReached = value.spendControlReached;
    if (typeof value.rateLimitReachedType === 'string') next.reachedType = value.rateLimitReachedType;
    limits[id] = next;
  };
  if (raw.rateLimitsByLimitId != null) {
    if (!object(raw.rateLimitsByLimitId)) throw new Error('Invalid usage limit map');
    for (const [id, value] of Object.entries(raw.rateLimitsByLimitId)) if (value != null) merge(value, id);
  } else if (raw.rateLimits != null) merge(raw.rateLimits);
  if (raw.ordinaryUsageAllowed === true) for (const id of Object.keys(limits)) { limits[id] = { ...limits[id]! }; delete limits[id]!.reachedType; limits[id]!.spendControlReached = false; }
  return { ...(accountId ? { accountId } : {}), limits, ...(previous?.ordinaryUsageAllowed !== undefined ? { ordinaryUsageAllowed: previous.ordinaryUsageAllowed } : {}), ...(typeof raw.ordinaryUsageAllowed === 'boolean' ? { ordinaryUsageAllowed: raw.ordinaryUsageAllowed } : {}), updatedAt: new Date().toISOString() };
}
export function usageBlocked(usage: ProfileUsageSnapshot | undefined): boolean {
  return usage?.ordinaryUsageAllowed === false || Object.values(usage?.limits ?? {}).some(limit => limit.spendControlReached === true || !!limit.reachedType);
}
export function failureRecovery(raw: unknown): 'auth-required' | 'quota' | 'offline' | 'retry' {
  const error = object(raw) ? raw : {};
  const info = error.codexErrorInfo;
  if (info === 'unauthorized') return 'auth-required';
  if (['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(String(info))) return 'quota';
  if (object(info) && ('httpConnectionFailed' in info || 'responseStreamConnectionFailed' in info || 'responseStreamDisconnected' in info)) return 'offline';
  return 'retry';
}
