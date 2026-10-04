import { afterEach, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createAgentHostClient } from './agentHostClient';
import { threadFixture } from '../../../../host/src/codex/threadFixtures';
import { PROTOCOL_VERSION } from '../../../../host/src/protocol';
import { asSpecOpsTurnId } from '../ids';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(close => close()));
it('actual whole-host death settles two equal-ID profile-native streams including a pending approval and preserves immutable bindings without replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'specops-host-death-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'native.cjs'); writeFileSync(executable, threadFixture, { mode: 0o700 });
  const hostDir = resolve('host'); const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: hostDir, encoding: 'utf8' }); expect(built.status).toBe(0);
  const host = spawn(process.execPath, [join(hostDir, 'dist/index.js')], { detached: true, env: { ...process.env, SPECOPS_CODEX_EXECUTABLE: executable, SPECOPS_PROFILE_ROOT: join(root, 'profiles') } });
  cleanup.push(() => { try { process.kill(-host.pid!, 'SIGKILL'); } catch {} });
  let exited = false; let id = 0; let carry = ''; const listeners = new Set<(value: unknown) => void>(); const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let hostErrors = ''; host.stderr.setEncoding('utf8');host.stderr.on('data', chunk=>{hostErrors += chunk;});
  host.on('exit', () => { exited = true; for (const request of pending.values()) request.reject(new Error('Host exited: '+hostErrors)); pending.clear(); });
  host.stdout.setEncoding('utf8'); host.stdout.on('data', chunk => {
    carry += chunk; let end: number;
    while ((end = carry.indexOf('\n')) >= 0) { const line = carry.slice(0, end); carry = carry.slice(end + 1); if (!line) continue; const frame = JSON.parse(line);
      if (frame.id !== undefined) { const request = pending.get(frame.id); pending.delete(frame.id); if (frame.error) request?.reject(new Error(frame.error.message)); else request?.resolve(frame.result); }
      else for (const listener of listeners) listener({ ...frame, hostGeneration: 1 });
    }
  });
  const rpc = (method: string, params?: unknown) => new Promise<unknown>((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); host.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, client: { name: 'SpecOps fault test', version: '0.3.0' } });
  const client = createAgentHostClient({ invoke: async (command, args) => command === 'agent_host_request' ? rpc(String(args?.method), args?.params) : { running: !exited, generation: 1, health: exited ? 'error' : 'healthy', pid: host.pid, protocolVersion: PROTOCOL_VERSION, hostVersion: 'fixture', restartCount: 0, lastError: null }, listen: async (_event, callback) => { listeners.add(callback); return () => { listeners.delete(callback); }; } });
  await client.start();
  const created = await client.authenticate({ runtimeId: 'codex', workspaceRootPath: root, options: { action: 'create-profile' } }); const profile = created.profile!;
  await client.authenticate({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: profile.id, options: { action: 'experimental-on' } });
  const otherProfile = (await client.authenticate({ runtimeId: 'codex', workspaceRootPath: root, options: { action: 'create-profile', label: 'Second profile' } })).profile!;
  await client.authenticate({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: otherProfile.id, options: { action: 'experimental-on' } });
  const a = await client.createSession({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: profile.id }); const b = await client.createSession({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: otherProfile.id });
  const first = client.sendTurn({ native: a, turnId: asSpecOpsTurnId('turn-a'), workspaceRootPath: root, prompt: 'approval' })[Symbol.asyncIterator]();
  let event = await first.next(); while (event.value?.type !== 'permission.requested') event = await first.next();
  const second = client.sendTurn({ native: b, turnId: asSpecOpsTurnId('turn-b'), workspaceRootPath: root, prompt: 'cancel' })[Symbol.asyncIterator](); await second.next();
  const failedA = expect(first.next()).rejects.toThrow(/Host.*(?:exited|stopped)/); const failedB = (async () => { try { for (;;) { const value = await second.next(); if (value.done) break; } throw new Error('unexpected completion'); } catch (error) { expect(String(error)).toMatch(/Host.*(?:exited|stopped)/); } })();
  host.kill('SIGKILL'); await failedA; await failedB;
  expect(exited).toBe(true); expect(listeners.size).toBe(0); expect(a.nativeSessionId).toBe(b.nativeSessionId); expect(a.connectionProfileId).not.toBe(b.connectionProfileId); expect(a.connectionProfileId).toBe(profile.id);
  const requests = readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-requests.jsonl'), 'utf8'); expect(requests.match(/thread\/start/g)).toHaveLength(1); const history = JSON.parse(readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-history.json'), 'utf8')); expect(Object.values(history).map(value => (value as { turns: unknown[] }).turns.length)).toEqual([1]);
  const otherRequests = readFileSync(join(root, 'profiles', otherProfile.id, 'home', 'fixture-requests.jsonl'), 'utf8'); expect(otherRequests.match(/thread\/start/g)).toHaveLength(1);
  const otherHistory = JSON.parse(readFileSync(join(root, 'profiles', otherProfile.id, 'home', 'fixture-history.json'), 'utf8')); expect(otherHistory[b.nativeSessionId].turns).toHaveLength(1);
}, 15000);

it.each([false, true])('actual whole-host death settles Codex/OpenCode and optional Claude/Cursor=%s without replay', async (withClaude) => {
  const root = mkdtempSync(join(tmpdir(), 'specops-host-death-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'native.cjs'); writeFileSync(executable, threadFixture, { mode: 0o700 });
  const openExecutable = join(root, 'native.mjs'); copyFileSync(resolve('host/src/opencode/nativeFixture.mjs'), openExecutable); chmodSync(openExecutable, 0o700);
  const hostDir = resolve('host'); const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: hostDir, encoding: 'utf8' }); expect(built.status).toBe(0);
  let entry = join(hostDir, 'dist/index.js');
  if (withClaude) {
    // Only the Claude driver/auth verifier are injected. Production host framing,
    // dispatcher, adapters and client own transport failure and other runtimes.
    const harness = join(root, 'host-fixture.mjs');
    const source = join(root, 'host-fixture.ts');
    writeFileSync(source, `
      import { createHost } from ${JSON.stringify(join(hostDir,'src/host.ts'))};
      import { ClaudeRuntimeAdapter } from ${JSON.stringify(join(hostDir,'src/claude/adapter.ts'))};
      import { ClaudeFixtureDriver, fixturePath } from ${JSON.stringify(join(hostDir,'src/claude/fixtures.ts'))};
      import { CLAUDE_SDK_VERSION, CLAUDE_NATIVE_VERSION } from ${JSON.stringify(join(hostDir,'src/claude/runtime.ts'))};
      const profileRoot = ${JSON.stringify(join(root,'profiles','claude'))};
      const driver = new ClaudeFixtureDriver(fixturePath(profileRoot));
      const adapter = new ClaudeRuntimeAdapter({profileRoot,assets:()=>({sdk:'fixture',executable:'fixture',sdkVersion:CLAUDE_SDK_VERSION,nativeVersion:CLAUDE_NATIVE_VERSION}),verifyKey:async()=>{},probe:async()=>[{value:'native-model',displayName:'Native model'}],sessionDriver:()=>driver});
      import { CursorRuntimeAdapter } from ${JSON.stringify(join(hostDir,'src/cursor/adapter.ts'))};
      import { CursorFixtureDriver } from ${JSON.stringify(join(hostDir,'src/cursor/fixtures.ts'))};
      import { CURSOR_SDK_VERSION } from ${JSON.stringify(join(hostDir,'src/cursor/runtime.ts'))};
      const cursorRoot = ${JSON.stringify(join(root,'profiles','cursor'))};
      const cursorDriver = new CursorFixtureDriver(${JSON.stringify(join(root,'profiles','cursor-native.json'))});
      const cursor = new CursorRuntimeAdapter({profileRoot:cursorRoot,assets:()=>({sdk:'fixture',worker:'fixture',root:'fixture',sdkVersion:CURSOR_SDK_VERSION}),control:async(_a,_e,action)=>action==='probe'?{ok:true,probe:{durableAgent:true,nativeId:true,store:'jsonl',node:process.version}}:{ok:true,models:[{id:'native-model',displayName:'Native model'}]},driver:()=>cursorDriver});
      createHost({extraAdapters:[adapter,cursor]}).run().then(code=>process.exit(code));
    `);
    const bundled = spawnSync(join(hostDir,'../node_modules/.bin/esbuild'),[source,'--bundle','--platform=node','--format=esm',`--outfile=${harness}`,"--banner:js=import { createRequire as harnessCreateRequire } from 'node:module'; const require = harnessCreateRequire(import.meta.url);"],{encoding:'utf8'});
    expect(bundled.status, bundled.stderr).toBe(0);
    entry = harness;
  }
  const host = spawn(process.execPath, [entry], { detached: true, env: { ...process.env, SPECOPS_CODEX_EXECUTABLE: executable, SPECOPS_OPENCODE_EXECUTABLE: openExecutable, SPECOPS_PROFILE_ROOT: join(root, 'profiles') } });
  cleanup.push(() => { try { process.kill(-host.pid!, 'SIGKILL'); } catch {} });
  let exited = false; let id = 0; let carry = ''; const listeners = new Set<(value: unknown) => void>(); const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let hostErrors = ''; host.stderr.setEncoding('utf8');host.stderr.on('data', chunk=>{hostErrors += chunk;});
  host.on('exit', () => { exited = true; for (const request of pending.values()) request.reject(new Error('Host exited: '+hostErrors)); pending.clear(); });
  host.stdout.setEncoding('utf8'); host.stdout.on('data', chunk => {
    carry += chunk; let end: number;
    while ((end = carry.indexOf('\n')) >= 0) { const line = carry.slice(0, end); carry = carry.slice(end + 1); if (!line) continue; const frame = JSON.parse(line);
      if (frame.id !== undefined) { const request = pending.get(frame.id); pending.delete(frame.id); if (frame.error) request?.reject(new Error(frame.error.message)); else request?.resolve(frame.result); }
      else for (const listener of listeners) listener({ ...frame, hostGeneration: 1 });
    }
  });
  const rpc = (method: string, params?: unknown) => new Promise<unknown>((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); host.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, client: { name: 'SpecOps fault test', version: '0.3.0' } });
  const client = createAgentHostClient({ invoke: async (command, args) => command === 'agent_host_request' ? rpc(String(args?.method), args?.params) : { running: !exited, generation: 1, health: exited ? 'error' : 'healthy', pid: host.pid, protocolVersion: PROTOCOL_VERSION, hostVersion: 'fixture', restartCount: 0, lastError: null }, listen: async (_event, callback) => { listeners.add(callback); return () => { listeners.delete(callback); }; } });
  await client.start();
  const created = await client.authenticate({ runtimeId: 'codex', workspaceRootPath: root, options: { action: 'create-profile' } }); const profile = created.profile!;
  await client.authenticate({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: profile.id, options: { action: 'experimental-on' } });
  const a = await client.createSession({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: profile.id }); const otherProfile = (await client.authenticate({ runtimeId: 'opencode', workspaceRootPath: root, options: { action: 'create-profile' } })).profile!; const b = await client.createSession({ runtimeId: 'opencode', workspaceRootPath: root, connectionProfileId: otherProfile.id, modelId: 'fixture/model', modeId: 'build' });
  const first = client.sendTurn({ native: a, turnId: asSpecOpsTurnId('turn-a'), workspaceRootPath: root, prompt: 'approval' })[Symbol.asyncIterator]();
  let event = await first.next(); while (event.value?.type !== 'permission.requested') event = await first.next();
  let second = client.sendTurn({ native: b, turnId: asSpecOpsTurnId('turn-b'), workspaceRootPath: root, prompt: 'cancel' })[Symbol.asyncIterator](); await second.next();
  const historyPath = join(root, 'profiles', 'opencode', otherProfile.id, 'fixture-sessions.json');
  const waitForNativePrompt = async (count: number) => {
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const db = JSON.parse(readFileSync(historyPath, 'utf8'));
      if (db[b.nativeSessionId].messages.length === count) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Native prompt was not dispatched');
  };
  await waitForNativePrompt(1);
  const nativePid = Number(readFileSync(join(root, 'profiles', 'opencode', otherProfile.id, 'fixture-native'), 'utf8'));
  process.kill(nativePid, 'SIGKILL');
  let failed = false;
  for (;;) { const event = await second.next(); if (event.done) break; if (event.value.type === 'turn.failed') failed = true; }
  expect(failed).toBe(true);
  const healthy = await client.createSession({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: profile.id });
  let finished = false;
  for await (const event of client.sendTurn({ native: healthy, turnId: asSpecOpsTurnId('healthy'), workspaceRootPath: root, prompt: 'hello' })) if (event.type === 'turn.finished') finished = true;
  expect(finished).toBe(true);
  await client.authenticate({ runtimeId: 'opencode', workspaceRootPath: root, connectionProfileId: otherProfile.id, options: { action: 'restart' } });
  const resumed = await client.resumeSession({ native: b, workspaceRootPath: root }); expect(resumed.nativeSessionId).toBe(b.nativeSessionId);
  second = client.sendTurn({ native: b, turnId: asSpecOpsTurnId('turn-b-recovered'), workspaceRootPath: root, prompt: 'cancel' })[Symbol.asyncIterator](); await second.next();
  await waitForNativePrompt(2);
  let cursorStream: AsyncIterator<unknown> | undefined;
  let cursorBinding: Awaited<ReturnType<typeof client.createSession>> | undefined;
  let claudeStream: AsyncIterator<unknown> | undefined;
  let claudeBinding: Awaited<ReturnType<typeof client.createSession>> | undefined;
  if (withClaude) {
    const profile = (await client.authenticate({runtimeId:'claude',workspaceRootPath:root,options:{action:'create-profile'}})).profile!;
    writeFileSync(join(root,'profiles','claude',profile.id,'api-key'),'host-death-private-key-canary',{mode:0o600});
    await client.authenticate({runtimeId:'claude',workspaceRootPath:root,connectionProfileId:profile.id,credential:{kind:'api-key',ref:'profile-api-key'},options:{action:'login-api-key'}});
    claudeBinding = await client.createSession({runtimeId:'claude',workspaceRootPath:root,connectionProfileId:profile.id,modelId:'native-model'});
    const stream = client.sendTurn({native:claudeBinding,turnId:asSpecOpsTurnId('claude-pending'),workspaceRootPath:root,prompt:'approve'})[Symbol.asyncIterator]();
    let value = await stream.next(); while(value.value?.type !== 'permission.requested') value = await stream.next();
    claudeStream = stream;
    const cursorProfile = (await client.authenticate({runtimeId:'cursor',workspaceRootPath:root,options:{action:'create-profile'}})).profile!;
    writeFileSync(join(root,'profiles','cursor',cursorProfile.id,'api-key'),'cursor-host-death-private-canary',{mode:0o600});
    await client.authenticate({runtimeId:'cursor',workspaceRootPath:root,connectionProfileId:cursorProfile.id,credential:{kind:'api-key',ref:'profile-api-key'},options:{action:'login-api-key'}});
    cursorBinding = await client.createSession({runtimeId:'cursor',workspaceRootPath:root,connectionProfileId:cursorProfile.id,modelId:'native-model'});
    const cursorTurn=client.sendTurn({native:cursorBinding,turnId:asSpecOpsTurnId('cursor-pending'),workspaceRootPath:root,prompt:'cancel',context:{clientUserMessageId:'cursor-pending'}})[Symbol.asyncIterator]();
    await cursorTurn.next(); cursorStream=cursorTurn;
    const until=Date.now()+3000;
    while(Date.now()<until){try{const db=JSON.parse(readFileSync(join(root,'profiles','cursor-native.json'),'utf8'));if(db[cursorBinding.nativeSessionId]?.runs.length===1)break;}catch{}await new Promise(r=>setTimeout(r,10));}
    expect(JSON.parse(readFileSync(join(root,'profiles','cursor-native.json'),'utf8'))[cursorBinding.nativeSessionId].runs).toHaveLength(1);
  }
  const failedA = expect(first.next()).rejects.toThrow(/Host.*(?:exited|stopped)/); const failedB = (async () => { try { for (;;) { const value = await second.next(); if (value.done) break; } throw new Error('unexpected completion'); } catch (error) { expect(String(error)).toMatch(/Host.*(?:exited|stopped)/); } })();
  const failedClaude = claudeStream ? expect(claudeStream.next()).rejects.toThrow(/Host.*(?:exited|stopped)/) : Promise.resolve();
  const failedCursor=cursorStream ? expect(cursorStream.next()).rejects.toThrow(/Host.*(?:exited|stopped)/) : Promise.resolve();
  host.kill('SIGKILL'); await failedA; await failedB; await failedClaude; await failedCursor;
  if(cursorBinding){const db=JSON.parse(readFileSync(join(root,'profiles','cursor-native.json'),'utf8'));expect(db[cursorBinding.nativeSessionId].runs).toHaveLength(1);expect(db[cursorBinding.nativeSessionId].runs[0].messages.filter((m:any)=>m.type==='user')).toHaveLength(1);const binding=readFileSync(join(root,'profiles','cursor',cursorBinding.connectionProfileId!,`session-${cursorBinding.nativeSessionId}.json`),'utf8');expect(binding).toContain(cursorBinding.nativeSessionId);expect(binding).not.toContain('cursor-host-death-private-canary');}
  if (claudeBinding) {
    expect(claudeBinding.runtimeId).toBe('claude');
    const history = JSON.parse(readFileSync(join(root,'profiles','claude','fixture-history.json'),'utf8'));
    expect(Object.keys(history)).toEqual([claudeBinding.nativeSessionId]); expect(history[claudeBinding.nativeSessionId]).toHaveLength(1);
  }
  expect(exited).toBe(true); expect(listeners.size).toBe(0); expect(a.nativeSessionId).not.toBe(b.nativeSessionId); expect(a.connectionProfileId).toBe(profile.id);
  const requests = readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-requests.jsonl'), 'utf8'); expect(requests.match(/thread\/start/g)).toHaveLength(2); const history = JSON.parse(readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-history.json'), 'utf8')); expect(Object.values(history).map(value => (value as { turns: unknown[] }).turns.length)).toEqual([1, 1]);
  expect(b.runtimeId).toBe('opencode'); expect(b.connectionProfileId).toBe(otherProfile.id); const otherHistory = JSON.parse(readFileSync(join(root, 'profiles', 'opencode', otherProfile.id, 'fixture-sessions.json'), 'utf8')); expect(Object.values(otherHistory).map(value => (value as { messages: unknown[] }).messages.length)).toEqual([2]);
}, 15000);
