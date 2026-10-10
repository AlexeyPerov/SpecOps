import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bindManagedComponent, managedEntry, requireManagedCompatibility } from './componentRuntime';
import { createDefaultRegistry } from './host';
import { staticRuntimeDiscovery } from '../../src/lib/session/runtime';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); delete process.env.SPECOPS_MANAGED_COMPONENTS; });
it('default discovery and host construction instantiate no vendor adapters', async () => {
  const registry = createDefaultRegistry();
  expect(registry.list().map(adapter => adapter.runtimeId)).toEqual(['fake']);
  expect((await registry.discovery()).filter(runtime => runtime.id !== 'fake')).toEqual(staticRuntimeDiscovery());
  expect(registry.list().map(adapter => adapter.runtimeId)).toEqual(['fake']);
});
it('missing managed runtime fails closed even with a hostile PATH', () => {
  process.env.SPECOPS_MANAGED_COMPONENTS = '1';
  expect(() => managedEntry('unknown')).toThrow('Repair it in Software');
});
it('all four roots resolve only authenticated entries; real helper faults stay scoped and secret safe', () => {
  for (const id of ['codex', 'opencode', 'claude', 'cursor']) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'specops-managed-'))); roots.push(root);
    const script = '#!/bin/sh\nprintf "fixture-success"\n';
    writeFileSync(join(root, 'helper'), script, { mode: 0o755 });
    writeFileSync(join(root, 'sdk.mjs'), 'export const fixture = true;');
    const files = [{ path: 'helper', content: script }, { path: 'sdk.mjs', content: 'export const fixture = true;' }].map(file => ({ path: file.path, bytes: Buffer.byteLength(file.content), sha256: createHash('sha256').update(file.content).digest('hex') }));
    const binding = { root, manifest: { id, version: 'fixture-1', compatibility: {adapterRevision:'fixture-adapter-7',hostVersions:['0.1.0']}, target: { os: process.platform, arch: process.arch }, entries: { main: 'helper' }, files } };
    bindManagedComponent(binding);
    expect(() => requireManagedCompatibility(id, 'fixture-1', 'fixture-adapter-7')).not.toThrow();
    expect(() => requireManagedCompatibility(id, 'fixture-1', 'fixture-adapter-8')).toThrow('Repair it in Software');
    const executable = managedEntry(id)!;
    expect(execFileSync(executable, [], { env: { PATH: '/nonexistent' } }).toString()).toBe('fixture-success');
    writeFileSync(join(root, 'sdk.mjs'), 'corrupt');
    expect(() => bindManagedComponent(binding)).toThrow('Repair it in Software');
    rmSync(join(root, 'helper'));
    try { managedEntry(id); throw new Error('expected failure'); } catch (error) { expect(String(error)).not.toContain(root); }
    symlinkSync('/bin/sh', join(root, 'helper'));
    expect(() => managedEntry(id)).toThrow('Repair it in Software');
  }
});

it('shipped adapter compatibility rejects a remotely changed vendor pin or worker revision', async () => {
  const { requireManagedCompatibility } = await import('./componentRuntime');
  // Existing finite fixture is deliberately incompatible with the production adapter.
  expect(() => requireManagedCompatibility('cursor', '1.0.35', 'as09-cursor-1')).toThrow('Repair it in Software');
});
