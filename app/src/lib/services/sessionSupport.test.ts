import { expect, it } from 'vitest';
import { sessionSupportSnapshot } from './sessionSupport';
it.each(['codex','opencode','claude'])('support export %s omits credentials, native paths, account details and raw errors', runtimeId => {
 const extra = { apiKey: 'SECRET-CANARY', home: '/private/native', message: 'SECRET-CANARY' };
 const snapshot = sessionSupportSnapshot({ running: true, health: 'healthy', pid: 42, generation: 2, hostVersion: '1', protocolVersion: 1, restartCount: 0, lastError: { kind: 'launch-failure', message: 'SECRET-CANARY' }, ...extra } as never, { runtimeId: runtimeId, runtimeVersion: '1.17.4', status: 'healthy', checkedAt: 't', ...extra } as never, { id: 'profile', runtimeId: runtimeId, label: 'secret label', account: { type: 'apiKey', email: 'private@example.test' }, generation: 3, state: 'authenticated', ...extra } as never);
 expect(snapshot).not.toContain('CANARY'); expect(snapshot).not.toContain('/private'); expect(snapshot).not.toContain('private@example'); expect(JSON.parse(snapshot).runtime.version).toBe('1.17.4');
});
