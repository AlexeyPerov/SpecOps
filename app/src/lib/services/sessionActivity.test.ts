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

it('native approval planning never claims a read-only filesystem guarantee', () => {
 chatStore.setActiveWorkspaceRoot('/workspace'); const id=chatStore.createDraftSession()!; chatStore.updateThreadMetadata({runtimeId:'claude',runtimeMetadata:{permissionMode:'plan',writeCapability:'possible'}}); chatStore.beginTurn('native',id);
 expect(workspaceActivity(chatStore.getSnapshot(),'/workspace')[0].writeCapability).toBe('possible');
 chatStore.updateThreadMetadata({runtimeId:'claude',runtimeMetadata:{permissionMode:'plan',writeCapability:'read-only'}}); expect(workspaceActivity(chatStore.getSnapshot(),'/workspace')[0].writeCapability).toBe('unknown');
});

it('native file restrictions and sandbox never imply a read-only guarantee; enabled writes remain visible', () => {
 chatStore.setActiveWorkspaceRoot('/workspace');const id=chatStore.createDraftSession()!;
 chatStore.updateThreadMetadata({runtimeId:'cursor',connectionProfileId:'isolated',runtimeMetadata:{toolset:'files-read',sandbox:'enabled',writeCapability:'unknown'}});chatStore.beginTurn('native',id);
 expect(workspaceActivity(chatStore.getSnapshot(),'/workspace')[0]).toMatchObject({profileId:'isolated',writeCapability:'unknown'});
 chatStore.updateThreadMetadata({runtimeId:'cursor',runtimeMetadata:{toolset:'files-write',sandbox:'enabled',writeCapability:'possible'}});expect(workspaceActivity(chatStore.getSnapshot(),'/workspace')[0].writeCapability).toBe('possible');
 chatStore.updateThreadMetadata({runtimeId:'cursor',runtimeMetadata:{toolset:'files-read',sandbox:'read-only',writeCapability:'read-only'}});expect(workspaceActivity(chatStore.getSnapshot(),'/workspace')[0].writeCapability).toBe('unknown');
});

it('owned native compaction is activity without a fake coding turn, blocks send/delete and clears only its own flag', async () => {
 const root = '/workspace'; chatStore.setActiveWorkspaceRoot(root); const id = chatStore.createDraftSession()!;
 chatStore.updateThreadMetadata({ runtimeId: 'codex', connectionProfileId: 'owner', runtimeMetadata: { sandbox: 'read-only' } });
 chatStore.setNativeOperation(id, { id: 'first', kind: 'compact' }, root);
 expect(chatStore.getRuntimeState(id, root).isGenerating).toBe(false);
 expect(workspaceActivity(chatStore.getSnapshot(), root)[0]).toMatchObject({ sessionId: id, profileId: 'owner', action: 'compact', writeCapability: 'read-only' });
 expect(chatStore.beginTurn('overlap', id)).toBe(false); expect(await chatStore.deleteSession(id)).toBe(false);
 chatStore.setNativeOperation(id, { id: 'replacement', kind: 'compact' }, root); chatStore.setNativeOperation(id, null, root, 'first');
 expect(chatStore.getRuntimeState(id, root).nativeOperation?.id).toBe('replacement');
 chatStore.setNativeOperation(id, null, root, 'replacement'); expect(workspaceActivity(chatStore.getSnapshot(), root)).toEqual([]);
});
