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
it('actual whole-host death settles two native streams including a pending approval and preserves immutable bindings without replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'specops-host-death-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'native.cjs'); writeFileSync(executable, threadFixture, { mode: 0o700 });
  const hostDir = resolve('host'); const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: hostDir, encoding: 'utf8' }); expect(built.status).toBe(0);
  const host = spawn(process.execPath, [join(hostDir, 'dist/index.js')], { detached: true, env: { ...process.env, SPECOPS_CODEX_EXECUTABLE: executable, SPECOPS_PROFILE_ROOT: join(root, 'profiles') } });
  cleanup.push(() => { try { process.kill(-host.pid!, 'SIGKILL'); } catch {} });
  let exited = false; let id = 0; let carry = ''; const listeners = new Set<(value: unknown) => void>(); const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  host.on('exit', () => { exited = true; for (const request of pending.values()) request.reject(new Error('Host exited')); pending.clear(); });
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
  const a = await client.createSession({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: profile.id }); const b = await client.createSession({ runtimeId: 'codex', workspaceRootPath: root, connectionProfileId: profile.id });
  const first = client.sendTurn({ native: a, turnId: asSpecOpsTurnId('turn-a'), workspaceRootPath: root, prompt: 'approval' })[Symbol.asyncIterator]();
  let event = await first.next(); while (event.value?.type !== 'permission.requested') event = await first.next();
  const second = client.sendTurn({ native: b, turnId: asSpecOpsTurnId('turn-b'), workspaceRootPath: root, prompt: 'cancel' })[Symbol.asyncIterator](); await second.next();
  const failedA = expect(first.next()).rejects.toThrow(/Host.*(?:exited|stopped)/); const failedB = (async () => { try { for (;;) { const value = await second.next(); if (value.done) break; } throw new Error('unexpected completion'); } catch (error) { expect(String(error)).toMatch(/Host.*(?:exited|stopped)/); } })();
  host.kill('SIGKILL'); await failedA; await failedB;
  expect(exited).toBe(true); expect(listeners.size).toBe(0); expect(a.nativeSessionId).not.toBe(b.nativeSessionId); expect(a.connectionProfileId).toBe(profile.id);
  const requests = readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-requests.jsonl'), 'utf8'); expect(requests.match(/thread\/start/g)).toHaveLength(2); const history = JSON.parse(readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-history.json'), 'utf8')); expect(Object.values(history).map(value => (value as { turns: unknown[] }).turns.length)).toEqual([1, 1]);
}, 15000);

it('actual whole-host death settles Codex and OpenCode streams together without replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'specops-host-death-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'native.cjs'); writeFileSync(executable, threadFixture, { mode: 0o700 });
  const openExecutable = join(root, 'native.mjs'); copyFileSync(resolve('host/src/opencode/nativeFixture.mjs'), openExecutable); chmodSync(openExecutable, 0o700);
  const hostDir = resolve('host'); const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: hostDir, encoding: 'utf8' }); expect(built.status).toBe(0);
  const host = spawn(process.execPath, [join(hostDir, 'dist/index.js')], { detached: true, env: { ...process.env, SPECOPS_CODEX_EXECUTABLE: executable, SPECOPS_OPENCODE_EXECUTABLE: openExecutable, SPECOPS_PROFILE_ROOT: join(root, 'profiles') } });
  cleanup.push(() => { try { process.kill(-host.pid!, 'SIGKILL'); } catch {} });
  let exited = false; let id = 0; let carry = ''; const listeners = new Set<(value: unknown) => void>(); const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  host.on('exit', () => { exited = true; for (const request of pending.values()) request.reject(new Error('Host exited')); pending.clear(); });
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
  const failedA = expect(first.next()).rejects.toThrow(/Host.*(?:exited|stopped)/); const failedB = (async () => { try { for (;;) { const value = await second.next(); if (value.done) break; } throw new Error('unexpected completion'); } catch (error) { expect(String(error)).toMatch(/Host.*(?:exited|stopped)/); } })();
  host.kill('SIGKILL'); await failedA; await failedB;
  expect(exited).toBe(true); expect(listeners.size).toBe(0); expect(a.nativeSessionId).not.toBe(b.nativeSessionId); expect(a.connectionProfileId).toBe(profile.id);
  const requests = readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-requests.jsonl'), 'utf8'); expect(requests.match(/thread\/start/g)).toHaveLength(2); const history = JSON.parse(readFileSync(join(root, 'profiles', profile.id, 'home', 'fixture-history.json'), 'utf8')); expect(Object.values(history).map(value => (value as { turns: unknown[] }).turns.length)).toEqual([1, 1]);
  expect(b.runtimeId).toBe('opencode'); expect(b.connectionProfileId).toBe(otherProfile.id); const otherHistory = JSON.parse(readFileSync(join(root, 'profiles', 'opencode', otherProfile.id, 'fixture-sessions.json'), 'utf8')); expect(Object.values(otherHistory).map(value => (value as { messages: unknown[] }).messages.length)).toEqual([2]);
}, 15000);
