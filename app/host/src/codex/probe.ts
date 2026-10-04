import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRuntimeAdapter } from './adapter';
import { CODEX_VERSION, resolveCodexExecutable } from './transport';

/** Opt-in feasibility only: no login, secrets, browser, workspace, or default-home reads. */
export async function probe(): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'specops-codex-probe-'));
  const executable = resolveCodexExecutable();
  const adapter = new CodexRuntimeAdapter({ profileRoot: temporary, executable });
  try {
    const profile = adapter.store.create('No-account feasibility');
    const c = await adapter.connect(profile.id);
    const methods: Record<string, string> = { initialize: 'supported', initialized: 'supported', 'account/read': c.snapshot.state };
    for (const [method, params] of [ ['account/login/cancel', { loginId: '00000000-0000-4000-8000-000000000000' }], ['account/logout', {}], ['model/list', { limit: 1 }], ['thread/list', { limit: 1 }] ] as const) {
      try { await c.transport!.request(method, params, 10000); methods[method] = 'supported'; } catch (error) { methods[method] = error instanceof Error ? error.message : 'unavailable'; }
    }
    console.log(JSON.stringify({ version: CODEX_VERSION, executable, generation: c.transport!.generation, isolatedHome: true, methods, login: 'not attempted', deviceAndApiKey: 'pinned generated contracts; no live authentication' }, null, 2));
  } finally { adapter.close(); rmSync(temporary, { recursive: true, force: true }); }
}
