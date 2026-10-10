import { requireManagedCompatibility, managedEntry } from "../componentRuntime";
import { StringDecoder } from 'node:string_decoder';
import { spawn, execFile, execFileSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { InitializeParams } from './generated/InitializeParams';
import { isolatedEnvironment } from './profiles';

export const CODEX_VERSION = '0.160.0';
/** Secret-safe RPC error classification; native error text is never exposed. */
export class NativeRpcError extends Error {
  readonly missingHistory: boolean;
  constructor(raw: unknown) {
    const code = object(raw) && typeof raw.code === 'number' ? raw.code : 'unknown';
    super(`Codex native request failed (${code}). Retry or reauthenticate the selected profile.`);
    this.missingHistory = object(raw) && typeof raw.message === 'string' && /(?:thread|rollout|history).*(?:not found|missing|does not exist)|missing native history/i.test(raw.message);
  }
}
const LIMIT = 1024 * 1024;
export function resolveCodexExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  requireManagedCompatibility("codex", "0.160.0", "as09-codex-1");
  const managed = managedEntry("codex"); if (managed) return managed;
  if (env.SPECOPS_CODEX_EXECUTABLE) return isAbsolute(env.SPECOPS_CODEX_EXECUTABLE) && existsSync(env.SPECOPS_CODEX_EXECUTABLE) ? env.SPECOPS_CODEX_EXECUTABLE : null;
  for (const directory of (env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    const path = join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (existsSync(path)) return path;
  }
  return null;
}
export async function checkCodexVersion(executable: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(executable, ['--version'], { env, timeout: 5000, maxBuffer: 4096 }, (error, stdout) => {
      if (error || stdout.trim() !== `codex-cli ${CODEX_VERSION}`) reject(new Error(`Codex ${CODEX_VERSION} is required; executable is missing or incompatible.`));
      else resolve();
    });
  });
}
export class CodexTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 0;
  private lifecycle = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private descendants = new Map<number, string>();
  private descendantTimer?: ReturnType<typeof setInterval>;
  private startPromise: Promise<void> | null = null;
  generation = 0;
  unknownNotifications = 0;
  onNotification: (method: string, params: unknown, generation: number) => void = () => {};
  onRequest: (id: string | number, method: string, params: unknown, generation: number) => void = () => {};
  onExit: (generation: number) => void = () => {};
  constructor(readonly executable: string, readonly home: string, private readonly ambient = process.env, private readonly experimental = false) {}
  get running(): boolean { return this.child !== null; }
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    const token = ++this.lifecycle;
    this.startPromise = this.launch(token).catch(error => { if (token === this.lifecycle) this.close(); throw error; });
    return this.startPromise;
  }
  private async launch(token: number): Promise<void> {
    const env = isolatedEnvironment(this.home, this.ambient);
    await checkCodexVersion(this.executable, env);
    if (token !== this.lifecycle) throw new Error('Codex startup was cancelled');
    const child = spawn(this.executable, ['app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="file"', '-c', 'model_provider="openai"', '-c', 'mcp_oauth_credentials_store="file"'], { env, cwd: this.home, stdio: 'pipe' });
    this.child = child;
    this.descendants.clear();
    if (child.pid && process.platform !== 'win32') { this.descendantTimer = setInterval(() => this.pollDescendants(child.pid!), 250); this.descendantTimer.unref(); }
    const generation = ++this.generation;
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    child.stdin.on('error', () => { if (this.child === child) this.close(); });
    child.stderr.on('data', () => {}); // Native stderr can contain auth material; never forward it.
    child.stdout.on('data', chunk => {
      if (this.child !== child || this.generation !== generation) return;
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > LIMIT) { this.close(); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line), generation); } catch { this.close(); return; }
      }
    });
    const retire = (): void => {
      if (this.child !== child) return;
      this.cleanupDescendants(child.pid);
      this.child = null; this.startPromise = null;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex profile process exited; reconnect this profile.')); }
      this.pending.clear(); this.onExit(generation);
    };
    child.on('error', retire); child.on('exit', retire);
    const initialize = { clientInfo: { name: 'specops', title: 'SpecOps', version: '0.3.0' }, capabilities: { experimentalApi: this.experimental, requestAttestation: false, optOutNotificationMethods: null } } satisfies InitializeParams;
    const result = await this.request('initialize', initialize);
    if (token !== this.lifecycle || this.child !== child) throw new Error('Codex initialization was cancelled');
    if (!object(result) || typeof result.userAgent !== 'string') throw new Error('Incompatible Codex initialization payload');
    this.notify('initialized');
  }
  private receive(raw: unknown, generation: number): void {
    if (generation !== this.generation || !this.child) return;
    if (!object(raw)) throw new Error('Malformed native frame');
    if (typeof raw.method === 'string' && (typeof raw.id === 'string' || typeof raw.id === 'number')) {
      this.onRequest(raw.id, raw.method, raw.params, generation);
    } else if (typeof raw.id === 'number') {
      const pending = this.pending.get(raw.id);
      if (!pending) return;
      this.pending.delete(raw.id); clearTimeout(pending.timer);
      if ('error' in raw) pending.reject(new NativeRpcError(raw.error));
      else if ('result' in raw) pending.resolve(raw.result);
      else pending.reject(new Error('Incompatible native response'));
    } else if (typeof raw.method === 'string') {
      if ('id' in raw) throw new Error('Unsupported native server request');
      this.onNotification(raw.method, raw.params, generation);
    } else throw new Error('Malformed native frame');
  }
  respond(id: string | number, result: unknown, generation: number): void {
    if (!this.child || generation !== this.generation) throw new Error('Native interaction generation expired');
    this.child.stdin.write(JSON.stringify({ id, result }) + '\n');
  }
  reject(id: string | number, generation: number): void {
    if (this.child && generation === this.generation) this.child.stdin.write(JSON.stringify({ id, error: { code: -32601, message: 'Unsupported interaction' } }) + '\n');
  }
  notify(method: string, params?: unknown): void { this.child?.stdin.write(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }) + '\n'); }
  request(method: string, params: unknown = {}, timeoutMs = 10000): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('Codex profile process is not running'));
    if (Buffer.byteLength(JSON.stringify(params)) > LIMIT) return Promise.reject(new Error('Codex request exceeds message limit'));
    if (this.child.stdin.writableLength > 4 * LIMIT) return Promise.reject(new Error('Codex output capacity exceeded'));
    if (this.pending.size >= 128) return Promise.reject(new Error('Codex request capacity exceeded'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex request timed out')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Codex transport failed')); } });
    });
  }
  private parseRows(output: string): { pid: number; ppid: number; stamp: string }[] {
    return output.trim().split('\n').flatMap(row => {
      const match = row.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), stamp: match[3]! }] : [];
    });
  }
  private processRows() { return this.parseRows(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 * 1024 })); }
  private pollPending = false;
  private pollDescendants(parent: number): void {
    if (this.pollPending) return; this.pollPending = true;
    const generation = this.generation;
    execFile('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 * 1024 }, (error, output) => {
      this.pollPending = false;
      if (!error && this.child?.pid === parent && this.generation === generation) this.trackRows(parent, this.parseRows(output));
    });
  }
  private trackRows(parent: number, rows: { pid: number; ppid: number; stamp: string }[]): void {
      const parents = new Set([parent, ...rows.filter(row => this.descendants.get(row.pid) === row.stamp).map(row => row.pid)]);
      for (let depth = 0; depth < 64; depth++) {
        let changed = false;
        for (const row of rows) if (parents.has(row.ppid) && row.pid !== process.pid && !parents.has(row.pid)) { parents.add(row.pid); this.descendants.set(row.pid, row.stamp); changed = true; }
        if (!changed) break;
      }
  }
  private cleanupDescendants(parent?: number): void {
    if (this.descendantTimer) clearInterval(this.descendantTimer); this.descendantTimer = undefined;
    try {
      const rows = this.processRows();
      if (parent) this.trackRows(parent, rows);
      // Verify observed birth time before signalling; reduces the risk of signalling a recycled PID.
      for (const row of rows.reverse()) if (this.descendants.get(row.pid) === row.stamp) { try { process.kill(row.pid, 'SIGKILL'); } catch {} }
    } catch {}
    this.descendants.clear();
  }
  close(): void {
    this.lifecycle++;
    const child = this.child;
    if (child) {
      this.child = null;
      this.cleanupDescendants(child.pid);
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000); timer.unref();
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex profile connection closed')); }
      this.pending.clear(); this.onExit(this.generation);
    }
    this.startPromise = null;
  }
}
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
