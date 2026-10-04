import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRuntimeAdapter } from './adapter';
import { ProfileStore, isolatedEnvironment } from './profiles';
import { CodexTransport } from './transport';
import { controlPlaneFixture } from './fixtures';
import type { ProfileAuthUpdate } from '../../../src/lib/session/profiles';
import { nativeRoutingKey } from '../../../src/lib/session/profiles';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function temporary(): string { const path = mkdtempSync(join(tmpdir(), 'specops-codex-test-')); cleanup.push(() => rmSync(path, { recursive: true, force: true })); return path; }
function fixture(): string { const path = join(temporary(), 'codex-fixture'); writeFileSync(path, controlPlaneFixture, { mode: 0o700 }); return path; }
function adapter(options: ConstructorParameters<typeof CodexRuntimeAdapter>[0] = {}) {
  const runtime = new CodexRuntimeAdapter({ profileRoot: temporary(), executable: fixture(), experimental: true, openBrowser: async () => {}, ...options }); cleanup.push(() => runtime.close()); return runtime;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

describe('isolated profiles', () => {
  it('owns a private home and only nonsecret metadata; default home remains unchanged', () => {
    const root = temporary(); const desktop = join(root, 'desktop-auth'); writeFileSync(desktop, 'DESKTOP-A-CANARY');
    const store = new ProfileStore(join(root, 'profiles')); const profile = store.create('Account B');
    expect(readFileSync(desktop, 'utf8')).toBe('DESKTOP-A-CANARY');
    expect(readFileSync(join(store.home(profile.id), 'config.toml'), 'utf8')).toContain('cli_auth_credentials_store = "file"');
    expect(statSync(store.home(profile.id)).mode & 0o777).toBe(0o700);
    expect(statSync(join(store.home(profile.id), 'config.toml')).mode & 0o777).toBe(0o600);
    expect(store.list()).toEqual([profile]);
    expect(existsSync(join(store.home(profile.id), 'auth.json'))).toBe(false);
  });
  it('rejects traversal and symlink credentials/profile directories', () => {
    const store = new ProfileStore(temporary()); expect(() => store.home('../default')).toThrow();
    const profile = store.create('B'); const outside = temporary();
    symlinkSync(join(outside, 'secret'), join(store.home(profile.id), 'auth.json'));
    expect(() => store.secure(profile.id)).toThrow('Unsafe');
    symlinkSync(outside, join(store.root, 'profile-link'));
    expect(() => store.list()).toThrow('Unsafe');
  });
  it('removes ambient credentials and provider overrides, preserving tool environment', () => {
    expect(isolatedEnvironment('/private/b', { HOME: '/desktop', PATH: '/tools', WORKSPACE_FIXTURE: 'kept', CODEX_HOME: '/desktop/.codex', OPENAI_API_KEY: 'KEY-CANARY', OPENAI_BASE_URL: 'https://wrong', CODEX_API_KEY: 'KEY-CANARY', CODEX_SQLITE_HOME: '/desktop/db', CHATGPT_TOKEN: 'TOKEN-CANARY', AWS_PROFILE: 'wrong' })).toEqual({ HOME: '/desktop', PATH: '/tools', WORKSPACE_FIXTURE: 'kept', CODEX_HOME: '/private/b' });
  });
});
describe('pinned child transport', () => {
  it('uses native initialize/initialized, selected home, bounded unsupported version and init errors', async () => {
    const home = temporary(); const executable = fixture();
    const transport = new CodexTransport(executable, home, { ...process.env, OPENAI_API_KEY: 'KEY-CANARY', CODEX_API_KEY: 'KEY-CANARY', WORKSPACE_FIXTURE: 'kept' }); cleanup.push(() => transport.close());
    await transport.start(); expect(transport.generation).toBe(1);
    expect(await transport.request('fixture/env')).toMatchObject({ CODEX_HOME: home, OPENAI_API_KEY: null, CODEX_API_KEY: null, WORKSPACE_FIXTURE: 'kept' });
    const wrong = new CodexTransport(executable, home, { ...process.env, SPECOPS_FIXTURE_VERSION: '0.0.0' }); cleanup.push(() => wrong.close());
    await expect(wrong.start()).rejects.toThrow('incompatible');
    const malformed = new CodexTransport(executable, home, { ...process.env, SPECOPS_FIXTURE_BAD_INIT: '1' }); cleanup.push(() => malformed.close());
    await expect(malformed.start()).rejects.toThrow('initialization');
    await expect(transport.request('fixture/large', { text: 'a'.repeat(1024 * 1024) })).rejects.toThrow('limit');
  });
  it('cancel during version probe prevents late spawn; restart retires profile descendants', async () => {
    const cancelled = new CodexTransport(fixture(), temporary(), { ...process.env, SPECOPS_FIXTURE_SLOW_VERSION: '1' }); cleanup.push(() => cancelled.close());
    const starting = cancelled.start(); cancelled.close(); await expect(starting).rejects.toThrow('cancelled'); expect(cancelled.running).toBe(false); expect(cancelled.generation).toBe(0);
    const transport = new CodexTransport(fixture(), temporary()); cleanup.push(() => transport.close()); await transport.start();
    const raw = await transport.request('fixture/descendant') as { pid: number }; transport.close(); await tick();
    let state = ''; try { state = execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(raw.pid)], { encoding: 'utf8' }).trim(); } catch {}
    expect(state === '' || state.startsWith('Z')).toBe(true);
  });
  it('restarts one profile without touching another child and increments generation', async () => {
    const a = new CodexTransport(fixture(), temporary()); const b = new CodexTransport(fixture(), temporary()); cleanup.push(() => { a.close(); b.close(); });
    await Promise.all([a.start(), b.start()]); a.close(); await a.start();
    expect(a.generation).toBe(2); expect(b.generation).toBe(1); expect(await b.request('account/read')).toMatchObject({ account: null });
  });
});
describe('profile auth control plane', () => {
  it('reports missing runtime without overwriting credentials', async () => {
    const runtime = adapter({ executable: null }); const p = runtime.store.create('B');
    await expect(runtime.authenticate({ runtimeId: 'codex', workspaceRootPath: '', connectionProfileId: p.id })).rejects.toThrow('Install Codex');
    const list = await runtime.authenticate({ runtimeId: 'codex', workspaceRootPath: '', options: { action: 'list-profiles' } });
    expect(list.profiles?.[0]?.state).toBe('missing-runtime');
  });
  it('browser-open remains pending; stale login and generation updates cannot authenticate it', async () => {
    const opened: string[] = []; const runtime = adapter({ openBrowser: async url => { opened.push(url); } }); const p = runtime.store.create('B');
    const updates: ProfileAuthUpdate[] = []; runtime.onAuthUpdate = update => updates.push(update);
    const request = { runtimeId: 'codex' as const, workspaceRootPath: '', connectionProfileId: p.id };
    const first = await runtime.authenticate({ ...request, options: { action: 'login-browser' } });
    expect(first.profile?.state).toBe('login-pending'); expect(first.status).toBe('challenge'); expect(first.profile?.account).toBeUndefined();
    const second = await runtime.authenticate({ ...request, options: { action: 'login-browser' } });
    const c = await runtime.connect(p.id);
    c.transport!.onNotification('account/login/completed', { loginId: first.profile!.loginId, success: true }, c.transport!.generation);
    c.transport!.onNotification('account/login/completed', { loginId: second.profile!.loginId, success: true }, c.transport!.generation - 1);
    await tick(); expect(c.snapshot.state).toBe('login-pending');
    await c.transport!.request('fixture/complete', { loginId: second.profile!.loginId }); await tick();
    expect(c.snapshot.account).toEqual({ type: 'chatgpt', email: 'profile@example.test', planType: 'plus' });
    expect(JSON.stringify(updates) + JSON.stringify(first)).not.toContain('AUTH-URL-CANARY'); expect(opened).toHaveLength(2);
    await runtime.authenticate({ ...request, options: { action: 'logout' } }); expect(c.snapshot.state).toBe('auth-required');
  });
  it('cancel closes only selected login; opener failure recovers without exposing URL', async () => {
    const runtime = adapter({ openBrowser: async () => { throw new Error('SECRET-AUTH-URL-CANARY'); } }); const p = runtime.store.create('B');
    const request = { runtimeId: 'codex' as const, workspaceRootPath: '', connectionProfileId: p.id };
    await expect(runtime.authenticate({ ...request, options: { action: 'login-browser' } })).rejects.toThrow('Retry sign-in');
    const result = await runtime.authenticate({ ...request, options: { action: 'cancel' } });
    expect(result.profile?.loginId).toBeUndefined(); expect(result.profile?.state).toBe('auth-required'); expect(JSON.stringify(result)).not.toContain('CANARY');
  });
  it('resolves API key from private broker file, removes import file and creates scoped session', async () => {
    const runtime = adapter(); const a = runtime.store.create('A'); const b = runtime.store.create('B');
    for (const p of [a, b]) {
      const path = join(runtime.store.home(p.id), 'api-key'); writeFileSync(path, 'sk-API-KEY-CANARY', { mode: 0o644 });
      const result = await runtime.authenticate({ runtimeId: 'codex', connectionProfileId: p.id, workspaceRootPath: '', options: { action: 'login-api-key' }, credential: { kind: 'api-key', ref: 'profile-api-key' } });
      expect(result.status).toBe('authenticated'); expect(JSON.stringify(result)).not.toContain('CANARY'); expect(existsSync(path)).toBe(false);
    }
    const first = await runtime.createSession({ runtimeId: 'codex', workspaceRootPath: '/workspace', connectionProfileId: a.id });
    const second = await runtime.createSession({ runtimeId: 'codex', workspaceRootPath: '/workspace', connectionProfileId: b.id });
    expect(first.nativeSessionId).toBe(second.nativeSessionId);
    expect(nativeRoutingKey('codex', a.id, first.nativeSessionId)).not.toBe(nativeRoutingKey('codex', b.id, second.nativeSessionId));
    const models = await runtime.listModels({ connectionProfileId: b.id }); expect(models).toHaveLength(1);
    await runtime.authenticate({ runtimeId: 'codex', connectionProfileId: b.id, workspaceRootPath: '', options: { action: 'logout' } });
    expect((await runtime.connect(a.id)).snapshot.state).toBe('authenticated');
  });
  it('returns the exact created profile and device-code flow keeps code out of snapshots', async () => {
    const codes: string[] = []; const runtime = adapter({ displayDeviceCode: async code => { codes.push(code); } });
    runtime.store.create('Existing');
    const created = await runtime.authenticate({ runtimeId: 'codex', workspaceRootPath: '', options: { action: 'create-profile', label: 'New' } });
    expect(created.profile?.label).toBe('New'); expect(created.profiles?.some(p => p.id === created.profile?.id)).toBe(true);
    const result = await runtime.authenticate({ runtimeId: 'codex', workspaceRootPath: '', connectionProfileId: created.profile!.id, options: { action: 'login-device' } });
    expect(codes).toEqual(['DEVICE-CANARY']); expect(result.profile?.state).toBe('login-pending'); expect(JSON.stringify(result)).not.toContain('DEVICE-CANARY');
  });
  it('unknown additive notices are bounded, malformed required account notice fails explicitly', async () => {
    const runtime = adapter(); const p = runtime.store.create('B'); const c = await runtime.connect(p.id);
    for (let i = 0; i < 150; i++) c.transport!.onNotification('future/additive', { secret: 'TOKEN-CANARY' }, c.transport!.generation);
    expect(c.transport!.unknownNotifications).toBe(100);
    c.transport!.onNotification('account/updated', { authMode: { invalid: 'TOKEN-CANARY' } }, c.transport!.generation); await tick();
    expect(c.snapshot.state).toBe('error'); expect(JSON.stringify(c.snapshot)).not.toContain('CANARY');
  });
});

describe('profile-scoped usage and recovery', () => {
  it('isolates sparse updates, stale generations, logout and reauthentication across two profiles', async () => {
    const runtime = adapter(); const a = runtime.store.create('A'); const b = runtime.store.create('B');
    const login = async (id: string) => { writeFileSync(join(runtime.store.home(id), 'api-key'), 'synthetic-private-key', { mode: 0o600 }); await runtime.authenticate({ runtimeId: 'codex', connectionProfileId: id, workspaceRootPath: '', credential: { kind: 'api-key', ref: 'profile-api-key' }, options: { action: 'login-api-key' } }); };
    await login(a.id); await login(b.id);
    const ca = await runtime.connect(a.id); const cb = await runtime.connect(b.id);
    await ca.transport!.request('fixture/notify', { method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'coding', primary: { usedPercent: 12, resetsAt: 123 } } } }); await tick();
    await cb.transport!.request('fixture/notify', { method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'coding', rateLimitReachedType: 'rate_limit_reached' } } }); await tick();
    expect(ca.snapshot.usage?.limits.coding?.primary?.usedPercent).toBe(12); expect(ca.snapshot.recovery).toBeUndefined(); expect(cb.snapshot.recovery).toBe('quota');
    const oldGeneration = cb.transport!.generation;
    await runtime.authenticate({ runtimeId: 'codex', connectionProfileId: b.id, workspaceRootPath: '', options: { action: 'logout' } });
    expect(cb.snapshot.state).toBe('auth-required'); expect(cb.snapshot.usage).toBeUndefined(); expect(ca.snapshot.state).toBe('authenticated');
    await login(b.id); expect(cb.snapshot.usage).toBeUndefined(); expect(cb.snapshot.recovery).toBeUndefined();
    cb.transport!.onNotification('account/rateLimits/updated', { rateLimits: { limitId: 'coding', spendControlReached: true } }, oldGeneration); await tick();
    expect(cb.snapshot.usage).toBeUndefined(); expect(ca.snapshot.usage?.limits.coding?.primary?.usedPercent).toBe(12);
  });
  it('optional session schema does not write profile/global defaults and validation rejects arbitrary scopes', async () => {
    const runtime = adapter(); const profile = runtime.store.create('Settings');
    const configPath = join(runtime.store.home(profile.id), 'config.toml'); const original = readFileSync(configPath, 'utf8');
    const schema = await runtime.describeSessionConfiguration({ connectionProfileId: profile.id }); expect(schema.scope).toBe('session'); expect(schema.fields.map(f => f.id)).toEqual(['effort', 'sandbox', 'approvalPolicy']);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
    const { settings } = await import('./settings'); expect(() => settings({ scope: 'global', effort: 'medium' })).toThrow('scope'); expect(() => settings({ sandbox: 'unknown' })).toThrow();
  });
});
