import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let dataDir: string;
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (path: string) => mkdir(path, { recursive: true }),
  readTextFile: (path: string) => readFile(path, "utf8"),
  remove: (path: string) => rm(path, { force: true }),
}));
vi.mock("./appDataDir", () => ({ ensureSpecOpsDataDir: () => Promise.resolve(dataDir) }));
vi.mock("@tauri-apps/api/path", () => ({ join: (...parts: string[]) => Promise.resolve(join(...parts)) }));
vi.mock("./atomicWrite", () => ({ atomicWriteTextFile: async (path: string, text: string) => {
  await writeFile(path + ".tmp", text); await rename(path + ".tmp", path);
} }));
import { chatStore } from "../state/chatStore";
import { persistSessionThreadSnapshot, flushSessionIndexPersistence, readWorkspaceSessionsIndexSnapshot, resetChatPersistenceForTests } from "./chatPersistence";
import { createFakeRuntimeAdapter } from "../session/adapter/fake";
beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), "specops-binding-")); chatStore.reset(); });
afterEach(async () => { resetChatPersistenceForTests(); await rm(dataDir, { recursive: true, force: true }); });
it("saves through the store/production writer, reloads disk into fresh state and resumes the same native ID", async () => {
  const root = "/workspace";
  chatStore.setActiveWorkspaceRoot(root);
  const sessionId = chatStore.createDraftSession()!;
  const firstHost = createFakeRuntimeAdapter();
  const native = await firstHost.createSession({ runtimeId: "fake", workspaceRootPath: root });
  const binding = { runtimeId: "fake" as const, nativeSessionId: native.nativeSessionId, modelId: "model", modeId: "mode", shareUrl: "https://example.test/shared", parentSessionId: "parent", runtimeMetadata: { effort: "high", access_token: "secret-canary" } };
  chatStore.setSessionLink(sessionId, binding, root);
  await flushSessionIndexPersistence(root);
  await persistSessionThreadSnapshot(root, sessionId, { metadata: { sessionId, threadId: sessionId, createdAt: "t", updatedAt: "t", summary: "" }, messages: [{ id: "u", role: "user", content: "hello", createdAt: "t" }] });
  chatStore.reset();
  chatStore.setActiveWorkspaceRoot(root);
  await chatStore.loadWorkspaceSessions(root);
  const restored = chatStore.getSessionLink(sessionId, root)!;
  expect(restored).toEqual({ ...binding, runtimeMetadata: { effort: "high", access_token: "[redacted]" } });
  expect((await readWorkspaceSessionsIndexSnapshot(root)).sessions).toHaveLength(1);
  const freshHost = createFakeRuntimeAdapter();
  const resumed = await freshHost.resumeSession({ native: { ...restored, nativeSessionId: restored.nativeSessionId as never }, workspaceRootPath: root });
  expect(resumed.nativeSessionId).toBe(native.nativeSessionId);
});

import { writeFileSync } from 'node:fs';
import { CodexRuntimeAdapter } from '../../../host/src/codex/adapter';
import { threadFixture } from '../../../host/src/codex/threadFixtures';
import { HostDispatcher } from '../../../host/src/dispatch';
import { AdapterRegistry } from '../../../host/src/registry';
import { PROTOCOL_VERSION } from '../../../host/src/protocol';
import { buildInfo } from '../../../host/src/version';
import { createAgentHostClient } from '../session/host/agentHostClient';
import { bindAgentHostClientForTests } from './agentHostRuntime';
import { executeProviderTurn } from '../ai/chatSendPipeline';
import { registerPermissionPromptRunner } from './permissionPrompt';
const nativeRuntimes: CodexRuntimeAdapter[] = [];
afterEach(() => { nativeRuntimes.splice(0).forEach(adapter => adapter.close()); bindAgentHostClientForTests(null); registerPermissionPromptRunner(null); });
async function nativeClient(adapter: CodexRuntimeAdapter, generation: number) {
  const registry = new AdapterRegistry(); registry.register(adapter);
  let notification: ((payload: unknown) => void) | undefined; let id = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const dispatcher = new HostDispatcher({ registry, buildInfo: buildInfo(), stdout: {
    write(chunk, callback) { const frame = JSON.parse(String(chunk)); if (frame.id !== undefined) { const reply = pending.get(frame.id); pending.delete(frame.id); if (frame.error) reply?.reject(new Error(frame.error.message)); else reply?.resolve(frame.result); } else notification?.(frame); callback?.(); return true; }, once() {}, off() {},
  } });
  const rpc = (method: string, params?: unknown) => new Promise<unknown>((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); void dispatcher.handle({ jsonrpc: '2.0', id: requestId, method, params }); });
  await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, client: { name: 'SpecOps test', version: '0.3.0' } });
  const status = { running: true, generation, health: 'healthy', pid: 1, hostVersion: 'fixture', protocolVersion: PROTOCOL_VERSION, restartCount: generation - 1, lastError: null };
  return createAgentHostClient({ invoke: async (command, args) => command === 'agent_host_request' ? rpc(String(args?.method), args?.params) : status, listen: async (_event, callback) => { notification = callback; return () => { notification = undefined; }; } });
}
it('native fixture passes dispatcher/client/pipeline and production disk writer across fresh app/host, without prompt replay or duplicate history', async () => {
  const root = join(dataDir, 'workspace'); await mkdir(root);
  const executable = join(dataDir, 'native-fixture.cjs'); writeFileSync(executable, threadFixture, { mode: 0o700 });
  const options = { profileRoot: join(dataDir, 'profiles'), executable };
  const first = new CodexRuntimeAdapter(options); nativeRuntimes.push(first);
  const profile = first.store.create('Account B fixture');
  await first.authenticate({ runtimeId: 'codex', connectionProfileId: profile.id, workspaceRootPath: root, options: { action: 'experimental-on' } });
  bindAgentHostClientForTests(() => firstClient);
  const firstClient = await nativeClient(first, 1);
  chatStore.setActiveWorkspaceRoot(root); const sessionId = chatStore.createDraftSession()!;
  chatStore.updateThreadMetadata({ runtimeId: 'codex', connectionProfileId: profile.id, selectedModelId: 'fixture-model', selectedModeId: 'plan', runtimeMetadata: { effort: 'high', sandbox: 'workspace-write', approvalPolicy: 'on-request' } });
  chatStore.appendMessage({ id: 'user-first', role: 'user', content: 'hello', createdAt: 't' }, { sessionId }); chatStore.beginTurn('first', sessionId);
  expect(await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'first' })).toMatchObject({ ok: true });
  const binding = chatStore.getSessionLink(sessionId, root)!;
  expect(binding.runtimeMetadata).toMatchObject({ effort: 'high', sandbox: 'workspace-write', collaborationMode: 'plan' });
  const saved = chatStore.getActiveThreadSnapshot(sessionId)!; expect(saved.messages.find(m => m.role === 'assistant')?.nativeTurnId).toBe('native-turn-0');
  await persistSessionThreadSnapshot(root, sessionId, saved); await flushSessionIndexPersistence(root); first.close();
  chatStore.reset(); chatStore.setActiveWorkspaceRoot(root); await chatStore.loadWorkspaceSessions(root);
  const restored = chatStore.getSessionLink(sessionId, root)!; expect(restored).toEqual(binding);
  const fresh = new CodexRuntimeAdapter(options); nativeRuntimes.push(fresh); const freshClient = await nativeClient(fresh, 2); bindAgentHostClientForTests(() => freshClient);
  chatStore.setActiveSessionId(sessionId);
  chatStore.appendMessage({ id: 'user-next', role: 'user', content: 'approval', createdAt: 't2' }, { sessionId }); chatStore.beginTurn('next', sessionId);
  registerPermissionPromptRunner(async () => ({ reply: 'once' }));
  expect(await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'next' })).toMatchObject({ ok: true });
  const messages = chatStore.getMessages(sessionId); expect(messages.filter(m => m.id === 'user-first')).toHaveLength(1); expect(messages.filter(m => m.role === 'assistant' && m.nativeTurnId === 'native-turn-0')).toHaveLength(1);
  expect(chatStore.getSessionLink(sessionId, root)?.nativeSessionId).toBe(binding.nativeSessionId);
  const nativeHistory = await fresh.resumeSession({ native: { ...restored, nativeSessionId: restored.nativeSessionId as never }, workspaceRootPath: root }); expect(nativeHistory.history?.filter(m => m.role === 'user').map(m => m.content)).toEqual(['hello', 'approval']);
  const requests = await readFile(join(fresh.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8'); expect(requests.match(/thread\/start/g)).toHaveLength(1);
  let dismissed = false; registerPermissionPromptRunner(request => new Promise(() => { request.signal?.addEventListener('abort', () => { dismissed = true; }, { once: true }); }));
  chatStore.appendMessage({ id: 'user-child-loss', role: 'user', content: 'approval-child-failure', createdAt: 't3' }, { sessionId }); chatStore.beginTurn('lost-child', sessionId);
  const before = Date.now(); const failure = await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'lost-child' }); expect(failure.ok).toBe(false); expect(dismissed).toBe(true); expect(Date.now() - before).toBeLessThan(1500); expect(chatStore.getRuntimeState(sessionId).isGenerating).toBe(false);
});
