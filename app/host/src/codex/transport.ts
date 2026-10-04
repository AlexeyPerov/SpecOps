import { StringDecoder } from 'node:string_decoder';
import { spawn, execFile, execFileSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { InitializeParams } from './generated/InitializeParams';
import { isolatedEnvironment } from './profiles';

export const CODEX_VERSION = '0.160.0';
const LIMIT = 1024 * 1024;
export function resolveCodexExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
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
  private startPromise: Promise<void> | null = null;
  generation = 0;
  unknownNotifications = 0;
  onNotification: (method: string, params: unknown, generation: number) => void = () => {};
  onExit: (generation: number) => void = () => {};
  constructor(readonly executable: string, readonly home: string, private readonly ambient = process.env) {}
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
    const child = spawn(this.executable, ['app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="file"', '-c', 'model_provider="openai"'], { env, cwd: this.home, stdio: 'pipe' });
    this.child = child;
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
      this.child = null; this.startPromise = null;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex profile process exited; reconnect this profile.')); }
      this.pending.clear(); this.onExit(generation);
    };
    child.on('error', retire); child.on('exit', retire);
    const initialize = { clientInfo: { name: 'specops', title: 'SpecOps', version: '0.3.0' }, capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: null } } satisfies InitializeParams;
    const result = await this.request('initialize', initialize);
    if (token !== this.lifecycle || this.child !== child) throw new Error('Codex initialization was cancelled');
    if (!object(result) || typeof result.userAgent !== 'string') throw new Error('Incompatible Codex initialization payload');
    this.notify('initialized');
  }
  private receive(raw: unknown, generation: number): void {
    if (generation !== this.generation || !this.child) return;
    if (!object(raw)) throw new Error('Malformed native frame');
    if (typeof raw.id === 'number') {
      const pending = this.pending.get(raw.id);
      if (!pending) return;
      this.pending.delete(raw.id); clearTimeout(pending.timer);
      if ('error' in raw) pending.reject(new Error(`Codex native request failed (${object(raw.error) && typeof raw.error.code === 'number' ? raw.error.code : 'unknown'}). Retry or reauthenticate the selected profile.`));
      else if ('result' in raw) pending.resolve(raw.result);
      else pending.reject(new Error('Incompatible native response'));
    } else if (typeof raw.method === 'string') {
      if ('id' in raw) throw new Error('Unsupported native server request');
      this.onNotification(raw.method, raw.params, generation);
    } else throw new Error('Malformed native frame');
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
  close(): void {
    this.lifecycle++;
    const child = this.child;
    if (child) {
      this.child = null;
      if (child.pid && process.platform !== 'win32') {
        // Keep the host supervisor's process group while retiring this profile's subtree.
        try {
          const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 * 1024 }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
          const descendants: number[] = [];
          const collect = (parent: number, depth = 0): void => { if (depth > 64) return; for (const [pid, ppid] of rows) if (ppid === parent && pid && pid !== process.pid) { collect(pid, depth + 1); descendants.push(pid); } };
          collect(child.pid);
          for (const pid of descendants) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        } catch {}
      }
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000); timer.unref();
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex profile connection closed')); }
      this.pending.clear(); this.onExit(this.generation);
    }
    this.startPromise = null;
  }
}
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
