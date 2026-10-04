import type { LoginAccountParams } from './generated/v2/LoginAccountParams';
import type { ModelListParams } from './generated/v2/ModelListParams';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import type { AgentRuntimeAdapter, AgentAuthRequest, AgentAuthResult, CreateAgentSessionRequest, ResumeAgentSessionRequest, NativeSessionRef, AgentTurnRequest, CancelAgentTurnRequest, AdapterHealth } from '../../../src/lib/session/adapter';
import type { CatalogExtension } from '../../../src/lib/session/adapter/extensions';
import type { SessionEvent } from '../../../src/lib/session/events';
import type { ConnectionProfileSnapshot, ProfileAuthUpdate } from '../../../src/lib/session/profiles';
import { asNativeSessionId } from '../../../src/lib/session/ids';
import { ProfileStore, type ConnectionProfile } from './profiles';
import { CodexTransport, CODEX_VERSION, object, resolveCodexExecutable } from './transport';

interface ProfileConnection { profile: ConnectionProfile; transport: CodexTransport | null; snapshot: ConnectionProfileSnapshot; attempt: number; loginId?: string }
export interface CodexAdapterOptions {
  profileRoot?: string;
  executable?: string | null;
  transportFactory?: (executable: string, home: string) => CodexTransport;
  openBrowser?: (url: string) => Promise<void>;
  displayDeviceCode?: (code: string) => Promise<void>;
}
/** Auth URL is never returned to the WebView or logged. Open it in the system browser. */
async function openBrowser(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Unsupported authentication URL');
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => execFile(command, args, { timeout: 5000 }, error => error ? reject(new Error('Could not open authentication browser')) : resolve()));
}
export class CodexRuntimeAdapter implements AgentRuntimeAdapter, CatalogExtension {
  readonly runtimeId = 'codex' as const;
  readonly store: ProfileStore;
  private readonly connections = new Map<string, ProfileConnection>();
  onAuthUpdate: (update: ProfileAuthUpdate) => void = () => {};
  constructor(private readonly options: CodexAdapterOptions = {}) {
    const root = options.profileRoot ?? process.env.SPECOPS_PROFILE_ROOT ?? join(homedir(), 'Library', 'Application Support', 'SpecOps', 'connection-profiles');
    this.store = new ProfileStore(root);
  }
  async describe() { return { id: this.runtimeId, label: 'Codex' }; }
  async describeCapabilities() { return { schemaVersion: 1 as const, supported: ['catalogs'], details: { catalogs: { supported: true }, nativeTurns: { supported: false, notes: 'Native turn support is pending.' } } }; }
  private connection(id: unknown): ProfileConnection {
    const profile = this.store.require(id);
    let connection = this.connections.get(profile.id);
    if (!connection) {
      connection = { profile, transport: null, attempt: 0, snapshot: { ...profile, generation: 0, state: 'disconnected', support: { browser: true, device: process.platform === 'darwin', apiKey: true } } };
      this.connections.set(profile.id, connection);
    }
    return connection;
  }
  private publish(c: ProfileConnection): void {
    this.onAuthUpdate({ runtimeId: 'codex', connectionProfileId: c.profile.id, generation: c.snapshot.generation, profile: { ...c.snapshot } });
  }
  async connect(id: unknown): Promise<ProfileConnection> {
    const c = this.connection(id);
    if (!c.transport) {
      const executable = this.options.executable === undefined ? resolveCodexExecutable() : this.options.executable;
      if (!executable) { c.snapshot.state = 'missing-runtime'; c.snapshot.message = `Install Codex CLI ${CODEX_VERSION} or configure its executable path.`; this.publish(c); throw new Error(c.snapshot.message); }
      c.transport = this.options.transportFactory?.(executable, this.store.home(c.profile.id)) ?? new CodexTransport(executable, this.store.home(c.profile.id));
      c.transport.onExit = generation => {
        c.attempt++; delete c.loginId; delete c.snapshot.loginId; delete c.snapshot.account;
        c.snapshot.generation = generation; c.snapshot.state = 'disconnected'; this.publish(c);
      };
      c.transport.onNotification = (method, params, generation) => { void this.notification(c, method, params, generation).catch(() => { c.snapshot.state = 'error'; c.snapshot.message = 'Incompatible authentication notification'; this.publish(c); }); };
    }
    if (!c.transport.running) {
      c.snapshot.state = 'connecting'; this.publish(c);
      try {
        await c.transport.start(); c.snapshot.generation = c.transport.generation;
        await this.readAccount(c);
      } catch {
        c.snapshot.state = 'incompatible-runtime'; c.snapshot.message = `Could not initialize Codex ${CODEX_VERSION}. Check the executable and reconnect.`;
        this.publish(c); throw new Error(c.snapshot.message);
      }
    } else await c.transport.start();
    return c;
  }
  private async readAccount(c: ProfileConnection): Promise<void> {
    const transport = c.transport!;
    const generation = transport.generation;
    const attempt = c.attempt;
    const raw = await transport.request('account/read', { refreshToken: false });
    if (generation !== transport.generation || attempt !== c.attempt || !transport.running) return;
    if (!object(raw) || typeof raw.requiresOpenaiAuth !== 'boolean' || !('account' in raw)) throw new Error('Incompatible account payload');
    if (raw.account === null) { delete c.snapshot.account; c.snapshot.state = c.loginId ? 'login-pending' : 'auth-required'; }
    else if (object(raw.account) && raw.account.type === 'apiKey') { c.snapshot.account = { type: 'apiKey' }; c.snapshot.state = 'authenticated'; }
    else if (object(raw.account) && raw.account.type === 'chatgpt' && (raw.account.email === null || typeof raw.account.email === 'string') && typeof raw.account.planType === 'string') {
      c.snapshot.account = { type: 'chatgpt', ...(typeof raw.account.email === 'string' ? { email: raw.account.email } : {}), planType: raw.account.planType };
      c.snapshot.state = 'authenticated';
    } else throw new Error('Incompatible account identity');
    delete c.snapshot.message; this.store.secure(c.profile.id); this.publish(c);
  }
  private async notification(c: ProfileConnection, method: string, raw: unknown, generation: number): Promise<void> {
    if (generation !== c.transport?.generation || !c.transport.running) return;
    if (method === 'account/login/completed') {
      if (!object(raw) || typeof raw.success !== 'boolean' || (raw.loginId !== null && typeof raw.loginId !== 'string')) throw new Error('Invalid login completion');
      if (!c.loginId || raw.loginId !== c.loginId || c.snapshot.generation !== generation) return;
      delete c.loginId; delete c.snapshot.loginId;
      if (!raw.success) { c.snapshot.state = 'auth-required'; c.snapshot.message = 'Sign-in did not complete. Retry authentication.'; this.publish(c); }
      else await this.readAccount(c);
    } else if (method === 'account/updated') {
      if (!object(raw) || (raw.authMode !== null && !['apikey', 'chatgpt', 'chatgptAuthTokens', 'headers', 'agentIdentity', 'personalAccessToken', 'bedrockApiKey', 'bedrockAccessKeys'].includes(String(raw.authMode))) || (raw.planType !== null && typeof raw.planType !== 'string')) throw new Error('Invalid account update');
      // A pending attempt is verified only by its matching login completion or explicit refresh.
      if (!c.loginId) await this.readAccount(c);
    } else { c.transport.unknownNotifications = Math.min(100, c.transport.unknownNotifications + 1); }
  }
  async authenticate(request: AgentAuthRequest): Promise<AgentAuthResult> {
    try { return await this.authenticateProfile(request); }
    catch (error) {
      const c = typeof request.connectionProfileId === 'string' ? this.connections.get(request.connectionProfileId) : undefined;
      const message = error instanceof Error ? error.message : 'Authentication failed';
      if (c && !message.includes('superseded') && !['missing-runtime', 'incompatible-runtime', 'auth-required'].includes(c.snapshot.state)) {
        c.snapshot.state = 'error'; c.snapshot.message = 'Authentication failed. Reconnect or retry the selected profile.';
        if (message.includes('-32601')) {
          if (request.options?.action === 'login-device') c.snapshot.support.device = false;
          if (request.options?.action === 'login-browser') c.snapshot.support.browser = false;
          if (request.options?.action === 'login-api-key') c.snapshot.support.apiKey = false;
        }
        this.publish(c);
      }
      throw error;
    }
  }
  private async authenticateProfile(request: AgentAuthRequest): Promise<AgentAuthResult> {
    const action = request.options?.action ?? 'read';
    if (action === 'create-profile') {
      const label = typeof request.options?.label === 'string' ? request.options.label : 'Codex account';
      const profile = this.store.create(label);
      return { status: 'challenge', profile: { ...this.connection(profile.id).snapshot }, profiles: this.store.list().map(profile => ({ ...this.connection(profile.id).snapshot })) };
    }
    if (action === 'list-profiles' || action === 'create-profile') return { status: 'challenge', profiles: this.store.list().map(profile => ({ ...this.connection(profile.id).snapshot })) };
    const c = this.connection(request.connectionProfileId);
    if (action === 'restart') {
      c.transport?.close(); await this.connect(c.profile.id);
    } else {
      await this.connect(c.profile.id);
      if (action === 'logout' || action === 'cancel' || action === 'login-browser' || action === 'login-device' || action === 'login-api-key') {
        c.attempt++;
        const oldLogin = c.loginId; delete c.loginId; delete c.snapshot.loginId;
        if (oldLogin) await c.transport!.request('account/login/cancel', { loginId: oldLogin });
      }
      if (action === 'logout') {
        await c.transport!.request('account/logout'); delete c.snapshot.account; await this.readAccount(c);
      } else if (action === 'login-api-key') {
        if (request.credential?.ref !== 'profile-api-key') throw new Error('Provide a private api-key file in the selected profile home.');
        this.store.secure(c.profile.id);
        const path = join(this.store.home(c.profile.id), 'api-key');
        if (!existsSync(path)) throw new Error('Private API key file is missing');
        const apiKey = readFileSync(path, 'utf8').trim();
        if (!apiKey || apiKey.length > 16384) throw new Error('Invalid private API key file');
        await c.transport!.request('account/login/start', { type: 'apiKey', apiKey } satisfies LoginAccountParams);
        unlinkSync(path); await this.readAccount(c);
      } else if (action === 'login-browser' || action === 'login-device') {
        const attempt = c.attempt;
        const generation = c.transport!.generation;
        const raw = await c.transport!.request('account/login/start', { type: action === 'login-device' ? 'chatgptDeviceCode' : 'chatgpt' } satisfies LoginAccountParams);
        if (attempt !== c.attempt || generation !== c.transport!.generation || !c.transport!.running) throw new Error('Authentication attempt was superseded');
        if (!object(raw) || typeof raw.loginId !== 'string') throw new Error('Incompatible authentication response');
        const url = action === 'login-device' ? raw.verificationUrl : raw.authUrl;
        if (typeof url !== 'string' || (action === 'login-device' && typeof raw.userCode !== 'string')) throw new Error('Incompatible authentication response');
        delete c.snapshot.account;
        c.loginId = raw.loginId; c.snapshot.loginId = raw.loginId; c.snapshot.state = 'login-pending'; c.snapshot.generation = generation;
        const completeOpen = async (): Promise<void> => {
          try {
          // Device code is shown by the host in a system dialog, never serialized into UI snapshots.
          if (action === 'login-device') {
            if (process.platform !== 'darwin') throw new Error('Device-code display is unavailable on this platform; use browser sign-in.');
            const code = String(raw.userCode);
            if (!/^[A-Z0-9-]{1,32}$/.test(code)) throw new Error('Invalid device code');
            if (this.options.displayDeviceCode) await this.options.displayDeviceCode(code);
            else await new Promise<void>((resolve, reject) => execFile('osascript', ['-e', `display dialog "Enter this device code in the browser: ${code}" buttons {"Continue"} default button "Continue"`], { timeout: 60000 }, error => error ? reject(new Error('Device sign-in cancelled')) : resolve()));
          }
          if (attempt !== c.attempt || generation !== c.transport!.generation || !c.transport!.running) throw new Error('Authentication attempt was superseded');
          await (this.options.openBrowser ?? openBrowser)(url);
          if (attempt !== c.attempt || generation !== c.transport!.generation || !c.transport!.running) throw new Error('Authentication attempt was superseded');
          }
          catch { if (attempt === c.attempt && generation === c.transport!.generation) { if (c.loginId) await c.transport!.request('account/login/cancel', { loginId: c.loginId }).catch(() => {}); delete c.loginId; delete c.snapshot.loginId; c.snapshot.state = 'auth-required'; this.publish(c); } throw new Error('Authentication was cancelled or the browser did not open. Retry sign-in.'); }
        };
        this.publish(c);
        if (action === 'login-device') void completeOpen().catch(() => {});
        else await completeOpen();
      } else if (action === 'cancel' || action === 'read') await this.readAccount(c);
      else if (action !== 'logout') throw new Error('Unsupported authentication action');
    }
    return { status: c.snapshot.state === 'authenticated' ? 'authenticated' : 'challenge', profile: { ...c.snapshot } };
  }
  async listModels(input?: { workspaceRootPath?: string; connectionProfileId?: string }) {
    const c = await this.connect(input?.connectionProfileId);
    const raw = await c.transport!.request('model/list', { limit: 100 } satisfies ModelListParams);
    if (!object(raw) || !Array.isArray(raw.data) || raw.data.some(m => !object(m) || typeof m.id !== 'string' || typeof m.displayName !== 'string')) throw new Error('Incompatible model catalog');
    return raw.data.map(m => ({ id: (m as Record<string, string>).id!, name: (m as Record<string, string>).displayName! }));
  }
  async listModes(_input?: { modelId?: string; connectionProfileId?: string }) { return []; }
  async createSession(request: CreateAgentSessionRequest): Promise<NativeSessionRef> {
    const c = await this.connect(request.connectionProfileId);
    if (c.snapshot.state !== 'authenticated') throw new Error('Authenticate the selected Codex profile before creating a session.');
    const raw = await c.transport!.request('thread/start', { cwd: request.workspaceRootPath, ...(request.modelId ? { model: request.modelId } : {}) });
    if (!object(raw) || !object(raw.thread) || typeof raw.thread.id !== 'string') throw new Error('Incompatible native thread response');
    return { runtimeId: 'codex', connectionProfileId: c.profile.id, nativeSessionId: asNativeSessionId(raw.thread.id), ...(typeof raw.model === 'string' ? { modelId: raw.model } : {}) };
  }
  async resumeSession(_request: ResumeAgentSessionRequest): Promise<NativeSessionRef> { throw new Error('Codex resume requires native turn support.'); }
  async *send(_request: AgentTurnRequest): AsyncIterable<SessionEvent> { throw new Error('Codex native turns are not implemented yet.'); }
  async cancel(_request: CancelAgentTurnRequest): Promise<void> {}
  async health(connectionProfileId?: string): Promise<AdapterHealth> {
    if (!connectionProfileId) return { status: (this.options.executable === undefined ? resolveCodexExecutable() : this.options.executable) ? 'degraded' : 'unavailable', runtimeId: 'codex', runtimeVersion: CODEX_VERSION, checkedAt: new Date().toISOString(), message: 'Select a connection profile to check authentication.' };
    try { const c = await this.connect(connectionProfileId); return { status: c.snapshot.state === 'authenticated' ? 'healthy' : 'degraded', runtimeId: 'codex', runtimeVersion: CODEX_VERSION, connectionProfileId, generation: c.snapshot.generation, checkedAt: new Date().toISOString() }; }
    catch { return { status: 'unavailable', runtimeId: 'codex', connectionProfileId, checkedAt: new Date().toISOString(), message: this.connection(connectionProfileId).snapshot.message }; }
  }
  close(): void { for (const c of this.connections.values()) c.transport?.close(); }
}
