import { afterEach, expect, it } from 'vitest';
import { chatStore } from '../state/chatStore';
import { appState } from '../state/appState';
import { registerConfirmRunner } from './confirmDialogUi';
import { confirmConcurrentWorkspaceWork, workspaceActivity } from './sessionActivity';
afterEach(() => { chatStore.reset(); appState.resetAppState(); registerConfirmRunner(null); });
it('separates runtime/profile writers, represents native policy honestly and settles stale activity', () => {
 const store = chatStore; store.setActiveWorkspaceRoot('/workspace');
 const a = store.createDraftSession()!; store.updateThreadMetadata({ runtimeId: 'opencode', connectionProfileId: 'a', selectedModelId: 'provider/model' }); store.beginTurn('a', a);
 const b = store.createDraftSession()!; store.updateThreadMetadata({ runtimeId: 'codex', connectionProfileId: 'b', runtimeMetadata: { sandbox: 'read-only' } }); store.beginTurn('b', b); store.setWaitingForPermission(b, true, '/workspace');
 expect(workspaceActivity(store.getSnapshot(), '/workspace')).toMatchObject([{ sessionId: a, runtimeId: 'opencode', profileId: 'a', writeCapability: 'unknown' }, { sessionId: b, runtimeId: 'codex', profileId: 'b', writeCapability: 'read-only', action: 'permission' }]);
 store.cancelSessionGeneration('/workspace', a); expect(workspaceActivity(store.getSnapshot(), '/workspace')).toHaveLength(1);
 expect(workspaceActivity(store.getSnapshot(), '/other')).toEqual([]);
});
it('Continue keeps the other writer running and suppression only affects the warning', async () => {
 chatStore.setActiveWorkspaceRoot('/workspace'); const a = chatStore.createDraftSession()!; chatStore.updateThreadMetadata({ runtimeId: 'opencode', connectionProfileId: 'a' }); chatStore.beginTurn('a', a);
 let warnings = 0; registerConfirmRunner(async request => { warnings++; expect(request.confirmLabel).toBe('Continue'); expect(request.message).toContain('write capability unknown'); return true; });
 expect(await confirmConcurrentWorkspaceWork('/workspace', 'next')).toBe(true); expect(chatStore.getRuntimeState(a).isGenerating).toBe(true); expect(warnings).toBe(1);
 appState.applyPersistedSettings({ warnConcurrentWriters: false }); expect(await confirmConcurrentWorkspaceWork('/workspace', 'next')).toBe(true); expect(warnings).toBe(1); expect(chatStore.getActiveWorkspaceRoot()).toBe('/workspace');
});
