import { describe, expect, it } from 'vitest';
import { mergeUsage, usageBlocked, failureRecovery } from './limits';

describe('profile usage sparse merge', () => {
  it('merges buckets independently; null metadata/windows do not reset a healthy snapshot', () => {
    const first = mergeUsage(undefined, { accountId: 'a', ordinaryUsageAllowed: true, rateLimitsByLimitId: { coding: { primary: { usedPercent: 45, windowDurationMins: 300, resetsAt: 123 } }, other: { primary: { usedPercent: 90 } } } });
    const rolling = mergeUsage(first, { rateLimits: { limitId: 'coding', limitName: null, primary: { usedPercent: 46, windowDurationMins: null, resetsAt: null }, secondary: null }, ordinaryUsageAllowed: null });
    expect(rolling.limits.coding!.primary).toEqual({ usedPercent: 46, windowDurationMins: 300, resetsAt: 123 }); expect(rolling.limits.other!.primary?.usedPercent).toBe(90); expect(usageBlocked(rolling)).toBe(false);
    expect(mergeUsage(rolling, { rateLimits: { limitId: 'coding', primary: null } }).limits).toEqual(rolling.limits);
  });
  it('requires backend permission to recover quota and replaces limits on account change', () => {
    const blocked = mergeUsage(undefined, { accountId: 'a', ordinaryUsageAllowed: false, rateLimits: { limitId: 'coding', rateLimitReachedType: 'rate_limit_reached' } });
    expect(usageBlocked(mergeUsage(blocked, { rateLimits: { limitId: 'coding', primary: { usedPercent: 0 } } }))).toBe(true);
    expect(usageBlocked(mergeUsage(blocked, { ordinaryUsageAllowed: true }))).toBe(false);
    expect(mergeUsage(blocked, { accountId: 'b', rateLimits: { limitId: 'other' } }).limits).toEqual({ other: { id: 'other' } });
  });
  it('rejects malformed windows and distinguishes expiry/quota/offline from explicit retry', () => {
    expect(() => mergeUsage(undefined, { rateLimits: { primary: { usedPercent: NaN } } })).toThrow();
    expect(failureRecovery({ codexErrorInfo: 'unauthorized' })).toBe('auth-required'); expect(failureRecovery({ codexErrorInfo: 'rateLimitExceeded' })).toBe('quota'); expect(failureRecovery({ codexErrorInfo: { httpConnectionFailed: {} } })).toBe('offline'); expect(failureRecovery({})).toBe('retry');
  });
});
