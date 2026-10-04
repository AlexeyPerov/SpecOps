import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OpenCodeRuntimeAdapter } from './adapter';
import { NATIVE_VIEWS } from '../../../src/lib/session/adapter/nativeExtensions';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
import { extensionScrubber, projectRows } from './extensions';
import { boundedResponse, CONTROL_RESPONSE_LIMIT } from './boundedResponse';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
async function setup(executable = fileURLToPath(new URL('./nativeFixture.mjs', import.meta.url))) {
  const root = mkdtempSync(join(tmpdir(), 'specops-extensions-'));
  const adapter = new OpenCodeRuntimeAdapter({ profileRoot: join(root, 'profiles'), executable });
  cleanup.push(() => { adapter.close(); rmSync(root, { recursive: true, force: true }); });
  const profile = adapter.store.create('Extensions');
  const native = await adapter.createSession({ runtimeId: 'opencode', connectionProfileId: profile.id, workspaceRootPath: root, modelId: 'fixture/model', modeId: 'build' });
  return { adapter, profile, root, input: { native, workspaceRootPath: root } };
}
describe('native optional extensions', () => {
  it('hydrates all finite views from pinned native HTTP contracts and preserves commands hints/status/diffs', async () => {
    const { adapter, input } = await setup();
    for (const view of NATIVE_VIEWS) { try { expect((await adapter.inspectNative({ ...input, view })).generation).toBe(1); } catch { throw new Error(`Failed native view ${view}`); } }
    expect((await adapter.inspectNative({ ...input, view: 'commands' })).rows[0]?.detail).toContain('hints: path');
    expect((await adapter.inspectNative({ ...input, view: 'todos' })).rows[0]?.detail).toContain('status: pending');
    expect((await adapter.inspectNative({ ...input, view: 'diffs' })).rows[0]?.detail).toContain('after: new code');
    await adapter.actNative({ ...input, action: 'connectToolServer', target: 'local' });
    await adapter.actNative({ ...input, action: 'disconnectToolServer', target: 'local' });
    await expect(adapter.actNative({ ...input, action: 'connectToolServer', target: 'unknown' })).rejects.toThrow();
  });
  it('forks a fresh bound child, parent survives restart, share revokes, and revert explicitly reconciles native history', async () => {
    const { adapter, input } = await setup();
    for await (const _event of adapter.send({ ...input, turnId: asSpecOpsTurnId('turn'), prompt: 'hello' })) { /* native fixture completes */ }
    const parent = await adapter.resumeSession(input);
    expect(parent.history).toHaveLength(2);
    const fork = await adapter.actNative({ ...input, action: 'fork' });
    expect(fork.native?.nativeSessionId).not.toBe(input.native.nativeSessionId);
    expect(fork.native?.runtimeMetadata?.parentNativeSessionId).toBe(input.native.nativeSessionId);
    expect((await adapter.resumeSession({ ...input, native: fork.native! })).history).toHaveLength(2);
    expect((await adapter.actNative({ ...input, action: 'share' })).url).toBe('https://example.com/s/fixture');
    await adapter.actNative({ ...input, action: 'revokeShare' });
    const target = parent.history![0]!.nativeTurnId!;
    await adapter.actNative({ ...input, action: 'revert', target });
    expect((await adapter.resumeSession(input)).history).toHaveLength(0);
    await adapter.actNative({ ...input, action: 'restore' });
    expect((await adapter.resumeSession(input)).history).toHaveLength(2);
  });
  it('fails unsupported actions, wrong bindings, external endpoints and active turns before mutation', async () => {
    const { adapter, input } = await setup();
    await expect(adapter.actNative({ ...input, action: 'summarize' as any })).rejects.toThrow('Unsupported');
    await expect(adapter.inspectNative({ ...input, native: { ...input.native, modelId: 'other/model' }, view: 'todos' })).rejects.toThrow();
    const stream = adapter.send({ ...input, turnId: asSpecOpsTurnId('held'), prompt: 'hold' })[Symbol.asyncIterator]();
    await stream.next();
    await expect(adapter.actNative({ ...input, action: 'share' })).rejects.toThrow('Stop');
    await adapter.cancel({ native: input.native }); await stream.return?.(undefined);
  });
  it('holds a profile reservation across awaits and rejects stale reads before the next native call', async () => {
    const { adapter, input, profile, root } = await setup();
    const c = await adapter.connect(profile.id);
    const originalStatus = c.client!.session.status.bind(c.client!.session);
    let release!: () => void; let started!: () => void;
    const waiting = new Promise<void>(resolve => started = resolve);
    const held = new Promise<void>(resolve => release = resolve);
    c.client!.session.status = (async (...args: any[]) => { started(); await held; return originalStatus(...args); }) as any;
    const action = adapter.actNative({ ...input, action: 'share' });
    await waiting;
    await expect(adapter.send({ ...input, turnId: asSpecOpsTurnId('blocked'), prompt: 'hello' })[Symbol.asyncIterator]().next()).rejects.toThrow('action is active');
    await expect(adapter.createSession({ runtimeId: 'opencode', connectionProfileId: profile.id, workspaceRootPath: root })).rejects.toThrow('action is active');
    await expect(adapter.actNative({ ...input, action: 'share' })).rejects.toThrow('Stop');
    release(); await action;
    let resolveLsp!: (v: any) => void;
    c.client!.lsp.status = (() => new Promise(resolve => resolveLsp = resolve)) as any;
    const formatter = vi.spyOn(c.client!.formatter, 'status');
    const read = adapter.inspectNative({ ...input, view: 'languageServices' });
    await vi.waitFor(() => expect(resolveLsp).toBeDefined());
    c.close(); resolveLsp({ data: [] });
    await expect(read).rejects.toThrow('expired');
    expect(formatter).not.toHaveBeenCalled();
  });
  it('reserves authentication mutations before their connect await', async () => {
    const { adapter, input, profile } = await setup();
    const original = adapter.connect.bind(adapter);
    let release!: () => void; let started!: () => void;
    const waiting = new Promise<void>(resolve => started = resolve);
    const held = new Promise<void>(resolve => release = resolve);
    adapter.connect = async id => { started(); await held; return original(id); };
    const auth = adapter.authenticate({ workspaceRootPath: input.workspaceRootPath, runtimeId: 'opencode', connectionProfileId: profile.id, options: { action: 'logout', providerId: 'fixture' } });
    await waiting;
    await expect(adapter.actNative({ ...input, action: 'share' })).rejects.toThrow('Stop');
    await expect(adapter.send({ ...input, turnId: asSpecOpsTurnId('auth-held'), prompt: 'hello' })[Symbol.asyncIterator]().next()).rejects.toThrow('action is active');
    release(); await auth;
    adapter.connect = original;
    expect((await adapter.inspectNative({ ...input, view: 'todos' })).rows).toHaveLength(1);
  });
  it('scrubs private credentials before checkpoint label truncation', async () => {
    const { adapter, input, profile } = await setup();
    const key = "CanaryConfidentialPrivateCredential";
    writeFileSync(join(adapter.store.home(profile.id), 'data', 'opencode', 'auth.json'), JSON.stringify({ fixture: { type: 'api', key } }), { mode: 0o600 });
    for await (const _event of adapter.send({ ...input, turnId: asSpecOpsTurnId('canary'), prompt: 'A'.repeat(232) + key })) { /* test profile only */ }
    const view = await adapter.inspectNative({ ...input, view: 'checkpoints' });
    expect(JSON.stringify(view)).not.toContain('CanaryCo');
    expect(view.rows[0]?.label.length).toBeLessThanOrEqual(240);
  });
  it('redacts exact non-shaped credentials and object names, rejects oversized and unsafe private storage', async () => {
    const { adapter, profile } = await setup();
    const secret = 'innocent-looking-private-value';
    writeFileSync(join(adapter.store.home(profile.id), 'data', 'opencode', 'auth.json'), JSON.stringify({ sample: { type: 'api', key: secret } }), { mode: 0o600 });
    const scrub = extensionScrubber(adapter.store, profile.id, ['transport-password']);
    const rows = projectRows({ [secret]: { description: `echo ${secret} transport-password` } }, ['description'], scrub);
    expect(JSON.stringify(rows)).not.toContain(secret); expect(JSON.stringify(rows)).not.toContain('transport-password');
    expect(() => projectRows(Array(257).fill({}), [], scrub)).toThrow();
    expect(() => projectRows([{ after: 'x'.repeat(600000) }], ['after'], scrub)).toThrow();
  });
});
it('bounds chunked and declared native responses before SDK JSON parse and expires stalled bodies', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1024*1024)); }, cancel() { cancelled = true; } });
  await expect(boundedResponse(new Response(body), AbortSignal.timeout(1000))).rejects.toThrow('capacity');
  expect(cancelled).toBe(true);
  await expect(boundedResponse(new Response('x', { headers: { 'content-length': String(CONTROL_RESPONSE_LIMIT+1) } }), AbortSignal.timeout(1000))).rejects.toThrow();
  await expect(boundedResponse(new Response(new ReadableStream()), AbortSignal.timeout(10))).rejects.toThrow();
});
it.skipIf(!process.env.SPECOPS_NATIVE_SMOKE)('real isolated no-account native extension metadata/catalogs/fork without provider inference', async () => {
  const { adapter, input } = await setup(process.env.SPECOPS_NATIVE_SMOKE);
  for (const view of NATIVE_VIEWS) expect((await adapter.inspectNative({ ...input, view })).rows).toBeInstanceOf(Array);
  const fork = await adapter.actNative({ ...input, action: 'fork' });
  expect(fork.native?.nativeSessionId).not.toBe(input.native.nativeSessionId);
  expect((await adapter.resumeSession({ ...input, native: fork.native! })).history).toEqual([]);
});
