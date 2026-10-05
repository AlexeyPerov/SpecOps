import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexTransport } from './transport';
import type { CodexAdapterOptions } from './adapter';
import { CodexRuntimeAdapter } from './adapter';
import { threadFixture } from './threadFixtures';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
import { collectContractEvents } from '../../../src/lib/session/adapter/adapter.contract';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
async function setup(options: Partial<CodexAdapterOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'specops-session-actions-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'fixture.cjs'); writeFileSync(executable, threadFixture, { mode: 0o700 });
  const adapter = new CodexRuntimeAdapter({ executable, profileRoot: join(root, 'profiles'), experimental: true, ...options }); cleanup.push(() => adapter.close());
  const profile = adapter.store.create('Owner');
  const native = await adapter.createSession({ runtimeId: 'codex', connectionProfileId: profile.id, workspaceRootPath: root });
  const request = (prompt: string, id = 'original') => ({ native, workspaceRootPath: root, prompt, turnId: asSpecOpsTurnId(id), context: { clientUserMessageId: `user-${id}` } });
  return { root, adapter, profile, native, request };
}
it('forks native history through a real turn identity, binds child principal and preserves original source after restart', async () => {
  const { root, adapter, profile, native, request } = await setup();
  await collectContractEvents(adapter.send(request('hello')));
  await collectContractEvents(adapter.send(request('second', 'second')));
  const view = await adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' });
  const child = await adapter.actNative({ native, workspaceRootPath: root, action: 'fork', target: view.rows[0]!.id });
  expect(child.native?.nativeSessionId).not.toBe(native.nativeSessionId);
  adapter.close();
  const source = await adapter.resumeSession({ native, workspaceRootPath: root });
  const fork = await adapter.resumeSession({ native: child.native!, workspaceRootPath: root });
  expect(source.history?.filter(m => m.role === 'user')).toHaveLength(2);
  expect(fork.history?.filter(m => m.role === 'user')).toHaveLength(1);
  expect(fork.history?.find(m => m.role === 'user')?.id).toBe('user-original');
  adapter.store.assertSessionIdentity(profile.id, String(child.native!.nativeSessionId), (await adapter.connect(profile.id)).accountIdentity!);
  await expect(adapter.actNative({ native, workspaceRootPath: root, action: 'fork', target: 'invented' })).rejects.toThrow('absent');
});
it('compaction acknowledgment leaves an owned operation pending until native completion; blocks new turns and supports Stop', async () => {
  const { root, adapter, native, request } = await setup();
  const started = await adapter.actNative({ native, workspaceRootPath: root, action: 'compact' });
  expect(started).toMatchObject({ pending: true });
  await expect(collectContractEvents(adapter.send(request('overlap')))).rejects.toThrow('pending');
  let snapshot = await adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' });
  expect(snapshot.operation?.status).toBe('running');
  await new Promise(resolve => setTimeout(resolve, 65));
  snapshot = await adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' });
  expect(snapshot.operation).toMatchObject({ status: 'completed' });
  await adapter.actNative({ native, workspaceRootPath: root, action: 'compact' });
  await new Promise(resolve => setTimeout(resolve, 5));
  await adapter.cancel({ native });
  await new Promise(resolve => setTimeout(resolve, 5));
  expect((await adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' })).operation?.status).toBe('cancelled');
});
it('steers the exact active turn once with stable native user identity; receipt survives host restart and forbids replay', async () => {
  const { root, adapter, native, request, profile } = await setup();
  const iterator = adapter.send(request('cancel'))[Symbol.asyncIterator](); await iterator.next();
  await new Promise(resolve => setTimeout(resolve, 15));
  const input = { native, workspaceRootPath: root, action: 'steer' as const, text: 'continue safely', clientMessageId: 'stable-user-steer' };
  const accepted = await adapter.actNative(input);
  expect(accepted.nativeTurnId).toBe('native-turn-0');
  await expect(adapter.actNative(input)).rejects.toThrow('already dispatched');
  await adapter.cancel({ native }); while (!(await iterator.next()).done) {}
  adapter.close();
  const resumed = await adapter.resumeSession({ native, workspaceRootPath: root });
  expect(resumed.history?.find(m => m.id === input.clientMessageId)).toMatchObject({ content: input.text, nativeTurnId: accepted.nativeTurnId });
  const next = adapter.send(request('cancel', 'next'))[Symbol.asyncIterator](); await next.next(); await new Promise(resolve => setTimeout(resolve, 15));
  await expect(adapter.actNative(input)).rejects.toThrow('already dispatched');
  await adapter.cancel({ native }); while (!(await next.next()).done) {}
  const log = readFileSync(join(adapter.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8');
  expect(log.match(/turn\/steer/g)).toHaveLength(1);
});
it('unsupported rollback and malformed action payloads never call guessed native endpoints; wrong bindings remain isolated', async () => {
  const { root, adapter, native, profile } = await setup();
  await expect(adapter.actNative({ native, workspaceRootPath: root, action: 'rollback', target: 'native-turn-0' })).rejects.toMatchObject({ code: 'capability-not-supported' });
  await expect(adapter.actNative({ native, workspaceRootPath: root, action: 'compact', text: 'unexpected' })).rejects.toThrow('Unexpected');
  await expect(adapter.actNative({ native: { ...native, modelId: 'other' }, workspaceRootPath: root, action: 'fork' })).rejects.toThrow('original binding');
  await expect(adapter.actNative({ native, workspaceRootPath: '/wrong', action: 'fork' })).rejects.toThrow('original binding');
  const log = readFileSync(join(adapter.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8');
  expect(log).not.toMatch(/thread\/(rollback|revert|fork)|thread\/compact/);
});

it.each(['fork', 'steer'] as const)('lost native %s acknowledgment never retries and steering receipt remains durable', async action => {
  let dropped = false;
  class LostAckTransport extends CodexTransport {
    override async request(method: string, params: unknown = {}, timeout?: number) {
      const raw = await super.request(method, params, timeout);
      if (!dropped && method === (action === 'fork' ? 'thread/fork' : 'turn/steer')) { dropped = true; throw new Error('lost acknowledgment'); }
      return raw;
    }
  }
  const { root, adapter, native, request, profile } = await setup({ transportFactory: (executable, home) => new LostAckTransport(executable, home, process.env, true) });
  if (action === 'fork') {
    await collectContractEvents(adapter.send(request('hello')));
    await expect(adapter.actNative({ native, workspaceRootPath: root, action })).rejects.toThrow('uncertain');
    const db = JSON.parse(readFileSync(join(adapter.store.home(profile.id), 'fixture-history.json'), 'utf8'));
    expect(Object.keys(db)).toHaveLength(2); expect(db[native.nativeSessionId].turns).toHaveLength(1);
  } else {
    const iterator = adapter.send(request('cancel'))[Symbol.asyncIterator](); await iterator.next(); await new Promise(resolve => setTimeout(resolve, 15));
    const input = { native, workspaceRootPath: root, action, text: 'accepted without client ack', clientMessageId: 'uncertain-steer' };
    await expect(adapter.actNative(input)).rejects.toThrow('uncertain');
    await expect(adapter.actNative(input)).rejects.toThrow('already dispatched');
    await adapter.cancel({ native }); while (!(await iterator.next()).done) {}
    adapter.close(); const resumed = await adapter.resumeSession({ native, workspaceRootPath: root });
    expect(resumed.history?.filter(m => m.id === 'uncertain-steer')).toHaveLength(1);
  }
  const log = readFileSync(join(adapter.store.home(profile.id), 'fixture-requests.jsonl'), 'utf8');
  expect(log.match(new RegExp(action === 'fork' ? 'thread/fork' : 'turn/steer', 'g'))).toHaveLength(1);
});
it('native checkpoint projection masks exact private credentials before truncation and rejects credential-bearing identities', async () => {
  const { root, adapter, native, profile, request } = await setup();
  const key = JSON.parse(readFileSync(join(adapter.store.home(profile.id), 'auth.json'), 'utf8')).OPENAI_API_KEY;
  await collectContractEvents(adapter.send(request(key)));
  const snapshot = await adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' });
  expect(JSON.stringify(snapshot)).not.toContain(key); expect(snapshot.rows[0]?.label).toBe('[redacted]');
  adapter.close();
  const path = join(adapter.store.home(profile.id), 'fixture-history.json'); const db = JSON.parse(readFileSync(path, 'utf8'));
  db[native.nativeSessionId].turns[0].id = key; writeFileSync(path, JSON.stringify(db));
  await adapter.resumeSession({ native, workspaceRootPath: root });
  await expect(adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' })).rejects.toThrow('Unsafe native checkpoint identity');
});
it('profile process loss fails owned compaction; fresh generation rejects late old completion and starts only explicit new operation', async () => {
  const { root, adapter, native } = await setup();
  const first = await adapter.actNative({ native, workspaceRootPath: root, action: 'compact' });
  const connection = await adapter.connect(native.connectionProfileId); const oldGeneration = connection.transport!.generation;
  connection.transport!.close(); await new Promise(resolve => setTimeout(resolve, 10));
  await adapter.resumeSession({ native, workspaceRootPath: root });
  const failed = await adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' });
  expect(failed.operation?.status).toBe('failed'); expect(failed.generation).toBeGreaterThan(first.generation);
  const second = await adapter.actNative({ native, workspaceRootPath: root, action: 'compact' });
  connection.transport!.onNotification('turn/completed', { threadId: native.nativeSessionId, turn: { id: 'native-compact-0', status: 'completed' } }, oldGeneration);
  const pending = await adapter.inspectNative({ native, workspaceRootPath: root, view: 'checkpoints' });
  expect(pending.operation?.id).toBe(second.operationId); expect(second.operationId).not.toBe(first.operationId); expect(pending.operation?.status).toBe('running');
  await adapter.cancel({ native });
});
