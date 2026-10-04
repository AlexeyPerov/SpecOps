import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRuntimeAdapter } from './adapter';
import { CODEX_VERSION, resolveCodexExecutable } from './transport';

/** Isolated feasibility only. Experimental opt-in sends one account-free history marker; no login, secrets or default-home reads. */
export async function probe(): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'specops-codex-probe-'));
  const executable = resolveCodexExecutable();
  const experimental = process.env.SPECOPS_PROBE_EXPERIMENTAL === 'true';
  const adapter = new CodexRuntimeAdapter({ profileRoot: temporary, executable, experimental });
  try {
    const profile = adapter.store.create('No-account feasibility');
    const c = await adapter.connect(profile.id);
    const methods: Record<string, string> = { initialize: 'supported', initialized: 'supported', 'account/read': c.snapshot.state };
    for (const [method, params] of [ ['account/login/cancel', { loginId: '00000000-0000-4000-8000-000000000000' }], ['account/logout', {}], ['model/list', { limit: 1 }], ['thread/list', { limit: 1 }] ] as const) {
      try { await c.transport!.request(method, params, 10000); methods[method] = 'supported'; } catch (error) { methods[method] = error instanceof Error ? error.message : 'unavailable'; }
    }
    const workspace = join(temporary, 'workspace'); mkdirSync(workspace);
    try {
      const start = await c.transport!.request('thread/start', { cwd: workspace, model: 'gpt-5.4', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', ephemeral: false, ...(experimental ? { historyMode: 'legacy' } : {}) });
      if (start && typeof start === 'object' && 'thread' in start) {
        const thread = (start as { thread: { id: string } }).thread;
        methods['thread/start'] = 'supported without account';
        if (experimental) {
          const turn = await c.transport!.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Local protocol marker. Do not use tools.', text_elements: [] }] });
          methods['turn/start'] = turn && typeof turn === 'object' && 'turn' in turn ? 'accepted without account; inference not accepted' : 'invalid';
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        for (const [method, params] of [['thread/read', { threadId: thread.id, includeTurns: experimental }], ['thread/resume', { threadId: thread.id, cwd: workspace, approvalsReviewer: 'user', excludeTurns: !experimental }], ['thread/turns/list', { threadId: thread.id, limit: 1 }], ['thread/items/list', { threadId: thread.id, limit: 1 }]] as const) {
          try { const raw = await c.transport!.request(method, params); methods[method] = raw && typeof raw === 'object' && 'thread' in raw ? 'supported without account' : 'supported metadata/list'; } catch (error) { methods[method] = error instanceof Error ? error.message : 'unavailable'; }
        }
      }
    } catch (error) { methods['thread/start'] = error instanceof Error ? error.message : 'unavailable'; }
    console.log(JSON.stringify({ version: CODEX_VERSION, executable, generation: c.transport!.generation, experimental, isolatedHome: true, methods, login: 'not attempted', deviceAndApiKey: 'pinned generated contracts; no live authentication' }, null, 2));
  } finally { adapter.close(); rmSync(temporary, { recursive: true, force: true }); }
}
