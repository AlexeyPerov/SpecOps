import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let dataDir: string;
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: {path:string;content?:string;expected?:string|null}) => {
  if(command === 'handoff_read_journal') { try { return await readFile(args.path,'utf8'); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return null; throw e; } }
  if(command === 'handoff_write_journal') { let old:string|null=null;try{old=await readFile(args.path,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;} if(old!==args.expected)throw new Error('CAS conflict');await writeFile(args.path+'.intent.tmp',args.content!,{mode:0o600});await rename(args.path+'.intent.tmp',args.path);return; }
  throw new Error('Unexpected native command in integration fixture');
} }));
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

import { writeFileSync, realpathSync } from 'node:fs';
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
const nativeRuntimes: (CodexRuntimeAdapter | OpenCodeRuntimeAdapter | ClaudeRuntimeAdapter | CursorRuntimeAdapter)[] = [];
afterEach(() => { nativeRuntimes.splice(0).forEach(adapter => adapter.close()); bindAgentHostClientForTests(null); registerPermissionPromptRunner(null); });
async function nativeClient(adapter: import('../session/adapter').AgentRuntimeAdapter, generation: number) {
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
it.each(['divergent', 'corrupt'] as const)('native fixture (%s cache) passes dispatcher/client/pipeline and production disk writer across fresh app/host, without prompt replay or duplicate history', async (cache) => {
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
  const binding = { ...chatStore.getSessionLink(sessionId, root)!, parentSessionId: 'local-parent' }; chatStore.setSessionLink(sessionId, binding, root);
  expect(binding.runtimeMetadata).toMatchObject({ effort: 'high', sandbox: 'workspace-write', collaborationMode: 'plan' });
  const saved = chatStore.getActiveThreadSnapshot(sessionId)!; expect(saved.messages.find(m => m.role === 'assistant')?.nativeTurnId).toBe('native-turn-0');
  saved.metadata.summary = 'Local summary';
  if (cache === 'divergent') saved.messages = [...saved.messages.map(m => ({ ...m, content: 'divergent cached text' })), { id: 'duplicate-old', nativeTurnId: 'native-turn-0', role: 'assistant', content: 'duplicate', createdAt: 't' }];
  await persistSessionThreadSnapshot(root, sessionId, saved);
  if (cache === 'corrupt') { const { getSessionThreadFilePath } = await import('./chatPersistencePaths'); await writeFile(await getSessionThreadFilePath(root, sessionId), '{broken-cache'); } await flushSessionIndexPersistence(root); first.close();
  chatStore.reset(); chatStore.setActiveWorkspaceRoot(root); await chatStore.loadWorkspaceSessions(root);
  const restored = chatStore.getSessionLink(sessionId, root)!; expect(restored).toEqual(binding);
  const fresh = new CodexRuntimeAdapter(options); nativeRuntimes.push(fresh); const freshClient = await nativeClient(fresh, 2); bindAgentHostClientForTests(() => freshClient);
  chatStore.setActiveSessionId(sessionId);
  chatStore.appendMessage({ id: 'user-next', role: 'user', content: 'approval', createdAt: 't2' }, { sessionId }); chatStore.beginTurn('next', sessionId);
  registerPermissionPromptRunner(async () => ({ reply: 'once' }));
  expect(await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'next' })).toMatchObject({ ok: true });
  const messages = chatStore.getMessages(sessionId); expect(messages.filter(m => m.id === 'user-first')).toHaveLength(1); expect(messages.filter(m => m.role === 'assistant' && m.nativeTurnId === 'native-turn-0')).toHaveLength(1);
  expect(messages.some(m => m.content === 'divergent cached text' || m.id === 'duplicate-old')).toBe(false);
  expect(messages.find(m => m.id === 'user-first')?.content).toBe('hello');
  expect(messages.find(m => m.role === 'assistant' && m.nativeTurnId === 'native-turn-0')?.nativeItemId).toBe('native-turn-0-text');
  if (cache === 'divergent') expect(chatStore.getMetadata(sessionId)?.summary).toBe('Local summary');
  expect(chatStore.getSessionLink(sessionId, root)?.parentSessionId).toBe('local-parent');
  expect(chatStore.getSessionLink(sessionId, root)?.nativeSessionId).toBe(binding.nativeSessionId);
  const nativeHistory = await fresh.resumeSession({ native: { ...restored, nativeSessionId: restored.nativeSessionId as never }, workspaceRootPath: root }); expect(nativeHistory.history?.filter(m => m.role === 'user').map(m => m.content)).toEqual(['hello', 'approval']);
  const requests = await readFile(join(fresh.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8'); expect(requests.match(/thread\/start/g)).toHaveLength(1);
  let dismissed = false; registerPermissionPromptRunner(request => new Promise(() => { request.signal?.addEventListener('abort', () => { dismissed = true; }, { once: true }); }));
  chatStore.appendMessage({ id: 'user-child-loss', role: 'user', content: 'approval-child-failure', createdAt: 't3' }, { sessionId }); chatStore.beginTurn('lost-child', sessionId);
  const before = Date.now(); const failure = await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'lost-child' }); expect(failure.ok).toBe(false); expect(dismissed).toBe(true); expect(Date.now() - before).toBeLessThan(1500); expect(chatStore.getRuntimeState(sessionId).isGenerating).toBe(false);
  const nativePath = join(fresh.store.home(profile.id), 'fixture-history.json'); const nativeDb = JSON.parse(await readFile(nativePath, 'utf8')); delete nativeDb[binding.nativeSessionId]; await writeFile(nativePath, JSON.stringify(nativeDb)); fresh.close();
  chatStore.appendMessage({ id: 'user-missing', role: 'user', content: 'new continuation', createdAt: 't4' }, { sessionId }); chatStore.beginTurn('missing', sessionId);
  const missing = await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'missing' }); expect(missing.ok).toBe(false);
  expect(chatStore.getSessionLink(sessionId, root)?.nativeSessionId).toBe(binding.nativeSessionId); expect(chatStore.getMessages(sessionId).some(m => m.content === 'Hello native')).toBe(true);
  const afterMissing = await readFile(join(fresh.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8'); expect(afterMissing.match(/thread\/start/g)).toHaveLength(1);
});

import { copyFileSync, chmodSync } from "node:fs";
import { OpenCodeRuntimeAdapter } from "../../../host/src/opencode/adapter";
it.each(["divergent", "corrupt"] as const)(
  "OpenCode native %s cache uses production dispatcher/client/pipeline/persistence and resumes without replay",
  async (cache) => {
    const root = join(dataDir, "workspace");
    await mkdir(root);
    const executable = join(dataDir, "native-core.mjs");
    copyFileSync(
      join(process.cwd(), "host/src/opencode/nativeFixture.mjs"),
      executable,
    );
    chmodSync(executable, 0o700);
    const options = { profileRoot: join(dataDir, "profiles"), executable };
    const first = new OpenCodeRuntimeAdapter(options);
    nativeRuntimes.push(first);
    const profile = first.store.create("Core profile");
    const client = await nativeClient(first, 1);
    bindAgentHostClientForTests(() => client);
    chatStore.setActiveWorkspaceRoot(root);
    const sessionId = chatStore.createDraftSession()!;
    chatStore.updateThreadMetadata({
      runtimeId: "opencode",
      connectionProfileId: profile.id,
      selectedModelId: "fixture/model",
      selectedModeId: "build",
    });
    chatStore.appendMessage(
      { id: "user-first", role: "user", content: "hello", createdAt: "t" },
      { sessionId },
    );
    chatStore.beginTurn("first", sessionId);
    expect(
      await executeProviderTurn({
        root,
        activeSessionId: sessionId,
        turnId: "first",
      }),
    ).toMatchObject({ ok: true });
    const binding = chatStore.getSessionLink(sessionId, root)!;
    expect(binding).toMatchObject({
      runtimeId: "opencode",
      connectionProfileId: profile.id,
      modelId: "fixture/model",
      modeId: "build",
    });
    const saved = chatStore.getActiveThreadSnapshot(sessionId)!;
    if (cache === "divergent")
      saved.messages = saved.messages.map((message) => ({
        ...message,
        content: "stale cache",
      }));
    await persistSessionThreadSnapshot(root, sessionId, saved);
    await flushSessionIndexPersistence(root);
    if (cache === "corrupt") {
      const { getSessionThreadFilePath } = await import(
        "./chatPersistencePaths"
      );
      await writeFile(
        await getSessionThreadFilePath(root, sessionId),
        "{broken",
      );
    }
    first.close();
    chatStore.reset();
    chatStore.setActiveWorkspaceRoot(root);
    await chatStore.loadWorkspaceSessions(root);
    expect(chatStore.getSessionLink(sessionId, root)).toEqual(binding);
    const fresh = new OpenCodeRuntimeAdapter(options);
    nativeRuntimes.push(fresh);
    const freshClient = await nativeClient(fresh, 2);
    bindAgentHostClientForTests(() => freshClient);
    chatStore.setActiveSessionId(sessionId);
    chatStore.appendMessage(
      { id: "user-next", role: "user", content: "permission", createdAt: "t2" },
      { sessionId },
    );
    chatStore.beginTurn("next", sessionId);
    registerPermissionPromptRunner(async () => ({ reply: "once" }));
    expect(
      await executeProviderTurn({
        root,
        activeSessionId: sessionId,
        turnId: "next",
      }),
    ).toMatchObject({ ok: true });
    const messages = chatStore.getMessages(sessionId);
    expect(
      messages.filter((message) => message.id === "user-first"),
    ).toHaveLength(1);
    expect(messages.some((message) => message.content === "stale cache")).toBe(
      false,
    );
    expect(
      messages.filter((message) => message.role === "assistant"),
    ).toHaveLength(2);
    expect(chatStore.getSessionLink(sessionId, root)).toEqual(binding);
    const history = await fresh.resumeSession({
      native: { ...binding, nativeSessionId: binding.nativeSessionId as never },
      workspaceRootPath: root,
    });
    expect(
      history.history
        ?.filter((message) => message.role === "user")
        .map((message) => message.content),
    ).toEqual(["hello", "permission"]);
    const sessions = JSON.parse(
      await readFile(
        join(fresh.store.home(profile.id), "fixture-sessions.json"),
        "utf8",
      ),
    );
    expect(Object.keys(sessions)).toHaveLength(1);
  },
);

import { ClaudeRuntimeAdapter } from '../../../host/src/claude/adapter';
import { CursorRuntimeAdapter } from '../../../host/src/cursor/adapter';
import { CursorFixtureDriver } from '../../../host/src/cursor/fixtures';
import { CURSOR_SDK_VERSION } from '../../../host/src/cursor/runtime';
import { ClaudeFixtureDriver, fixturePath } from '../../../host/src/claude/fixtures';
import { CLAUDE_NATIVE_VERSION, CLAUDE_SDK_VERSION } from '../../../host/src/claude/runtime';
it.each(['divergent', 'corrupt'] as const)('Cursor native %s cache reconciles production dispatcher/client/pipeline/store/disk without replay', async cache => {
 const root=join(dataDir,'workspace');await mkdir(root);
 const profileRoot=join(dataDir,'profiles');await mkdir(profileRoot);
 const driver=new CursorFixtureDriver(join(profileRoot,'native-fixture.json'));
 const options={profileRoot,assets:()=>({sdk:'fixture',worker:'fixture',root:'fixture',sdkVersion:CURSOR_SDK_VERSION}),control:async(_assets:unknown,_env:unknown,action:string)=>action==='probe'?{ok:true,probe:{durableAgent:true,nativeId:true,store:'jsonl',node:process.version}}:{ok:true,models:[{id:'native-model',displayName:'Native model'}]},driver:()=>driver};
 const first=new CursorRuntimeAdapter(options);nativeRuntimes.push(first);const profile=first.store.create('Native profile');first.store.saveKey(profile.id,'fixture-private-key-canary');
 const client=await nativeClient(first,1);bindAgentHostClientForTests(()=>client);
 chatStore.setActiveWorkspaceRoot(root);const sessionId=chatStore.createDraftSession()!;
 chatStore.updateThreadMetadata({runtimeId:'cursor',connectionProfileId:profile.id,selectedModelId:'native-model',selectedModeId:'agent'});
 chatStore.appendMessage({id:'user-first',role:'user',content:'secret',createdAt:'t'},{sessionId});chatStore.beginTurn('first',sessionId);
 expect(await executeProviderTurn({root,activeSessionId:sessionId,turnId:'first'})).toMatchObject({ok:true});
 const binding=chatStore.getSessionLink(sessionId,root)!;expect(binding).toMatchObject({runtimeId:'cursor',connectionProfileId:profile.id,modelId:'native-model',modeId:'agent',runtimeMetadata:{workspaceRootPath:realpathSync(root),tools:[],settingSources:[]}});
 const saved=chatStore.getActiveThreadSnapshot(sessionId)!,runId=saved.messages.find(m=>m.role==='assistant')!.nativeTurnId;
 expect(runId).toMatch(/^run-/);expect(JSON.stringify(saved)).not.toContain('fixture-private-key-canary');
 if(cache==='divergent')saved.messages=saved.messages.map(m=>({...m,content:'stale cache'}));
 await persistSessionThreadSnapshot(root,sessionId,saved);await flushSessionIndexPersistence(root);
 const {getSessionThreadFilePath}=await import('./chatPersistencePaths');const cachedFile=await getSessionThreadFilePath(root,sessionId);expect(await readFile(cachedFile,'utf8')).not.toContain('fixture-private-key-canary');
 if(cache==='corrupt')await writeFile(cachedFile,'{broken');
 await first.close();chatStore.reset();chatStore.setActiveWorkspaceRoot(root);await chatStore.loadWorkspaceSessions(root);expect(chatStore.getSessionLink(sessionId,root)).toEqual(binding);
 const fresh=new CursorRuntimeAdapter(options);nativeRuntimes.push(fresh);const freshClient=await nativeClient(fresh,2);bindAgentHostClientForTests(()=>freshClient);chatStore.setActiveSessionId(sessionId);
 chatStore.appendMessage({id:'user-next',role:'user',content:'follow up',createdAt:'t2'},{sessionId});chatStore.beginTurn('next',sessionId);
 expect(await executeProviderTurn({root,activeSessionId:sessionId,turnId:'next'})).toMatchObject({ok:true});
 const messages=chatStore.getMessages(sessionId);expect(messages.filter(m=>m.id==='user-first')).toHaveLength(1);expect(messages.filter(m=>m.role==='assistant')).toHaveLength(2);expect(messages.some(m=>m.content==='stale cache')).toBe(false);
 const previous=messages.find(m=>m.role==='assistant'&&m.nativeTurnId===runId)!;expect(previous.content).toBe('Native [REDACTED] answer ');expect(previous.toolCalls).toHaveLength(1);expect(previous.completionState).toBe('completed');expect(previous.parts?.some(p=>p.type==='reasoning')).toBe(true);
 expect(chatStore.getSessionLink(sessionId,root)).toEqual(binding);expect(driver.calls.filter(c=>c.action==='create')).toHaveLength(1);expect(driver.calls.filter(c=>c.action==='send')).toHaveLength(2);expect(JSON.stringify(messages)).not.toContain('fixture-private-key-canary');
 const db=JSON.parse(await readFile(driver.path,'utf8'));delete db[binding.nativeSessionId];await writeFile(driver.path,JSON.stringify(db));
 chatStore.appendMessage({id:'missing',role:'user',content:'continue',createdAt:'t3'},{sessionId});chatStore.beginTurn('missing',sessionId);
 expect((await executeProviderTurn({root,activeSessionId:sessionId,turnId:'missing'})).ok).toBe(false);expect(chatStore.getSessionLink(sessionId,root)).toEqual(binding);expect(driver.calls.filter(c=>c.action==='create')).toHaveLength(1);expect(driver.calls.filter(c=>c.action==='send')).toHaveLength(2);
});
it.each(['divergent','corrupt'] as const)('Claude native %s cache uses production dispatcher/client/pipeline/disk and profile-bound authoritative history',async cache=>{
 const firstPrompt = cache === 'corrupt' ? 'secret' : 'hello';
 const firstAnswer = cache === 'corrupt' ? '[redacted] private' : 'Native fixture answer';
 const root=join(dataDir,'workspace');await mkdir(root);
 const profileRoot=join(dataDir,'profiles');const driver=new ClaudeFixtureDriver(fixturePath(profileRoot));
 const options={profileRoot,enableNativeTurns:true,assets:()=>({sdk:'fixture',executable:'fixture',sdkVersion:CLAUDE_SDK_VERSION,nativeVersion:CLAUDE_NATIVE_VERSION}),probe:async()=>[{value:'native-model',displayName:'Native model'}],verifyKey:async()=>{},sessionDriver:()=>driver};
 const first=new ClaudeRuntimeAdapter(options);nativeRuntimes.push(first);const profile=first.store.create('Native profile');first.store.saveKey(profile.id,'fixture-private-key-canary');
 const client=await nativeClient(first,1);bindAgentHostClientForTests(()=>client);
 chatStore.setActiveWorkspaceRoot(root);const sessionId=chatStore.createDraftSession()!;
 chatStore.updateThreadMetadata({runtimeId:'claude',connectionProfileId:profile.id,selectedModelId:'native-model'});
 chatStore.appendMessage({id:'user-first',role:'user',content:firstPrompt,createdAt:'t'},{sessionId});chatStore.beginTurn('first',sessionId);
 expect(await executeProviderTurn({root,activeSessionId:sessionId,turnId:'first'})).toMatchObject({ok:true});
 const binding=chatStore.getSessionLink(sessionId,root)!;expect(binding).toMatchObject({runtimeId:'claude',connectionProfileId:profile.id,modelId:'native-model',runtimeMetadata:{workspaceRootPath:realpathSync(root),configScope:'isolated',toolSet:'native',permissionMode:'default',writeCapability:'possible'}});
 const saved=chatStore.getActiveThreadSnapshot(sessionId)!;expect(JSON.stringify(saved)).not.toContain('fixture-private-key-canary');const turn=saved.messages.find(m=>m.role==='assistant')!.nativeTurnId;
 if(cache==='divergent')saved.messages=saved.messages.map(m=>({...m,content:'stale cache'}));
 await persistSessionThreadSnapshot(root,sessionId,saved);await flushSessionIndexPersistence(root);
 const {getSessionThreadFilePath:cachedPath}=await import('./chatPersistencePaths');expect(await readFile(await cachedPath(root,sessionId),'utf8')).not.toContain('fixture-private-key-canary');
 if(cache==='corrupt'){const {getSessionThreadFilePath}=await import('./chatPersistencePaths');await writeFile(await getSessionThreadFilePath(root,sessionId),'{broken');}
 first.close();chatStore.reset();chatStore.setActiveWorkspaceRoot(root);await chatStore.loadWorkspaceSessions(root);expect(chatStore.getSessionLink(sessionId,root)).toEqual(binding);
 const fresh=new ClaudeRuntimeAdapter(options);nativeRuntimes.push(fresh);const freshClient=await nativeClient(fresh,2);bindAgentHostClientForTests(()=>freshClient);chatStore.setActiveSessionId(sessionId);
 chatStore.appendMessage({id:'user-next',role:'user',content:'hello',createdAt:'t2'},{sessionId});chatStore.beginTurn('next',sessionId);expect(await executeProviderTurn({root,activeSessionId:sessionId,turnId:'next'})).toMatchObject({ok:true});
 const messages=chatStore.getMessages(sessionId);expect(messages.filter(m=>m.id==='user-first')).toHaveLength(1);expect(messages.filter(m=>m.role==='assistant')).toHaveLength(2);expect(messages.some(m=>m.content==='stale cache')).toBe(false);
 const previous=messages.find(m=>m.role==='assistant'&&m.nativeTurnId===turn)!;expect(previous.content).toBe(firstAnswer);expect(previous.toolCalls).toHaveLength(1);expect(previous.completionState).toBe('completed');expect(previous.parts?.some(p=>p.type==='reasoning')).toBe(true);
 expect(chatStore.getSessionLink(sessionId,root)).toEqual(binding);
 const resumed=await fresh.resumeSession({native:{...binding,nativeSessionId:binding.nativeSessionId as never},workspaceRootPath:root});expect(resumed.history?.filter(m=>m.role==='user').map(m=>m.content)).toEqual([firstPrompt,'hello']);
 const nativeDb=JSON.parse(await readFile(fixturePath(profileRoot),'utf8'));expect(Object.keys(nativeDb)).toHaveLength(1);expect(driver.calls.filter(c=>c.sessionId)).toHaveLength(2); // One control-only initialization plus first native prompt.
 expect(JSON.stringify(messages)).not.toContain('fixture-private-key-canary');
 delete nativeDb[binding.nativeSessionId];await writeFile(fixturePath(profileRoot),JSON.stringify(nativeDb));fresh.close();chatStore.appendMessage({id:'missing',role:'user',content:'continue',createdAt:'t3'},{sessionId});chatStore.beginTurn('missing',sessionId);
 expect((await executeProviderTurn({root,activeSessionId:sessionId,turnId:'missing'})).ok).toBe(false);expect(chatStore.getSessionLink(sessionId,root)).toEqual(binding);expect(chatStore.getMessages(sessionId).some(m=>m.content==='Native fixture answer')).toBe(true);
});


import { confirmHandoff, openKnownHandoffTarget } from './handoffController';
import { buildHandoffDraft, handoffFirstPrompt, type HandoffTarget } from './sessionHandoff';
import { readHandoffJournal } from './handoffPersistence';
import type { AgentRuntimeId } from '../session';
async function handoffNativeFixture(runtimeId: AgentRuntimeId, suffix: string, root: string) {
 const base=join(dataDir,suffix);await mkdir(base);let adapter: CodexRuntimeAdapter|OpenCodeRuntimeAdapter|ClaudeRuntimeAdapter|CursorRuntimeAdapter;let modelId:string;let modeId:string|undefined;
 if(runtimeId==='codex'){const executable=join(base,'native.cjs');writeFileSync(executable,threadFixture,{mode:0o700});adapter=new CodexRuntimeAdapter({profileRoot:join(base,'profiles'),executable});modelId='fixture-model';modeId='default';}
 else if(runtimeId==='opencode'){const executable=join(base,'native.mjs');copyFileSync(join(process.cwd(),'host/src/opencode/nativeFixture.mjs'),executable);chmodSync(executable,0o700);adapter=new OpenCodeRuntimeAdapter({profileRoot:join(base,'profiles'),executable});modelId='fixture/model';modeId='build';}
 else if(runtimeId==='cursor'){const profileRoot=join(base,'profiles');const driver=new CursorFixtureDriver(join(base,'native-cursor.json'));adapter=new CursorRuntimeAdapter({profileRoot,assets:()=>({sdk:'fixture',worker:'fixture',root:'fixture',sdkVersion:CURSOR_SDK_VERSION}),control:async(_a,_e,action)=>action==='probe'?{ok:true,probe:{durableAgent:true,nativeId:true,store:'jsonl',node:process.version}}:{ok:true,models:[{id:'native-model',displayName:'Native model',parameters:[{id:'effort',values:[{value:'small'}]}]}]},driver:()=>driver});modelId='native-model';modeId='agent';}
 else {const profileRoot=join(base,'profiles');const driver=new ClaudeFixtureDriver(fixturePath(profileRoot));adapter=new ClaudeRuntimeAdapter({profileRoot,enableNativeTurns:true,assets:()=>({sdk:'fixture',executable:'fixture',sdkVersion:CLAUDE_SDK_VERSION,nativeVersion:CLAUDE_NATIVE_VERSION}),probe:async()=>[{value:'native-model',displayName:'Native model'}],verifyKey:async()=>{},sessionDriver:()=>driver});modelId='native-model';}
 nativeRuntimes.push(adapter);const profile=adapter.store.create(suffix);
 if(adapter instanceof CodexRuntimeAdapter)await adapter.authenticate({runtimeId,connectionProfileId:profile.id,workspaceRootPath:root,options:{action:'experimental-on'}});
 else if(adapter instanceof OpenCodeRuntimeAdapter){writeFileSync(join(adapter.store.home(profile.id),'api-key'),'fixture-test-key',{mode:0o600});await adapter.authenticate({runtimeId,connectionProfileId:profile.id,workspaceRootPath:root,options:{action:'login-api-key',providerId:'fixture'},credential:{kind:'api-key',ref:'profile-api-key'}});}
 else adapter.store.saveKey(profile.id,'fixture-test-key');
 const client=await nativeClient(adapter,1);return {adapter,client,target:{runtimeId,connectionProfileId:profile.id,modelId,modeId,...(runtimeId==='cursor'?{runtimeMetadata:{toolset:'files-read',sandbox:'enabled','modelParameter:effort':'small'}}:{})} satisfies HandoffTarget};
}
const handoffPairs = (['codex','opencode','claude','cursor'] as const).flatMap(source => (['codex','opencode','claude','cursor'] as const).map(target=>[source,target] as const));
it.each(handoffPairs)('reviewed %s → %s pair uses real source adapters/dispatcher/client/pipeline/disk with separate profiles, fresh target and no replay',async(sourceRuntime,targetRuntime)=>{
 const root=join(dataDir,'workspace');await mkdir(root);const source=await handoffNativeFixture(sourceRuntime,'source-account',root);const target=await handoffNativeFixture(targetRuntime,'later-target-account',root);
 chatStore.setActiveWorkspaceRoot(root);const sourceId=chatStore.createDraftSession()!;bindAgentHostClientForTests(()=>source.client);chatStore.updateThreadMetadata({runtimeId:sourceRuntime,connectionProfileId:source.target.connectionProfileId,selectedModelId:source.target.modelId,selectedModeId:source.target.modeId});chatStore.appendMessage({id:'source-first',role:'user',content:'Continue the reviewed goal',createdAt:'t'},{sessionId:sourceId});chatStore.beginTurn('source-first-turn',sourceId);expect((await executeProviderTurn({root,activeSessionId:sourceId,turnId:'source-first-turn'})).ok).toBe(true);
 const sourceBinding=chatStore.getSessionLink(sourceId,root)!;const sourceBefore=await source.client.resumeSession({native:{...sourceBinding,nativeSessionId:sourceBinding.nativeSessionId as never},workspaceRootPath:root});
 const draft=buildHandoffDraft({sourceSessionId:sourceId,sourceRuntimeId:sourceRuntime,sourceConnectionProfileId:sourceBinding.connectionProfileId,workspaceRootPath:root,messages:chatStore.getMessages(sourceId)});draft.sections[0].text='Exactly edited approval';draft.sections.find(s=>s.id==='summary')!.included=false;
 const prompt=handoffFirstPrompt(draft,target.target,'handoff-target');bindAgentHostClientForTests(()=>target.client);const approval={version:1 as const,id:'ordered-pair',sourceSessionId:sourceId,targetSessionId:'handoff-target',workspaceRootPath:root,target:target.target,approvedPrompt:prompt,approvedAt:new Date().toISOString(),stage:'approved' as const};
 const result=await confirmHandoff(approval);expect(result.outcome).toBe('completed');expect(result.native?.connectionProfileId).toBe(target.target.connectionProfileId);expect(chatStore.getMetadata('handoff-target')?.handoff?.sourceSessionId).toBe(sourceId);const firstPrompt=chatStore.getMessages('handoff-target').find(m=>m.role==='user');expect(firstPrompt?.content).toBe(prompt);
 expect(chatStore.getSessionLink(sourceId,root)).toEqual(sourceBinding);const sourceAfter=await source.client.resumeSession({native:{...sourceBinding,nativeSessionId:sourceBinding.nativeSessionId as never},workspaceRootPath:root});const stable = (history: typeof sourceBefore.history) => history?.map(({events,...message}) => message);expect(stable(sourceAfter.history)).toEqual(stable(sourceBefore.history));
 const before=await target.client.resumeSession({native:result.native!,workspaceRootPath:root});expect(before.history?.filter(m=>m.role==='user')).toHaveLength(1);await confirmHandoff(approval);const after=await target.client.resumeSession({native:result.native!,workspaceRootPath:root});expect(stable(after.history)).toEqual(stable(before.history));
 // Ordinary Retry cannot repeat the possibly accepted initial handoff prompt.
 chatStore.beginTurn('retry-handoff','handoff-target');expect((await executeProviderTurn({root,activeSessionId:'handoff-target',turnId:'retry-handoff'})).ok).toBe(false);expect((await target.client.resumeSession({native:result.native!,workspaceRootPath:root})).history?.map(({events,...message})=>message)).toEqual(stable(before.history));
 await flushSessionIndexPersistence(root);const persisted=chatStore.getActiveThreadSnapshot('handoff-target')!;await persistSessionThreadSnapshot(root,'handoff-target',persisted);chatStore.reset();chatStore.setActiveWorkspaceRoot(root);await chatStore.loadWorkspaceSessions(root);const saved=(await readHandoffJournal(root)).attempts[0];await openKnownHandoffTarget(saved);expect(chatStore.getMetadata('handoff-target')?.handoff?.sourceSessionId).toBe(sourceId);expect(chatStore.getSessionLink('handoff-target',root)?.nativeSessionId).toBe(result.native?.nativeSessionId);expect((await target.client.resumeSession({native:result.native!,workspaceRootPath:root})).history?.map(({events,...message})=>message)).toEqual(stable(before.history));
 // A lost/divergent thread cache cannot remove the index-level initial-send guard.
 const {getSessionThreadFilePath}=await import('./chatPersistencePaths');await writeFile(await getSessionThreadFilePath(root,'handoff-target'),'{corrupt');chatStore.reset();chatStore.setActiveWorkspaceRoot(root);await chatStore.loadWorkspaceSessions(root);chatStore.setActiveSessionId('handoff-target');chatStore.appendMessage({id:`handoff-message-${approval.id}`,role:'user',content:prompt,createdAt:'t'},{sessionId:'handoff-target'});chatStore.beginTurn('corrupt-retry','handoff-target');expect((await executeProviderTurn({root,activeSessionId:'handoff-target',turnId:'corrupt-retry'})).ok).toBe(false);expect((await target.client.resumeSession({native:result.native!,workspaceRootPath:root})).history?.map(({events,...message})=>message)).toEqual(stable(before.history));
 await openKnownHandoffTarget(saved);expect(chatStore.getMetadata('handoff-target')?.handoff?.sourceSessionId).toBe(sourceId);
 expect(chatStore.updateThreadMetadata({selectedModelId:'another-model'},undefined,'handoff-target')).toBe(false);
},30_000);

it('two equal native IDs retain distinct profiles/homes and resume own production pipeline/disk threads; removed profile keeps saved metadata',async()=>{
 const root=join(dataDir,'workspace');await mkdir(root);const executable=join(dataDir,'native-two.cjs');writeFileSync(executable,threadFixture,{mode:0o700});
 const options={profileRoot:join(dataDir,'profiles'),executable,experimental:true};const first=new CodexRuntimeAdapter(options);nativeRuntimes.push(first);
 const profiles=[first.store.create('First account'),first.store.create('Second account')];const client=await nativeClient(first,1);bindAgentHostClientForTests(()=>client);
 chatStore.setActiveWorkspaceRoot(root);const sessions:string[]=[];
 for(const [index,profile] of profiles.entries()){
   const session=chatStore.createDraftSession()!;sessions.push(session);chatStore.updateThreadMetadata({runtimeId:'codex',connectionProfileId:profile.id,selectedModelId:'fixture-model'});
   chatStore.appendMessage({id:'profile-user-'+index,role:'user',content:'profile prompt '+index,createdAt:'t'},{sessionId:session});chatStore.beginTurn('first-'+index,session);
   expect(await executeProviderTurn({root,activeSessionId:session,turnId:'first-'+index})).toMatchObject({ok:true});
 }
 const bindings=sessions.map(session=>chatStore.getSessionLink(session,root)!);expect(bindings[0].nativeSessionId).toBe(bindings[1].nativeSessionId);expect(bindings[0].connectionProfileId).not.toBe(bindings[1].connectionProfileId);
 await flushSessionIndexPersistence(root);first.close();chatStore.reset();chatStore.setActiveWorkspaceRoot(root);await chatStore.loadWorkspaceSessions(root);
 const fresh=new CodexRuntimeAdapter(options);nativeRuntimes.push(fresh);const next=await nativeClient(fresh,2);bindAgentHostClientForTests(()=>next);
 for(const [index,session] of sessions.entries()){
   chatStore.setActiveSessionId(session);expect(chatStore.getSessionLink(session,root)).toEqual(bindings[index]);
   chatStore.appendMessage({id:'continue-'+index,role:'user',content:'hello',createdAt:'t2'},{sessionId:session});chatStore.beginTurn('next-'+index,session);
   expect(await executeProviderTurn({root,activeSessionId:session,turnId:'next-'+index})).toMatchObject({ok:true});
   const users=chatStore.getMessages(session).filter(message=>message.role==='user');expect(users.some(message=>message.content==='profile prompt '+index)).toBe(true);expect(users.some(message=>message.content==='profile prompt '+(1-index))).toBe(false);
   const requests=await readFile(join(fresh.store.home(profiles[index].id),'fixture-requests.jsonl'),'utf8');expect(requests.match(/thread\/start/g)).toHaveLength(1);
 }
 await next.authenticate({runtimeId:'codex',connectionProfileId:profiles[0].id,workspaceRootPath:root,options:{action:'remove-profile'}});
 await flushSessionIndexPersistence(root);chatStore.reset();chatStore.setActiveWorkspaceRoot(root);await chatStore.loadWorkspaceSessions(root);expect(chatStore.getSessionLink(sessions[0],root)).toEqual(bindings[0]);
 await expect(next.resumeSession({native:{...bindings[0],nativeSessionId:bindings[0].nativeSessionId as never},workspaceRootPath:root})).rejects.toThrow();
 expect((await next.resumeSession({native:{...bindings[1],nativeSessionId:bindings[1].nativeSessionId as never},workspaceRootPath:root})).history?.filter(message=>message.role==='user').map(message=>message.content)).toEqual(['profile prompt 1','hello']);
});

import { performNativeAction, steerNativeTurn } from './nativeExtensions';
it('Codex native session actions pass dispatcher/client/pipeline and durable parent-child recovery without replay', async () => {
  const root = join(dataDir, 'parity-workspace'); await mkdir(root);
  const executable = join(dataDir, 'parity-native.cjs'); writeFileSync(executable, threadFixture, { mode: 0o700 });
  const options = { profileRoot: join(dataDir, 'parity-profiles'), executable, experimental: true };
  const first = new CodexRuntimeAdapter(options); nativeRuntimes.push(first); const profile = first.store.create('Selected account');
  const client = await nativeClient(first, 1); bindAgentHostClientForTests(() => client);
  chatStore.setActiveWorkspaceRoot(root); const source = chatStore.createDraftSession()!;
  chatStore.updateThreadMetadata({ runtimeId: 'codex', connectionProfileId: profile.id, selectedModelId: 'fixture-model', selectedModeId: 'default', runtimeMetadata: { effort: 'medium', sandbox: 'read-only', approvalPolicy: 'on-request' } });
  chatStore.appendMessage({ id: 'source-user', role: 'user', content: 'cancel', createdAt: 't' }, { sessionId: source }); chatStore.beginTurn('active-original', source);
  const run = executeProviderTurn({ root, activeSessionId: source, turnId: 'active-original' });
  let original = chatStore.getSessionLink(source, root);
  for (let i = 0; i < 100 && !original?.nativeSessionId; i++) { await new Promise(resolve => setTimeout(resolve, 10)); original = chatStore.getSessionLink(source, root); }
  expect(original?.nativeSessionId).toBeTruthy(); await new Promise(resolve => setTimeout(resolve, 30));
  await steerNativeTurn(root, source, 'append inside the active native turn');
  const steered = chatStore.getMessages(source).find(m => m.content === 'append inside the active native turn')!;
  expect(steered.nativeTurnId).toBe('native-turn-0'); expect(steered.completionState).toBe('completed');
  const native = { ...original!, nativeSessionId: original!.nativeSessionId as never };
  await client.cancelTurn({ native, turnId: 'active-original' as never }); await run;
  await performNativeAction(root, source, 'fork', 'native-turn-0');
  const child = chatStore.getActiveSessionId()!; expect(child).not.toBe(source);
  const childBinding = chatStore.getSessionLink(child, root)!;
  expect(childBinding).toMatchObject({ parentSessionId: source, connectionProfileId: profile.id, modelId: original!.modelId, modeId: original!.modeId });
  expect(childBinding.nativeSessionId).not.toBe(original!.nativeSessionId);
  expect(chatStore.getMessages(child).filter(m => m.role === 'user').map(m => m.id)).toEqual(['source-user', steered.id]);
  chatStore.setNativeOperation(source, { id: 'prepared-source-compact', kind: 'compact' }, root);
  await expect(confirmHandoff({ version: 1, id: 'prepared-before-compact', sourceSessionId: source, targetSessionId: 'blocked-target', workspaceRootPath: root, target: { runtimeId: 'codex', connectionProfileId: profile.id, modelId: 'fixture-model', modeId: 'default' }, approvedPrompt: 'approved earlier', approvedAt: new Date().toISOString(), stage: 'approved' })).rejects.toThrow('compaction');
  expect(chatStore.getSessionLink('blocked-target', root)).toBeFalsy();
  chatStore.setNativeOperation(source, null, root, 'prepared-source-compact');
  await performNativeAction(root, child, 'compact');
  expect(chatStore.getRuntimeState(child, root).nativeOperation).toBeUndefined();
  expect(chatStore.getSessionLink(source, root)?.nativeSessionId).toBe(original!.nativeSessionId);
  const { getSessionThreadFilePath } = await import('./chatPersistencePaths'); await writeFile(await getSessionThreadFilePath(root, child), '{corrupt-cache');
  await flushSessionIndexPersistence(root); first.close(); chatStore.reset(); chatStore.setActiveWorkspaceRoot(root); await chatStore.loadWorkspaceSessions(root); chatStore.setActiveSessionId(child);
  expect(chatStore.getSessionLink(child, root)).toMatchObject(childBinding);
  const fresh = new CodexRuntimeAdapter(options); nativeRuntimes.push(fresh); const restored = await nativeClient(fresh, 2); bindAgentHostClientForTests(() => restored);
  chatStore.appendMessage({ id: 'fresh-child-user', role: 'user', content: 'hello', createdAt: 't2' }, { sessionId: child }); chatStore.beginTurn('fresh-child', child);
  expect(await executeProviderTurn({ root, activeSessionId: child, turnId: 'fresh-child' })).toMatchObject({ ok: true });
  expect(chatStore.getMessages(child).filter(m => m.id === steered.id)).toHaveLength(1);
  expect(chatStore.getMessages(child).some(m => m.id === 'fresh-child-user')).toBe(true);
  const sourceHistory = await restored.resumeSession({ native, workspaceRootPath: root });
  expect(sourceHistory.history?.filter(m => m.role === 'user').map(m => m.id)).toEqual(['source-user', steered.id]);
  const requests = await readFile(join(fresh.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8');
  expect(requests.match(/turn\/steer/g)).toHaveLength(1); expect(requests.match(/thread\/fork/g)).toHaveLength(1); expect(requests.match(/thread\/start/g)).toHaveLength(1);
  expect(requests).not.toMatch(/thread\/(rollback|revert)/);
});

import { ecosystemFixture } from '../../../host/src/codex/ecosystemFixtures';
it('native ecosystem actions cross dispatcher/client/service and persist only selected profile config while conversation binding/history stay intact', async () => {
  const root=realpathSync(dataDir);const executable=join(root,'ecosystem-native.cjs');writeFileSync(executable,ecosystemFixture,{mode:0o700});
  const options={profileRoot:join(root,'ecosystem-profiles'),executable,experimental:true};const adapter=new CodexRuntimeAdapter(options);nativeRuntimes.push(adapter);const profile=adapter.store.create('Owner');const client=await nativeClient(adapter,1);bindAgentHostClientForTests(()=>client);
  const native=await client.createSession({runtimeId:'codex',connectionProfileId:profile.id,workspaceRootPath:root});chatStore.setActiveWorkspaceRoot(root);const session=chatStore.createDraftSession()!;chatStore.setSessionLink(session,{...native,nativeSessionId:String(native.nativeSessionId)},root);await flushSessionIndexPersistence(root);
  const original=JSON.stringify(chatStore.getSessionLink(session,root));const inspect=(view:'ecosystem'|'configuration')=>client.inspectNative({native,workspaceRootPath:root,view});
  const ecosystem=await inspect('ecosystem');await performNativeAction(root,session,'setSkillEnabled',ecosystem.rows.find(r=>r.control)!.id,undefined,'false');
  let snapshot=await inspect('ecosystem');expect(snapshot.rows.find(r=>r.control)?.control?.value).toBe('false');await performNativeAction(root,session,'disconnectToolServer',snapshot.rows.find(r=>r.targetKind==='toolServer')!.id);
  snapshot=await inspect('ecosystem');expect(snapshot.rows.find(r=>r.targetKind==='toolServer')?.detail).toContain('Disabled');await performNativeAction(root,session,'connectToolServer',snapshot.rows.find(r=>r.targetKind==='toolServer')!.id);
  expect((await inspect('ecosystem')).rows.find(r=>r.targetKind==='toolServer')?.detail).toContain('connected');const config=await inspect('configuration');await performNativeAction(root,session,'setNativeConfig',config.rows.find(r=>r.label==='web search')!.id,undefined,'disabled');
  expect(JSON.stringify(chatStore.getSessionLink(session,root))).toBe(original);expect(chatStore.getMessages(session)).toHaveLength(0);adapter.close();const fresh=new CodexRuntimeAdapter(options);nativeRuntimes.push(fresh);const restored=await nativeClient(fresh,2);bindAgentHostClientForTests(()=>restored);await restored.resumeSession({native,workspaceRootPath:root});expect((await restored.inspectNative({native,workspaceRootPath:root,view:'configuration'})).rows.find(r=>r.label==='web search')?.control?.value).toBe('disabled');
  await expect(performNativeAction(root,session,'setNativeConfig',config.rows[0]!.id,undefined,'live')).rejects.toThrow();
});

it.each(['divergent', 'corrupt'] as const)('rich activity (%s cache) passes dispatcher/client/pipeline and production disk writer across fresh app/host, without prompt replay or duplicate history', async (cache) => {
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
  chatStore.appendMessage({ id: 'user-first', role: 'user', content: 'rich-activity', createdAt: 't' }, { sessionId }); chatStore.beginTurn('first', sessionId);
  expect(await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'first' })).toMatchObject({ ok: true });
  const binding = { ...chatStore.getSessionLink(sessionId, root)!, parentSessionId: 'local-parent' }; chatStore.setSessionLink(sessionId, binding, root);
  expect(binding.runtimeMetadata).toMatchObject({ effort: 'high', sandbox: 'workspace-write', collaborationMode: 'plan' });
  const saved = chatStore.getActiveThreadSnapshot(sessionId)!; expect(saved.messages.find(m => m.role === 'assistant')?.nativeTurnId).toBe('native-turn-0');
  const liveParts = saved.messages.find(m => m.role === 'assistant')!.parts!;
  expect(liveParts.filter(p => p.type === 'subtask')).toHaveLength(2);
  expect(liveParts.find(p => p.type === 'subtask' && p.category === 'agent')).toMatchObject({ status:'completed', nativeThreadId:'child', agentPath:'workers/[redacted]' });
  saved.metadata.summary = 'Local summary';
  if (cache === 'divergent') saved.messages = [...saved.messages.map(m => ({ ...m, content: 'divergent cached text' })), { id: 'duplicate-old', nativeTurnId: 'native-turn-0', role: 'assistant', content: 'duplicate', createdAt: 't' }];
  await persistSessionThreadSnapshot(root, sessionId, saved);
  if (cache === 'corrupt') { const { getSessionThreadFilePath } = await import('./chatPersistencePaths'); await writeFile(await getSessionThreadFilePath(root, sessionId), '{broken-cache'); } await flushSessionIndexPersistence(root); first.close();
  chatStore.reset(); chatStore.setActiveWorkspaceRoot(root); await chatStore.loadWorkspaceSessions(root);
  const restored = chatStore.getSessionLink(sessionId, root)!; expect(restored).toEqual(binding);
  const fresh = new CodexRuntimeAdapter(options); nativeRuntimes.push(fresh); const freshClient = await nativeClient(fresh, 2); bindAgentHostClientForTests(() => freshClient);
  chatStore.setActiveSessionId(sessionId);
  chatStore.appendMessage({ id: 'user-next', role: 'user', content: 'approval', createdAt: 't2' }, { sessionId }); chatStore.beginTurn('next', sessionId);
  registerPermissionPromptRunner(async () => ({ reply: 'once' }));
  expect(await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'next' })).toMatchObject({ ok: true });
  const messages = chatStore.getMessages(sessionId); expect(messages.filter(m => m.id === 'user-first')).toHaveLength(1); expect(messages.filter(m => m.role === 'assistant' && m.nativeTurnId === 'native-turn-0')).toHaveLength(1);
  expect(messages.some(m => m.content === 'divergent cached text' || m.id === 'duplicate-old')).toBe(false);
  expect(messages.find(m => m.id === 'user-first')?.content).toBe('rich-activity');
  expect(messages.find(m => m.role === 'assistant' && m.nativeTurnId === 'native-turn-0')?.nativeItemId).toBe('native-turn-0-text');
  if (cache === 'divergent') expect(chatStore.getMetadata(sessionId)?.summary).toBe('Local summary');
  expect(chatStore.getSessionLink(sessionId, root)?.parentSessionId).toBe('local-parent');
  expect(chatStore.getSessionLink(sessionId, root)?.nativeSessionId).toBe(binding.nativeSessionId);
  const nativeHistory = await fresh.resumeSession({ native: { ...restored, nativeSessionId: restored.nativeSessionId as never }, workspaceRootPath: root }); expect(nativeHistory.history?.filter(m => m.role === 'user').map(m => m.content)).toEqual(['rich-activity', 'approval']);
  const restoredParts = messages.find(m => m.role === 'assistant' && m.nativeTurnId === 'native-turn-0')!.parts!;
  expect(restoredParts.filter(p => p.type === 'subtask')).toHaveLength(2);
  expect(restoredParts.find(p => p.type === 'subtask' && p.category === 'agent')).toMatchObject({ status:'completed', nativeThreadId:'child', agentPath:'workers/[redacted]', output:'Result [redacted] [redacted]' });
  expect(JSON.stringify({ saved, messages })).not.toContain('opaque-mcp-canary-value');
  const requests = await readFile(join(fresh.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8'); expect(requests.match(/thread\/start/g)).toHaveLength(1);
  let dismissed = false; registerPermissionPromptRunner(request => new Promise(() => { request.signal?.addEventListener('abort', () => { dismissed = true; }, { once: true }); }));
  chatStore.appendMessage({ id: 'user-child-loss', role: 'user', content: 'approval-child-failure', createdAt: 't3' }, { sessionId }); chatStore.beginTurn('lost-child', sessionId);
  const before = Date.now(); const failure = await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'lost-child' }); expect(failure.ok).toBe(false); expect(dismissed).toBe(true); expect(Date.now() - before).toBeLessThan(1500); expect(chatStore.getRuntimeState(sessionId).isGenerating).toBe(false);
  const nativePath = join(fresh.store.home(profile.id), 'fixture-history.json'); const nativeDb = JSON.parse(await readFile(nativePath, 'utf8')); delete nativeDb[binding.nativeSessionId]; await writeFile(nativePath, JSON.stringify(nativeDb)); fresh.close();
  chatStore.appendMessage({ id: 'user-missing', role: 'user', content: 'new continuation', createdAt: 't4' }, { sessionId }); chatStore.beginTurn('missing', sessionId);
  const missing = await executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'missing' }); expect(missing.ok).toBe(false);
  expect(chatStore.getSessionLink(sessionId, root)?.nativeSessionId).toBe(binding.nativeSessionId); expect(chatStore.getMessages(sessionId).some(m => m.content === 'Activity complete')).toBe(true);
  const afterMissing = await readFile(join(fresh.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8'); expect(afterMissing.match(/thread\/start/g)).toHaveLength(1);
});
