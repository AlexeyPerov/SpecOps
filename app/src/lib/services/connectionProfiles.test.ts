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
 it('persists neutral enablement without retired transport state', () => {
  const encoded = toPersistedSettings({ ...defaultSettings, wrapLines: true, zoomPercent: 100, sessionsEnabled: true });
  expect(encoded.sessionsEnabled).toBe(true); expect(encoded).not.toHaveProperty("opencode");
 });
 it('reads catalogs only on an already running host, retries failure and explicitly restarts', async () => {
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
  expect(calls[0]).toBe('agent_host_status');
  expect((await loadSessionCatalogs('codex', 'profile-b')).status).toBe('ready');
  running = false; generation = 2;
  expect((await loadSessionCatalogs('codex', 'profile-b')).status).toBe('idle');
  expect(calls).not.toContain('agent_host_start');
  await ensureAgentHostStarted();
  expect(calls.filter(c => c === 'agent_host_start')).toHaveLength(1);
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

it('profile sign-out marks only bound sessions auth-required and ignores stale profile updates', () => {
  chatStore.reset(); chatStore.setActiveWorkspaceRoot('/profile-workspace');
  const a = chatStore.createDraftSession()!; chatStore.setSessionLink(a, { runtimeId: 'codex', connectionProfileId: 'profile-a', nativeSessionId: 'thread-a' });
  const b = chatStore.createDraftSession()!; chatStore.setSessionLink(b, { runtimeId: 'codex', connectionProfileId: 'profile-b', nativeSessionId: 'thread-b', parentSessionId: 'local-parent' });
  chatStore.applyConnectionProfileState('profile-b', 2, true);
  expect(chatStore.getRuntimeState(b).connectionState).toBe('auth-required'); expect(chatStore.getRuntimeState(a).connectionState).toBeUndefined();
  expect(chatStore.getSessionLink(b)?.parentSessionId).toBe('local-parent');
  chatStore.applyConnectionProfileState('profile-b', 1, false); expect(chatStore.getRuntimeState(b).connectionState).toBe('auth-required');
  chatStore.applyConnectionProfileState('profile-b', 3, false); expect(chatStore.getRuntimeState(b).connectionState).toBeUndefined(); chatStore.reset();
});

it('whole host replacement accepts reset child counters and rejects queued prior-host updates', async () => {
  let hostGeneration = 1; let emit: (value: unknown) => void = () => {};
  const client = createAgentHostClient({ invoke: async () => status(hostGeneration), listen: async (_event, handler) => { emit = handler; return () => {}; } });
  chatStore.setActiveWorkspaceRoot('/epoch'); const session = chatStore.createDraftSession()!; chatStore.setSessionLink(session, { runtimeId: 'codex', connectionProfileId: 'profile', nativeSessionId: 'thread' });
  const seen: number[] = [];
  const stop = await client.subscribeProfiles(update => { seen.push(update.generation); chatStore.applyConnectionProfileState(update.connectionProfileId, update.generation, update.profile.state === 'auth-required', update.hostGeneration); });
  await client.getStatus();
  const frame = (epoch: number, generation: number, state: 'auth-required' | 'authenticated') => ({ hostGeneration: epoch, method: 'profile.authUpdated', params: { runtimeId: 'codex', connectionProfileId: 'profile', generation, profile: { id: 'profile', generation, state } } });
  emit(frame(1, 3, 'auth-required')); expect(chatStore.getRuntimeState(session).connectionState).toBe('auth-required');
  hostGeneration = 2; await client.getStatus(); emit(frame(2, 1, 'authenticated')); expect(chatStore.getRuntimeState(session).connectionState).toBeUndefined();
  emit(frame(1, 4, 'auth-required')); expect(chatStore.getRuntimeState(session).connectionState).toBeUndefined();
  emit(frame(2, 2, 'auth-required')); expect(chatStore.getRuntimeState(session).connectionState).toBe('auth-required'); expect(seen).toEqual([3, 1, 2]); stop();
});

it('account replies carry host epoch and an in-flight old-host reply cannot overwrite new profile state', async () => {
  let generation = 1; let resolveAuth: (value: unknown) => void = () => {};
  const client = createAgentHostClient({ invoke: async (command) => command === 'agent_host_request' ? new Promise(resolve => { resolveAuth = resolve; }) : status(generation), listen: async () => () => {} });
  await client.getStatus(); const first = client.authenticate({ runtimeId: 'codex', connectionProfileId: 'profile', workspaceRootPath: '' });
  resolveAuth({ status: 'authenticated', profile: { id: 'profile', generation: 3, state: 'authenticated' } }); expect((await first).profile?.hostGeneration).toBe(1);
  const stale = client.authenticate({ runtimeId: 'codex', connectionProfileId: 'profile', workspaceRootPath: '' }); generation = 2; await client.getStatus();
  resolveAuth({ status: 'authenticated', profile: { id: 'profile', generation: 3, state: 'authenticated' } }); await expect(stale).rejects.toThrow('replaced');
});
