import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentHostClient, type AgentHostClient, type AgentHostStatus } from '../session/host/agentHostClient';
import { asNativeSessionId, asSpecOpsTurnId } from '../session/ids';
import { decodeChatSessionThreadFileSnapshot, encodeChatSessionThreadFileSnapshot, decodeWorkspaceSessionsIndexSnapshot, encodeWorkspaceSessionsIndexSnapshot } from './chatPersistenceCodec';
import { bindAgentHostClientForTests, ensureAgentHostStarted, loadSessionCatalogs } from './agentHostRuntime';
import { chatStore } from '../state/chatStore';
import { defaultSettings } from '../state/appState/settingsSlice';
import { toPersistedSettings } from './settingsStore';

afterEach(() => { bindAgentHostClientForTests(null); chatStore.reset(); });
const status = (generation = 1, running = true) => ({ running, generation, health: 'healthy' } as AgentHostStatus);

describe('connection profile production boundaries', () => {
 it('round-trips bound identity and draft selection in production codecs without auth material', () => {
  const snapshot = { version: 1 as const, sessions: [{ id: 'session-1', title: 'B', lastUsedAt: '2026-10-04T13:30:00Z', runtimeId: 'codex', connectionProfileId: 'profile-b', nativeSessionId: 'same-thread', runtimeMetadata: { authUrl: 'https://auth.openai.com/?code=SECRET-CANARY', userCode: 'DEVICE-CANARY' } }] };
  const encoded = encodeWorkspaceSessionsIndexSnapshot(snapshot);
  expect(encoded).not.toContain('CANARY');
  expect(decodeWorkspaceSessionsIndexSnapshot(encoded).sessions[0]).toMatchObject({ connectionProfileId: 'profile-b', nativeSessionId: 'same-thread' });
  const thread = { version: 1 as const, thread: { metadata: { sessionId: 'session-1', threadId: 'session-1', runtimeId: 'codex', connectionProfileId: 'profile-b', createdAt: '2026-10-04T13:30:00Z', updatedAt: '2026-10-04T13:30:00Z' }, messages: [] } };
  expect(decodeChatSessionThreadFileSnapshot(encodeChatSessionThreadFileSnapshot(thread))?.thread?.metadata.connectionProfileId).toBe('profile-b');
 });
 it('rejects profile switching on a bound index and bound draft metadata', () => {
  chatStore.setActiveWorkspaceRoot('/profiles'); const id = chatStore.createDraftSession()!;
  chatStore.updateThreadMetadata({ runtimeId: 'codex', connectionProfileId: 'profile-b' });
  expect(chatStore.setSessionLink(id, { runtimeId: 'codex', connectionProfileId: 'profile-b', nativeSessionId: 'same-thread' }, '/profiles')).toBe(true);
  expect(chatStore.setSessionLink(id, { runtimeId: 'codex', connectionProfileId: 'profile-c', nativeSessionId: 'same-thread' }, '/profiles')).toBe(false);
  expect(chatStore.updateThreadMetadata({ connectionProfileId: 'profile-c' })).toBe(false);
  expect(chatStore.getSessionLink(id, '/profiles')?.connectionProfileId).toBe('profile-b');
 });
 it('persists neutral enablement independently from provider enablement', () => {
  const encoded = toPersistedSettings({ ...defaultSettings, wrapLines: true, zoomPercent: 100, sessionsEnabled: true, opencode: { ...defaultSettings.opencode, enabled: false } });
  expect(encoded.sessionsEnabled).toBe(true); expect(encoded.opencode.enabled).toBe(false);
 });
 it('starts before catalogs, retries failure and detects host replacement', async () => {
  let generation = 1; let running = true;
  const calls: string[] = []; let failed = true;
  const client = createAgentHostClient({ invoke: async (cmd, args) => {
    calls.push(cmd === 'agent_host_request' ? String(args?.method) : cmd);
    if (cmd === 'agent_host_start') { running = true; return status(generation); }
    if (cmd === 'agent_host_status') return status(generation, running);
    if (args?.method === 'catalog.models') { if (failed) { failed = false; throw new Error('Profile unavailable'); } return { models: [{ id: 'model' }] }; }
    if (args?.method === 'catalog.modes') return { modes: [] };
    return {};
  }, listen: async () => () => {} });
  bindAgentHostClientForTests(() => client);
  expect((await loadSessionCatalogs('codex', 'profile-b')).status).toBe('error');
  expect(calls[0]).toBe('agent_host_start');
  expect((await loadSessionCatalogs('codex', 'profile-b')).status).toBe('ready');
  running = false; generation = 2; await ensureAgentHostStarted();
  expect(calls.filter(c => c === 'agent_host_start')).toHaveLength(2);
 });
 it('routes equal native ids by runtime/profile and auth notifications outside turn streams', async () => {
  let emit: (payload: unknown) => void = () => {};
  const client: AgentHostClient = createAgentHostClient({ invoke: async (cmd, args) => {
    if (cmd === 'agent_host_status') return status();
    return { turnId: (args?.params as { turnId?: string })?.turnId };
  }, listen: async (_event, handler) => { emit = handler; return () => {}; } });
  const auth = vi.fn(); const stop = await client.subscribeProfiles(auth);
  const stream = (profile: string, turn: string) => client.sendTurn({ native: { runtimeId: 'codex', connectionProfileId: profile, nativeSessionId: asNativeSessionId('same-thread') }, turnId: asSpecOpsTurnId(turn), workspaceRootPath: '/profiles', prompt: 'test' })[Symbol.asyncIterator]();
  const a = stream('a', 'turn-a'); const b = stream('b', 'turn-b');
  const pa = a.next(); const pb = b.next(); await Promise.resolve(); await Promise.resolve();
  emit({ method: 'profile.authUpdated', params: { runtimeId: 'codex', connectionProfileId: 'a', generation: 1, profile: { id: 'a', state: 'authenticated' } } });
  for (const profile of ['b', 'a']) emit({ method: 'session.event', params: { runtimeId: 'codex', connectionProfileId: profile, nativeSessionId: 'same-thread', event: { type: 'turn.finished', turnId: `turn-${profile}`, nativeSessionId: 'same-thread', seq: 1, at: '2026-10-04T13:30:00Z' } } });
  expect((await pa).value?.turnId).toBe('turn-a'); expect((await pb).value?.turnId).toBe('turn-b'); expect(auth).toHaveBeenCalledTimes(1);
  await a.next(); await b.next(); stop();
 });
});
