import { randomUUID } from 'node:crypto';
import { NativeEcosystem, nativeConfigCredentials } from './ecosystem';
import type { NativeExtensions, NativeExtensionSnapshot, NativeExtensionResult } from '../../../src/lib/session/adapter/nativeExtensions';
import type { ThreadForkParams } from './generated/v2/ThreadForkParams';
import type { TurnSteerParams } from './generated/v2/TurnSteerParams';
import { redactForSerialization, redactSecretStringValue } from '../../../src/lib/session/redact';
import { mergeUsage, usageBlocked, failureRecovery } from './limits';
import { adapterErrors } from '../../../src/lib/session/adapter/errors';
import { NativeTurn } from './turn';
import { settings, validateModel, type NativeSettings } from './settings';
import type { Model } from './generated/v2/Model';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams';
import type { ThreadResumeParams } from './generated/v2/ThreadResumeParams';
import type { TurnStartParams } from './generated/v2/TurnStartParams';
import type { ThreadItem } from './generated/v2/ThreadItem';
import { nativeRoutingKey } from '../../../src/lib/session/profiles';
import { asSpecOpsTurnId } from '../../../src/lib/session/ids';
import type { LoginAccountParams } from './generated/v2/LoginAccountParams';
import type { ModelListParams } from './generated/v2/ModelListParams';
import { unlinkSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import type { AgentRuntimeAdapter, AgentAuthRequest, AgentAuthResult, CreateAgentSessionRequest, ResumeAgentSessionRequest, NativeSessionRef, AgentTurnRequest, CancelAgentTurnRequest, AdapterHealth } from '../../../src/lib/session/adapter';
import type { SessionConfigurationExtension, CatalogExtension, PermissionExtension, QuestionExtension, LifecycleExtension } from '../../../src/lib/session/adapter/extensions';
import type { SessionEvent } from '../../../src/lib/session/events';
import type { ConnectionProfileSnapshot, ProfileAuthUpdate } from '../../../src/lib/session/profiles';
import { asNativeSessionId } from '../../../src/lib/session/ids';
import { ProfileStore, type ConnectionProfile } from './profiles';
import { NativeRpcError, CodexTransport, CODEX_VERSION, object, resolveCodexExecutable } from './transport';

interface ProfileConnection { profile: ConnectionProfile; transport: CodexTransport | null; snapshot: ConnectionProfileSnapshot; attempt: number; loginId?: string; accountIdentity?: string; reauthRequired?: boolean }
export interface CodexAdapterOptions {
  profileRoot?: string;
  executable?: string | null;
  transportFactory?: (executable: string, home: string) => CodexTransport;
  openBrowser?: (url: string) => Promise<void>;
  /** Explicit host opt-in to pinned experimental plan/questions. Disabled by default. */
  experimental?: boolean;
  interactionTimeoutMs?: number;
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
export class CodexRuntimeAdapter implements AgentRuntimeAdapter, SessionConfigurationExtension, CatalogExtension, PermissionExtension, QuestionExtension, LifecycleExtension, NativeExtensions {
  readonly runtimeId = 'codex' as const;
  readonly store: ProfileStore;
  private readonly ecosystem = new NativeEcosystem();
  private readonly controls = new Map<string, NativeExtensionSnapshot["operation"]>();
  private readonly controlReservations = new Map<string, string>();
  private readonly mutations = new Set<string>();
  private readonly connections = new Map<string, ProfileConnection>();
  private readonly turns = new Map<string, NativeTurn>();
  private readonly cursors = new Map<string, number>();
  private readonly sessions = new Map<string, { cwd: string; generation: number; settings: NativeSettings; modelId: string }>();
  private readonly models = new Map<string, Model[]>();
  onAuthUpdate: (update: ProfileAuthUpdate) => void = () => {};
  constructor(private readonly options: CodexAdapterOptions = {}) {
    const root = options.profileRoot ?? process.env.SPECOPS_PROFILE_ROOT ?? join(homedir(), 'Library', 'Application Support', 'SpecOps', 'connection-profiles');
    this.store = new ProfileStore(root);
  }
  async describe() { return { id: this.runtimeId, label: 'Codex' }; }
  async describeCapabilities() { return { schemaVersion: 1 as const, supported: ['catalogs', 'permissions', 'questions', 'nativeExtensions'], details: { nativeExtensions: { supported: true, notes: 'Verified native fork, compact lifecycle, steering, skills and bounded native config/MCP management. Legacy rollback, OAuth and plugin APIs are unavailable.' }, catalogs: { supported: true }, permissions: { supported: true }, questions: { supported: true, notes: 'Requires explicit selected-profile experimental opt-in; otherwise requests are rejected. Secret input is unsupported.' }, nativeTurns: { supported: true }, steer: { supported: true, notes: 'Native active-turn precondition, durable client identity; no fallback or replay.' }, plugins: { supported: false, notes: 'Upstream plugin APIs are under development; production list/read/install/uninstall issue no RPC.' }, mcpOAuth: { supported: false, notes: 'Native file-only credential storage is forced. Interactive OAuth/elicitation lifecycle remains unverified and unavailable.' }, rollback: { supported: false, notes: 'Pinned thread/revert supports paginated history only; selected legacy history cannot safely roll back.' } } }; }
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
    this.onAuthUpdate({ runtimeId: 'codex', connectionProfileId: c.profile.id, generation: c.snapshot.generation, profile: redactForSerialization({ ...c.snapshot }, Infinity) as ConnectionProfileSnapshot });
  }
  async connect(id: unknown): Promise<ProfileConnection> {
    const c = this.connection(id);
    if (!c.transport) {
      const executable = this.options.executable === undefined ? resolveCodexExecutable() : this.options.executable;
      if (!executable) { c.snapshot.state = 'missing-runtime'; c.snapshot.message = `Install Codex CLI ${CODEX_VERSION} or configure its executable path.`; this.publish(c); throw new Error(c.snapshot.message); }
      c.transport = this.options.transportFactory?.(executable, this.store.home(c.profile.id)) ?? new CodexTransport(executable, this.store.home(c.profile.id), process.env, this.options.experimental || c.profile.experimental);
      c.transport.generation = c.snapshot.generation;
      c.transport.onExit = generation => {
        if (this.connections.get(c.profile.id) !== c) return;
        for (const turn of this.turns.values()) if (turn.request.native.connectionProfileId === c.profile.id && turn.generation === generation) turn.finish('turn.failed', 'Native profile process exited; resume explicitly to continue.');
        c.attempt++;
        delete c.loginId; delete c.snapshot.loginId; delete c.snapshot.account;
        c.snapshot.generation = generation; c.snapshot.state = 'disconnected'; if (!['quota', 'auth-required'].includes(c.snapshot.recovery ?? '')) c.snapshot.recovery = 'offline'; c.snapshot.message = 'Connection lost. Reconnect this profile, then explicitly resume.'; this.publish(c);
      };
      c.transport.onRequest = (id, method, params, generation) => {
        if (this.connections.get(c.profile.id) !== c) return;
        const turn = object(params) && typeof params.threadId === 'string' ? this.turns.get(nativeRoutingKey('codex', c.profile.id, params.threadId)) : undefined;
        if (!turn || turn.ended || generation !== turn.generation || (method === 'item/tool/requestUserInput' && !this.experimental(c.profile.id))) { c.transport!.reject(id, generation); return; }
        if (this.controls.get(this.key(turn.request.native))?.status === 'running') {
          c.transport!.reject(id, generation); turn.finish('turn.failed', 'Native compaction requested an unsupported interaction; inspect history explicitly.'); c.transport!.close(); return;
        }
        try { turn.serverRequest(id, method, params, generation); } catch { turn.finish('turn.failed', 'Invalid native interaction'); c.transport!.reject(id, generation); }
      };
      c.transport.onNotification = (method, params, generation) => { void this.notification(c, method, params, generation).catch(() => { if (this.connections.get(c.profile.id) !== c) return; if (method !== 'account/rateLimits/updated') c.snapshot.state = 'error'; c.snapshot.message = method === 'account/rateLimits/updated' ? 'Usage update unavailable. Verify account to retry.' : 'Incompatible authentication notification'; this.publish(c); }); };
    }
    if (!c.transport.running) {
      c.snapshot.state = 'connecting'; this.publish(c);
      try {
        await c.transport.start(); c.snapshot.generation = c.transport.generation;
        await this.readAccount(c);
      } catch {
        if (this.connections.get(c.profile.id) !== c) throw new Error('Bound profile is missing; session metadata was preserved');
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
    const previousIdentity = c.accountIdentity;
    const raw = await transport.request('account/read', { refreshToken: false });
    if (this.connections.get(c.profile.id) !== c || generation !== transport.generation || attempt !== c.attempt || !transport.running) return;
    if (!object(raw) || typeof raw.requiresOpenaiAuth !== 'boolean' || !('account' in raw)) throw new Error('Incompatible account payload');
    if (raw.account === null) { delete c.snapshot.account; delete c.snapshot.usage; c.snapshot.recovery = 'auth-required'; c.snapshot.state = c.loginId ? 'login-pending' : 'auth-required'; }
    else if (object(raw.account) && raw.account.type === 'apiKey') { c.snapshot.account = { type: 'apiKey' }; c.snapshot.state = 'authenticated'; }
    else if (object(raw.account) && raw.account.type === 'chatgpt' && (raw.account.email === null || typeof raw.account.email === 'string') && typeof raw.account.planType === 'string') {
      c.snapshot.account = { type: 'chatgpt', ...(typeof raw.account.email === 'string' ? { email: redactSecretStringValue(raw.account.email, 320) } : {}), planType: redactSecretStringValue(raw.account.planType, 80) };
      c.snapshot.state = 'authenticated';
    } else throw new Error('Incompatible account identity');
    const nextIdentity = c.snapshot.account ? this.store.identity(c.profile.id, c.snapshot.account) : undefined;
    c.accountIdentity = nextIdentity;
    if (previousIdentity !== nextIdentity) {
      delete c.snapshot.usage; delete c.snapshot.recovery;
      if (previousIdentity && nextIdentity) {
        const activeOwned = [...this.turns.values()].some(turn => turn.request.native.connectionProfileId === c.profile.id && !turn.ended);
        for (const turn of this.turns.values()) if (turn.request.native.connectionProfileId === c.profile.id) turn.finish('turn.failed', 'Native account changed; explicit original-account resume is required.');
        for (const key of this.sessions.keys()) if (JSON.parse(key)[1] === c.profile.id) this.sessions.delete(key);
        if (activeOwned) { c.transport?.close(); c.reauthRequired = true; }
      }
    }
    if (c.reauthRequired) { c.snapshot.state = 'auth-required'; delete c.snapshot.account; delete c.snapshot.usage; }
    if (c.snapshot.state === 'auth-required') c.snapshot.recovery = 'auth-required';
    if (c.snapshot.state === 'authenticated' && c.snapshot.recovery === 'auth-required') delete c.snapshot.recovery;
    delete c.snapshot.message; this.store.secure(c.profile.id); this.publish(c);
  }
  private async readUsage(c: ProfileConnection): Promise<void> {
    const transport = c.transport!; const generation = transport.generation; const attempt = c.attempt;
    try {
      const raw = await transport.request('account/rateLimits/read');
      if (this.connections.get(c.profile.id) !== c || !transport.running || generation !== transport.generation || attempt !== c.attempt) return;
      c.snapshot.usage = mergeUsage(c.snapshot.usage, raw);
      if (usageBlocked(c.snapshot.usage)) c.snapshot.recovery = 'quota';
      // Only explicit backend permission permits recovery; reset time/percentages do not.
      else if (object(raw) && raw.ordinaryUsageAllowed === true) delete c.snapshot.recovery;
      this.publish(c);
    } catch {
      // Unavailable usage must not disable an otherwise authenticated profile.
      if (this.connections.get(c.profile.id) === c && transport.running && generation === transport.generation && attempt === c.attempt) {
        c.snapshot.message = 'Usage is unavailable. Verify account to retry; missing usage does not block work.'; this.publish(c);
      }
    }
  }
  private async notification(c: ProfileConnection, method: string, raw: unknown, generation: number): Promise<void> {
    if (this.connections.get(c.profile.id) !== c || generation !== c.transport?.generation || !c.transport.running) return;
    if (method === 'account/rateLimits/updated') {
      c.snapshot.usage = mergeUsage(c.snapshot.usage, raw);
      if (usageBlocked(c.snapshot.usage)) c.snapshot.recovery = 'quota';
      this.publish(c);
    } else if (method === 'account/login/completed') {
      if (!object(raw) || typeof raw.success !== 'boolean' || (raw.loginId !== null && typeof raw.loginId !== 'string')) throw new Error('Invalid login completion');
      if (!c.loginId || raw.loginId !== c.loginId || c.snapshot.generation !== generation) return;
      delete c.loginId; delete c.snapshot.loginId;
      if (!raw.success) { c.snapshot.state = 'auth-required'; c.snapshot.message = 'Sign-in did not complete. Retry authentication.'; this.publish(c); }
      else await this.readAccount(c);
    } else if (method === 'account/updated') {
      const active = [...this.turns.values()].filter(turn => turn.request.native.connectionProfileId === c.profile.id && !turn.ended);
      if (active.length) {
        for (const turn of active) turn.finish('turn.failed', 'Native account changed; explicitly verify and resume the original account.');
        c.transport.close(); c.reauthRequired = true; c.snapshot.state = 'auth-required'; c.snapshot.recovery = 'auth-required'; this.publish(c); return;
      }
      if (!object(raw) || (raw.authMode !== null && !['apikey', 'chatgpt', 'chatgptAuthTokens', 'headers', 'agentIdentity', 'personalAccessToken', 'bedrockApiKey', 'bedrockAccessKeys'].includes(String(raw.authMode))) || (raw.planType !== null && typeof raw.planType !== 'string')) throw new Error('Invalid account update');
      // A pending attempt is verified only by its matching login completion or explicit refresh.
      if (!c.loginId) await this.readAccount(c);
    } else if (object(raw) && typeof raw.threadId === 'string' && this.turns.has(nativeRoutingKey('codex', c.profile.id, raw.threadId))) {
      const turn = this.turns.get(nativeRoutingKey('codex', c.profile.id, raw.threadId))!;
      const correlated = generation === turn.generation && !!turn.nativeTurnId && (raw.turnId === turn.nativeTurnId || (object(raw.turn) && raw.turn.id === turn.nativeTurnId));
      if (correlated && ((method === 'error' && raw.willRetry !== true) || (method === 'turn/completed' && object(raw.turn) && raw.turn.status === 'failed'))) {
        c.snapshot.recovery = failureRecovery(method === 'error' ? (object(raw.error) ? raw.error : raw) : (raw.turn as Record<string, unknown>).error);
        if (c.snapshot.recovery === 'auth-required') { c.reauthRequired = true; c.snapshot.state = 'auth-required'; delete c.snapshot.account; delete c.snapshot.usage; }
        c.snapshot.message = c.snapshot.recovery === 'quota' ? 'Usage limit reached. Verify account after quota recovery; retry explicitly.' : c.snapshot.recovery === 'auth-required' ? 'Authentication expired. Sign in to this profile again.' : 'Native request failed. Reconnect or retry this profile explicitly.';
        this.publish(c);
      }
      try { turn.notification(method, raw, generation); } catch { turn.finish('turn.failed', 'Incompatible native turn notification'); }
    } else { c.transport.unknownNotifications = Math.min(100, c.transport.unknownNotifications + 1); }
  }
  async authenticate(request: AgentAuthRequest): Promise<AgentAuthResult> {
    const action = request.options?.action ?? 'read'; const profileId = request.connectionProfileId;
    if (!['read', 'list-profiles', 'create-profile', 'rename-profile', 'remove-profile', 'logout', 'cancel', 'login-browser', 'login-device', 'login-api-key', 'restart', 'experimental-on', 'experimental-off'].includes(String(action))) throw new Error('Unsupported authentication action');
    const mutates = typeof profileId === 'string' && !['read', 'list-profiles', 'create-profile', 'rename-profile'].includes(String(action));
    if (mutates && this.mutations.has(profileId)) throw new Error('Selected profile authentication is busy');
    if (mutates) {
      this.mutations.add(profileId);
      const c = this.connections.get(profileId);
      if (c && action !== 'cancel') {
        c.attempt++;
        for (const turn of this.turns.values()) if (turn.request.native.connectionProfileId === profileId) turn.finish('turn.failed', 'Selected profile authentication changed; explicitly resume after sign-in.');
        c.transport?.close();
        for (const key of this.sessions.keys()) if (JSON.parse(key)[1] === profileId) this.sessions.delete(key);
        this.models.delete(profileId);
      }
    }
    try { return redactForSerialization(await this.authenticateProfile(request), Infinity) as AgentAuthResult; }
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
      throw new Error(redactSecretStringValue(message));
    } finally { if (mutates) this.mutations.delete(profileId); }
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
    if (action === 'rename-profile') {
      if (typeof request.options?.label !== 'string') throw new Error('Profile name is required');
      c.profile = this.store.rename(c.profile.id, request.options.label); c.snapshot.label = c.profile.label; this.publish(c);
      return { status: 'challenge', profile: { ...c.snapshot }, profiles: this.store.list().map(profile => ({ ...this.connection(profile.id).snapshot })) };
    }
    if (action === 'remove-profile') {
      c.attempt++; c.transport?.close(); c.transport = null;
      for (const turn of this.turns.values()) if (turn.request.native.connectionProfileId === c.profile.id) turn.finish('turn.failed', 'Bound profile was removed; saved session metadata was preserved.');
      this.store.remove(c.profile.id); this.models.delete(c.profile.id);
      delete c.snapshot.account; delete c.snapshot.usage; delete c.snapshot.loginId; delete c.loginId;
      c.snapshot.state = 'missing-profile'; c.snapshot.message = 'Bound profile removed. Session metadata and private native history remain preserved.'; this.publish(c);
      this.connections.delete(c.profile.id);
      return { status: 'challenge', profile: { ...c.snapshot }, profiles: this.store.list().map(profile => ({ ...this.connection(profile.id).snapshot })) };
    }
    if (action === 'experimental-on' || action === 'experimental-off') {
      c.transport?.close(); c.transport = null; c.profile = this.store.setExperimental(c.profile.id, action === 'experimental-on'); c.snapshot = { ...c.snapshot, ...c.profile }; this.models.delete(c.profile.id); this.publish(c);
      return { status: 'challenge', profile: { ...c.snapshot } };
    }
    if (action === 'logout') {
      c.attempt++; c.transport?.close(); this.store.clearCredentials(c.profile.id);
      delete c.snapshot.account; delete c.snapshot.usage; delete c.accountIdentity; delete c.loginId; delete c.snapshot.loginId;
      c.reauthRequired = true; c.snapshot.state = 'auth-required'; c.snapshot.recovery = 'auth-required'; this.publish(c);
      return { status: 'challenge', profile: { ...c.snapshot } };
    }
    if (action === 'restart') {
      c.transport?.close(); await this.connect(c.profile.id);
    } else {
      await this.connect(c.profile.id);
      if (action === 'logout' || action === 'cancel' || action === 'login-browser' || action === 'login-device' || action === 'login-api-key') {
        c.attempt++;
        if (action !== 'cancel') for (const turn of this.turns.values()) if (turn.request.native.connectionProfileId === c.profile.id) turn.finish('turn.failed', 'Selected profile authentication changed; explicitly resume after sign-in.');
        if (action !== 'cancel') { delete c.snapshot.usage; delete c.snapshot.recovery; c.reauthRequired = action === 'logout'; delete c.accountIdentity; }
        const oldLogin = c.loginId; delete c.loginId; delete c.snapshot.loginId;
        if (oldLogin) await c.transport!.request('account/login/cancel', { loginId: oldLogin });
      }
      if (action === 'login-api-key') {
        if (request.credential?.ref !== 'profile-api-key') throw new Error('Provide a private api-key file in the selected profile home.');
        this.store.secure(c.profile.id);
        const path = join(this.store.home(c.profile.id), 'api-key');
        if (!existsSync(path)) throw new Error('Private API key file is missing');
        const apiKey = this.store.importKey(c.profile.id);
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
      } else if (action === 'cancel' || action === 'read') { await this.readAccount(c); if (action === 'read' && c.snapshot.state === 'authenticated') await this.readUsage(c); }
      else if (action !== 'logout') throw new Error('Unsupported authentication action');
    }
    return { status: c.snapshot.state === 'authenticated' ? 'authenticated' : 'challenge', profile: { ...c.snapshot } };
  }
  private experimental(profileId: string): boolean { return !!(this.options.experimental || this.store.require(profileId).experimental); }
  private key(native: NativeSessionRef): string { return nativeRoutingKey('codex', native.connectionProfileId, String(native.nativeSessionId)); }
  async listModels(input?: { workspaceRootPath?: string; connectionProfileId?: string }) {
    const c = await this.connect(input?.connectionProfileId);
    const models: Model[] = []; const seen = new Set<string>(); let cursor: string | undefined;
    do {
      const raw = await c.transport!.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) } satisfies ModelListParams);
      if (!object(raw) || !Array.isArray(raw.data) || raw.data.some(m => !object(m) || typeof m.id !== 'string' || typeof m.model !== 'string' || typeof m.displayName !== 'string' || !Array.isArray(m.supportedReasoningEfforts))) throw new Error('Incompatible model catalog');
      models.push(...raw.data as Model[]);
      cursor = typeof raw.nextCursor === 'string' ? raw.nextCursor : undefined;
      if (cursor && seen.has(cursor)) throw new Error('Repeated model catalog cursor');
      if (cursor) seen.add(cursor);
      if (models.length > 1000) throw new Error('Model catalog limit exceeded');
    } while (cursor);
    this.models.set(c.profile.id, models);
    return models.filter(m => !m.hidden).map(m => ({ id: m.id, name: redactSecretStringValue(m.displayName), reasoningEfforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort), defaultReasoningEffort: m.defaultReasoningEffort }));
  }
  async listModes(input?: { modelId?: string; connectionProfileId?: string }) {
    const c = await this.connect(input?.connectionProfileId);
    if (!this.experimental(c.profile.id)) return [{ id: 'default', name: 'Default' }];
    const raw = await c.transport!.request('collaborationMode/list', {});
    if (!object(raw) || !Array.isArray(raw.data)) throw new Error('Incompatible collaboration catalog');
    return raw.data.filter(m => object(m) && ['default', 'plan'].includes(String(m.mode))).map(m => ({ id: String((m as Record<string, unknown>).mode), name: redactSecretStringValue(String((m as Record<string, unknown>).name)) }));
  }
  async describeSessionConfiguration(input?: { connectionProfileId?: string }) {
    const c = await this.connect(input?.connectionProfileId);
    if (!this.models.has(c.profile.id)) await this.listModels(input);
    return {
      schemaVersion: 1 as const, scope: 'session' as const,
      description: 'Saved with this session. Explicit session values override native profile/workspace defaults; other native settings and workspace instructions remain native-owned. Experimental protocol is a separate profile opt-in.',
      fields: [
        { id: 'effort', label: 'Effort', kind: 'select' as const, defaultsByModel: Object.fromEntries(this.models.get(c.profile.id)!.map(m => [m.id, m.defaultReasoningEffort])), optionsByModel: Object.fromEntries(this.models.get(c.profile.id)!.map(m => [m.id, m.supportedReasoningEfforts.map(e => e.reasoningEffort)])), default: 'medium', description: 'Reasoning effort for the selected model and session.' },
        { id: 'sandbox', label: 'Sandbox', kind: 'select' as const, options: ['read-only', 'workspace-write', 'danger-full-access'], default: 'workspace-write', description: 'Native filesystem scope for this session. Changes apply on the next explicit resume.' },
        { id: 'approvalPolicy', label: 'Approval', kind: 'select' as const, options: ['on-request', 'untrusted', 'on-failure', 'never'], default: 'on-request', description: 'Native approval policy for this session, independent of sandbox.' },
      ],
    };
  }
  private async selection(profileId: string, modelId: string | undefined, raw: unknown, modeId?: string) {
    if (!this.models.has(profileId)) await this.listModels({ connectionProfileId: profileId });
    const config = settings({ ...(object(raw) ? raw : {}), ...(modeId ? { collaborationMode: modeId } : {}) });
    if (!object(raw) || !('effort' in raw)) { const chosen = this.models.get(profileId)!.find(m => m.id === modelId || m.model === modelId) ?? this.models.get(profileId)!.find(m => m.isDefault) ?? this.models.get(profileId)![0]; if (chosen) config.effort = chosen.defaultReasoningEffort; }
    const model = validateModel(this.models.get(profileId)!, modelId, config);
    const modes = await this.listModes({ connectionProfileId: profileId });
    if (!modes.some(m => m.id === config.collaborationMode)) throw new Error('Unsupported collaboration mode for this runtime');
    return { config, model };
  }
  private available(id: unknown, control = false): void { if (!control && typeof id === "string" && this.controlReservations.has(id)) throw new Error("Native session operation is pending; Stop or wait for completion"); if (typeof id === 'string' && this.mutations.has(id)) throw new Error('Selected profile authentication is busy'); }
  private operation(c: ProfileConnection, control = false): () => void {
    const transport = c.transport; const generation = transport?.generation; const attempt = c.attempt; const identity = c.accountIdentity;
    return () => {
      this.store.require(c.profile.id); this.available(c.profile.id, control);
      if (this.connections.get(c.profile.id) !== c || !transport?.running || c.transport !== transport || generation !== transport.generation || attempt !== c.attempt || identity !== c.accountIdentity) throw new Error('Native profile operation was superseded; explicitly resume');
      if (c.snapshot.state !== 'authenticated' || !c.snapshot.account) throw adapterErrors.authenticationRequired();
      if (identity !== this.store.identity(c.profile.id, c.snapshot.account)) throw new Error('Native account binding mismatch; verify the original account before resuming');
    };
  }
  async createSession(request: CreateAgentSessionRequest): Promise<NativeSessionRef> {
    this.available(request.connectionProfileId);
    const c = await this.connect(request.connectionProfileId); const assertCurrent = this.operation(c);
    if (c.snapshot.state !== 'authenticated') throw new Error('Authenticate the selected Codex profile before creating a session.');
    if (!this.experimental(c.profile.id)) throw new Error('Enable experimental protocol for this profile before creating a coding session: this pinned runtime requires legacy history for resume.');
    const { config, model } = await this.selection(c.profile.id, request.modelId, request.runtimeMetadata, request.modeId); assertCurrent();
    const raw = await c.transport!.request('thread/start', { cwd: request.workspaceRootPath, model: model.model, sandbox: config.sandbox, approvalPolicy: config.approvalPolicy, approvalsReviewer: 'user', ephemeral: false, historyMode: 'legacy', config: { model_reasoning_effort: config.effort } } satisfies ThreadStartParams);
    assertCurrent();
    if (!object(raw) || !object(raw.thread) || typeof raw.thread.id !== 'string' || raw.thread.historyMode !== 'legacy') throw new Error('Incompatible native thread response');
    const native: NativeSessionRef = { runtimeId: 'codex', connectionProfileId: c.profile.id, nativeSessionId: asNativeSessionId(raw.thread.id), modelId: model.id, modeId: config.collaborationMode, runtimeMetadata: { ...config, writeCapability: config.sandbox !== 'read-only' } };
    if (!c.accountIdentity) throw adapterErrors.authenticationRequired();
    this.store.bindSession(c.profile.id, String(native.nativeSessionId), c.accountIdentity);
    this.sessions.set(this.key(native), { cwd: request.workspaceRootPath, generation: c.transport!.generation, settings: config, modelId: model.id });
    return native;
  }
  async resumeSession(request: ResumeAgentSessionRequest): Promise<NativeSessionRef> {
    if (!request.native.connectionProfileId) throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId));
    if (request.native.runtimeId !== 'codex' || !request.native.connectionProfileId || (request.connectionProfileId && request.connectionProfileId !== request.native.connectionProfileId)) throw new Error('Native profile binding mismatch');
    try { this.store.require(request.native.connectionProfileId); } catch { throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId)); }
    this.available(request.native.connectionProfileId);
    const c = await this.connect(request.native.connectionProfileId); const assertCurrent = this.operation(c);
    if (!c.accountIdentity || c.snapshot.state !== 'authenticated') throw adapterErrors.authenticationRequired();
    this.store.assertSessionIdentity(c.profile.id, String(request.native.nativeSessionId), c.accountIdentity);
    if (!this.experimental(c.profile.id)) throw new Error('Enable experimental protocol for the bound profile to resume native history.');
    const key = this.key(request.native);
    if (this.turns.has(key) && !this.turns.get(key)!.ended) throw new Error('Thread already has an active turn');
    const { config, model } = await this.selection(c.profile.id, request.native.modelId, request.native.runtimeMetadata, request.native.modeId); assertCurrent();
    const read = await c.transport!.request('thread/read', { threadId: request.native.nativeSessionId, includeTurns: false }).catch(error => { if (error instanceof NativeRpcError && error.missingHistory) throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId)); throw error; });
    assertCurrent();
    if (!object(read) || !object(read.thread) || read.thread.id !== request.native.nativeSessionId) throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId));
    if (read.thread.cwd !== request.workspaceRootPath) throw new Error('Native workspace binding mismatch');
    const raw = await c.transport!.request('thread/resume', { threadId: request.native.nativeSessionId, cwd: request.workspaceRootPath, model: model.model, approvalPolicy: config.approvalPolicy, approvalsReviewer: 'user', sandbox: config.sandbox, config: { model_reasoning_effort: config.effort }, excludeTurns: false } satisfies ThreadResumeParams);
    assertCurrent();
    if (!object(raw) || !object(raw.thread) || raw.thread.id !== request.native.nativeSessionId) throw new Error('Native resume identity mismatch');
    const history = await this.history(c.transport!, request.native, raw.thread); assertCurrent();
    this.sessions.set(key, { cwd: request.workspaceRootPath, generation: c.transport!.generation, settings: config, modelId: model.id });
    return { ...request.native, modelId: model.id, modeId: config.collaborationMode, runtimeMetadata: { ...config, writeCapability: config.sandbox !== 'read-only' }, history };
  }
  private async turnCredentials(transport: CodexTransport, profileId: string, cwd: string): Promise<string[]> {
    this.store.secure(profileId);
    const raw = await transport.request('config/read', { cwd, includeLayers: false });
    if (!object(raw) || !object(raw.config)) throw new Error('Native credential projection is unavailable');
    return [...this.store.credentialValues(profileId), ...this.store.mcpCredentialValues(profileId), ...nativeConfigCredentials(raw.config)];
  }
  private async history(transport: CodexTransport, native: NativeSessionRef, thread: Record<string, unknown>): Promise<NonNullable<NativeSessionRef['history']>> {
    if (thread.historyMode !== 'legacy') throw new Error('This pinned runtime cannot hydrate paginated native history. Preserve this record and use a supported runtime.');
    if (!Array.isArray(thread.turns)) throw new Error('Native history snapshot is incomplete; cached history was preserved.');
    const byTurn = new Map<string, Record<string, unknown>>();
    for (const value of thread.turns) {
      if (!object(value) || typeof value.id !== 'string' || !value.id) throw new Error('Invalid native history turn');
      const old = byTurn.get(value.id);
      // A complete snapshot dominates a reordered partial duplicate.
      const rank = (snapshot: Record<string, unknown>) => (snapshot.status === 'completed' ? 4 : snapshot.status === 'failed' || snapshot.status === 'interrupted' ? 3 : 1) * 2 + (snapshot.itemsView === 'full' ? 1 : 0);
      if (!old || rank(value) >= rank(old)) byTurn.set(value.id, value);
    }
    const turns = [...byTurn.values()].sort((a, b) => Number(a.startedAt ?? 0) - Number(b.startedAt ?? 0));
    if (turns.length > 10000) throw new Error('Native history exceeds hydration limit');
    if (!native.connectionProfileId) throw new Error('Native profile is required');
    const credentials = await this.turnCredentials(transport, native.connectionProfileId, String(thread.cwd));
    const history: NonNullable<NativeSessionRef['history']>[number][] = [];
    for (const turn of turns) {
      if (!['completed', 'failed', 'interrupted', 'inProgress'].includes(String(turn.status))) throw new Error('Invalid native history status');
      if (turn.status === 'inProgress') await transport.request('turn/interrupt', { threadId: native.nativeSessionId, turnId: turn.id });
      // items/list is absent in the pinned executable; never treat a sparse view as complete.
      if ((turn.itemsView !== undefined && turn.itemsView !== 'full') || !Array.isArray(turn.items)) throw new Error('Native history item view is incomplete in this runtime; cached history was preserved.');
      const items = new Map<string, ThreadItem>();
      for (const item of turn.items) {
        if (!object(item) || typeof item.id !== 'string' || !item.id || typeof item.type !== 'string') throw new Error('Invalid native history item');
        const oldItem = items.get(item.id);
        if (oldItem && oldItem.type !== item.type) throw new Error('Conflicting native history item identity; cached history was preserved.');
        const terminal = (value: unknown) => object(value) && ['completed', 'failed', 'declined'].includes(String(value.status));
        if (!oldItem || !terminal(oldItem) || terminal(item)) items.set(item.id, item as unknown as ThreadItem);
      }
      if (items.size > 10000) throw new Error('Native history exceeds hydration limit');
      const turnId = String(turn.id);
      const at = new Date(typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : 0).toISOString();
      let seq = 0;
      const mapped = new NativeTurn({ native, turnId: asSpecOpsTurnId(turnId), workspaceRootPath: String(thread.cwd), prompt: '' }, transport, () => ++seq, undefined, credentials);
      mapped.bind(turnId);
      for (const item of items.values()) {
        if (item.type === 'userMessage') history.push({ id: item.clientId ?? item.id, nativeTurnId: turnId, nativeItemId: item.id, role: 'user', content: item.content.filter(v => v.type === 'text').map(v => v.type === 'text' ? redactSecretStringValue(credentials.reduce((text, secret) => text.split(secret).join('[redacted]'), v.text), Infinity) : '').join(''), createdAt: at });
        else mapped.item(item, true);
      }
      mapped.finish(turn.status === 'completed' ? 'turn.finished' : 'turn.failed', 'Native history turn was interrupted or failed; continue with a new message explicitly.');
      const events: SessionEvent[] = []; for await (const event of mapped.events()) events.push(event);
      const text = events.find(e => e.type === 'text.finished');
      const textItems = [...items.values()].filter(item => item.type === 'agentMessage');
      history.push({ id: `native-assistant:${turnId}`, nativeTurnId: turnId, ...(textItems.length === 1 ? { nativeItemId: textItems[0]!.id } : {}), role: 'assistant', completionState: turn.status === 'completed' ? 'completed' : turn.status === 'failed' ? 'failed' : 'interrupted', content: text?.type === 'text.finished' ? text.text : '', createdAt: at, events });
    }
    return history;
  }
  private async extensionBinding(input: Parameters<NativeExtensions['inspectNative']>[0] | Parameters<NativeExtensions['actNative']>[0], control = false) {
    const native = input.native;
    if (native.runtimeId !== 'codex' || !native.connectionProfileId) throw new Error('Invalid native profile binding');
    this.available(native.connectionProfileId, control);
    const c = await this.connect(native.connectionProfileId); const check = this.operation(c, control); check();
    this.store.assertSessionIdentity(c.profile.id, String(native.nativeSessionId), c.accountIdentity!);
    const bound = this.sessions.get(this.key(native));
    if (!bound || bound.cwd !== input.workspaceRootPath || bound.generation !== c.transport!.generation || bound.modelId !== native.modelId || JSON.stringify(bound.settings) !== JSON.stringify(settings(native.runtimeMetadata)) || bound.settings.collaborationMode !== native.modeId) throw new Error('Explicit native resume with the original binding is required');
    if (!this.experimental(c.profile.id)) throw new Error('Native session actions require selected-profile experimental opt-in');
    return { c, bound, check };
  }
  private extensionText(profileId: string, text: string, limit: number): string {
    for (const secret of [...this.store.credentialValues(profileId), ...this.store.mcpCredentialValues(profileId)]) text = text.split(secret).join('[redacted]');
    return redactSecretStringValue(text, limit);
  }
  private ecosystemContext(input: Parameters<NativeExtensions['inspectNative']>[0] | Parameters<NativeExtensions['actNative']>[0], c: ProfileConnection, check: () => void) {
    return { owner: c.transport!, revision: `${c.attempt}:${c.accountIdentity}`, key: this.key(input.native), generation: c.transport!.generation, home: realpathSync(this.store.home(c.profile.id)), cwd: input.workspaceRootPath, threadId: String(input.native.nativeSessionId), check, secure: () => this.store.secure(c.profile.id),
      request: (method: string, params: unknown) => c.transport!.request(method, params), safe: (text: string, limit: number) => this.extensionText(c.profile.id, text, limit) };
  }
  async inspectNative(input: Parameters<NativeExtensions['inspectNative']>[0]): Promise<NativeExtensionSnapshot> {
    if (['ecosystem', 'configuration'].includes(input.view)) {
      const { c, check } = await this.extensionBinding(input, true);
      return this.ecosystem.inspect(this.ecosystemContext(input, c, check), input.view);
    }
    if (input.view !== 'checkpoints') throw adapterErrors.capabilityNotSupported(input.view);
    const { c, check } = await this.extensionBinding(input, true);
    const raw = await c.transport!.request('thread/read', { threadId: input.native.nativeSessionId, includeTurns: true }); check();
    if (!object(raw) || !object(raw.thread) || raw.thread.id !== input.native.nativeSessionId || raw.thread.cwd !== input.workspaceRootPath || raw.thread.historyMode !== 'legacy' || !Array.isArray(raw.thread.turns)) throw new Error('Native session snapshot is unavailable');
    const rows: NativeExtensionSnapshot['rows'][number][] = [];
    if (raw.thread.turns.length > 10000) throw new Error('Native history exceeds inspection limit');
    for (const turn of raw.thread.turns.slice(-100)) {
      if (!object(turn) || typeof turn.id !== 'string' || !Array.isArray(turn.items)) throw new Error('Invalid native checkpoint');
      const user = turn.items.find(v => object(v) && v.type === 'userMessage');
      if (object(user) && Array.isArray(user.content) && turn.status !== 'inProgress') {
        if (!/^[a-zA-Z0-9_-]{1,256}$/.test(turn.id) || this.extensionText(c.profile.id, turn.id, 256) !== turn.id) throw new Error('Unsafe native checkpoint identity');
        rows.push({ id: turn.id, label: this.extensionText(c.profile.id, user.content.filter(v => object(v) && v.type === 'text' && typeof v.text === 'string').map(v => v.text).join(''), 240), targetKind: 'checkpoint' });
      }
    }
    return { generation: c.transport!.generation, scope: 'Native conversation history. Fork preserves source history. Rollback is unavailable: this pin only supports revert for paginated history; selected legacy history is preserved. Compact may use model inference and does not undo files.', actions: ['fork', 'compact'], rows, operation: this.controls.get(this.key(input.native)) };
  }
  async actNative(input: Parameters<NativeExtensions['actNative']>[0]): Promise<NativeExtensionResult> {
    const id = input.native.connectionProfileId;
    const ownerToken = ['fork', 'compact', 'setSkillEnabled', 'setNativeConfig', 'connectToolServer', 'disconnectToolServer'].includes(input.action) ? randomUUID() : undefined;
    if (ownerToken) {
      if (!id) throw new Error('Missing native profile binding');
      this.available(id); this.controlReservations.set(id, ownerToken);
    }
    try { return await this.runNativeAction(input, ownerToken); }
    catch (error) { if (ownerToken && id && this.controlReservations.get(id) === ownerToken) this.controlReservations.delete(id); throw error; }
  }
  private async runNativeAction(input: Parameters<NativeExtensions['actNative']>[0], ownerToken?: string) {
    if (['setSkillEnabled', 'setNativeConfig', 'connectToolServer', 'disconnectToolServer'].includes(input.action)) {
      if (input.text !== undefined || input.clientMessageId !== undefined) throw new Error('Unexpected native control payload');
      try {
        const { c, check } = await this.extensionBinding(input, true);
        if ([...this.turns.values()].some(t => t.request.native.connectionProfileId === c.profile.id && !t.ended)) throw new Error('Stop profile turns before changing native configuration');
        return await this.ecosystem.act(this.ecosystemContext(input, c, check), input.action, input.target, input.value);
      } catch { throw new Error('Native control failed or its outcome is uncertain; refresh explicitly without replaying'); }
      finally { if (input.native.connectionProfileId && this.controlReservations.get(input.native.connectionProfileId) === ownerToken) this.controlReservations.delete(input.native.connectionProfileId); }
    }
    if (input.value !== undefined) throw new Error('Unexpected native control value');
    if (!['fork', 'compact', 'steer'].includes(input.action)) throw adapterErrors.capabilityNotSupported(input.action);
    if (input.action !== 'steer' && (input.text !== undefined || input.clientMessageId !== undefined)) throw new Error('Unexpected native action payload');
    if (input.target !== undefined && (typeof input.target !== 'string' || !input.target || input.target.length > 256 || /[\x00-\x1f]/.test(input.target))) throw new Error('Invalid native target');
    const { c, bound, check } = await this.extensionBinding(input, Boolean(ownerToken)); const key = this.key(input.native); const transport = c.transport!;
    const active = this.turns.get(key);
    if (input.action === 'steer') {
      if (input.target !== undefined || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 65536 || typeof input.clientMessageId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.clientMessageId)) throw new Error('Invalid steering payload');
      if (!active || active.ended || !active.nativeTurnId || this.controls.get(key)?.status === 'running') throw new Error('No steerable native turn is active');
      const turnId = active.nativeTurnId;
      this.store.reserveSteering(c.profile.id, String(input.native.nativeSessionId), input.clientMessageId);
      const raw = await transport.request('turn/steer', { threadId: input.native.nativeSessionId, expectedTurnId: turnId, clientUserMessageId: input.clientMessageId, input: [{ type: 'text', text: input.text, text_elements: [] }] } satisfies TurnSteerParams).catch(() => { throw new Error('Steering was rejected or its outcome is uncertain; inspect native history without replaying'); });
      check();
      if (!object(raw) || raw.turnId !== turnId) throw new Error('Steering acknowledgment is incompatible; inspect native history without replaying');
      return { generation: transport.generation, nativeTurnId: turnId };
    }
    if ([...this.turns.values()].some(turn => turn.request.native.connectionProfileId === c.profile.id && !turn.ended)) throw new Error('Stop active turns in this profile before a native session action');
    const assertControl = this.operation(c, true);
    if (input.action === 'fork') {
      try {
        const snapshot = await transport.request('thread/read', { threadId: input.native.nativeSessionId, includeTurns: true }); assertControl();
        if (!object(snapshot) || !object(snapshot.thread) || snapshot.thread.id !== input.native.nativeSessionId || snapshot.thread.cwd !== input.workspaceRootPath || snapshot.thread.historyMode !== 'legacy' || !Array.isArray(snapshot.thread.turns)) throw new Error('Native fork source is unavailable');
        if (input.target && !snapshot.thread.turns.some(t => object(t) && t.id === input.target && t.status !== 'inProgress')) throw new Error('Selected native checkpoint is absent or active');
        const model = this.models.get(c.profile.id)?.find(m => m.id === bound.modelId); if (!model) throw new Error('Bound native model is unavailable');
        const raw = await transport.request('thread/fork', { threadId: input.native.nativeSessionId, ...(input.target ? { lastTurnId: input.target } : {}), cwd: bound.cwd, model: model.model, approvalPolicy: bound.settings.approvalPolicy, approvalsReviewer: 'user', sandbox: bound.settings.sandbox, config: { model_reasoning_effort: bound.settings.effort }, excludeTurns: false, deferGoalContinuation: true } satisfies ThreadForkParams).catch(() => { throw new Error('Native fork outcome is uncertain; inspect native history manually before another fork'); });
        assertControl();
        if (!object(raw) || !object(raw.thread) || typeof raw.thread.id !== 'string' || !raw.thread.id || raw.thread.id === input.native.nativeSessionId || raw.thread.cwd !== bound.cwd || raw.thread.historyMode !== 'legacy' || raw.model !== model.model || raw.approvalPolicy !== bound.settings.approvalPolicy || raw.cwd !== bound.cwd || raw.approvalsReviewer !== 'user' || raw.reasoningEffort !== bound.settings.effort || !object(raw.sandbox) || raw.sandbox.type !== ({ 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'dangerFullAccess' }[bound.settings.sandbox])) throw new Error('Native fork binding is incompatible; inspect native history manually');
        if (!/^[a-zA-Z0-9_-]{1,256}$/.test(raw.thread.id) || this.extensionText(c.profile.id, raw.thread.id, 256) !== raw.thread.id) throw new Error('Unsafe native fork identity');
        const native = { ...input.native, nativeSessionId: asNativeSessionId(raw.thread.id) }; delete native.history;
        this.store.bindSession(c.profile.id, raw.thread.id, c.accountIdentity!);
        this.sessions.set(this.key(native), { ...bound });
        return { generation: transport.generation, native };
      } finally { if (this.controlReservations.get(c.profile.id) === ownerToken) this.controlReservations.delete(c.profile.id); }
    }
    if (input.target !== undefined) { if (this.controlReservations.get(c.profile.id) === ownerToken) this.controlReservations.delete(c.profile.id); throw new Error('Compact does not accept a checkpoint'); }
    let credentials: string[]; try { credentials = await this.turnCredentials(transport, c.profile.id, bound.cwd); assertControl(); } catch (error) { if (this.controlReservations.get(c.profile.id) === ownerToken) this.controlReservations.delete(c.profile.id); throw error; }
    const turn = new NativeTurn({ native: input.native, workspaceRootPath: bound.cwd, prompt: '', turnId: asSpecOpsTurnId('compact-' + randomUUID()) }, transport, () => { const n = (this.cursors.get(key) ?? 0) + 1; this.cursors.set(key, n); return n; }, undefined, credentials);
    this.turns.set(key, turn); this.controls.set(key, { id: ownerToken!, status: 'running', detail: 'Native compaction requested; waiting for native progress.' });
    const timer = setTimeout(() => { turn.finish('turn.failed', 'Native compaction timed out; explicitly inspect history.'); transport.close(); }, 300000);
    void (async () => {
      try {
        for await (const event of turn.events()) {
          if (event.type === 'context.compaction') this.controls.set(key, { id: ownerToken!, status: 'running', detail: event.subtask.description ?? 'Native context compaction progress.' });
          else if (event.type === 'turn.finished' || event.type === 'turn.failed' || event.type === 'turn.cancelled') this.controls.set(key, { id: ownerToken!, status: event.type === 'turn.finished' ? 'completed' : event.type === 'turn.cancelled' ? 'cancelled' : 'failed', detail: event.type === 'turn.finished' ? 'Native compaction completed.' : 'Native compaction stopped or failed; explicitly inspect history.' });
        }
      } finally { clearTimeout(timer); if (this.turns.get(key) === turn) this.turns.delete(key); if (this.controlReservations.get(c.profile.id) === ownerToken) this.controlReservations.delete(c.profile.id); }
    })();
    try { await transport.request('thread/compact/start', { threadId: input.native.nativeSessionId }); assertControl(); return { generation: transport.generation, pending: true, operationId: ownerToken }; }
    catch { turn.finish('turn.failed', 'Native compaction start is uncertain; explicitly inspect history.'); transport.close(); throw new Error('Native compaction start failed; explicitly inspect history without replaying'); }
  }
  async *send(request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    this.available(request.native.connectionProfileId);
    const c = await this.connect(request.native.connectionProfileId); const assertCurrent = this.operation(c); const key = this.key(request.native); const bound = this.sessions.get(key);
    if (!bound || bound.generation !== c.transport!.generation || bound.cwd !== request.workspaceRootPath) throw new Error('Explicit native resume is required before sending');
    if (this.turns.has(key) && !this.turns.get(key)!.ended) throw new Error('Thread already has an active turn');
    if (c.snapshot.state !== 'authenticated') throw adapterErrors.authenticationRequired();
    if (!c.accountIdentity) throw adapterErrors.authenticationRequired();
    this.store.assertSessionIdentity(c.profile.id, String(request.native.nativeSessionId), c.accountIdentity);
    const { config, model } = await this.selection(c.profile.id, request.native.modelId, request.native.runtimeMetadata, request.native.modeId); assertCurrent();
    if (c.snapshot.recovery === 'quota') throw new Error('Usage limit reached. Verify the selected profile after recovery, then explicitly retry.');
    if (request.attachments?.length) throw new Error('Attachments are unsupported by this developer slice');
    if (this.turns.has(key) && !this.turns.get(key)!.ended) throw new Error('Thread already has an active turn');
    const credentials = await this.turnCredentials(c.transport!, c.profile.id, bound.cwd); assertCurrent();
    if (this.turns.has(key) && !this.turns.get(key)!.ended) throw new Error("Thread already has an active turn");
    const turn = new NativeTurn(request, c.transport!, () => { const seq = (this.cursors.get(key) ?? 0) + 1; this.cursors.set(key, seq); return seq; }, this.options.interactionTimeoutMs, credentials);
    this.turns.set(key, turn);
    const transport = c.transport!;
    void transport.request('turn/start', { threadId: request.native.nativeSessionId, input: [{ type: 'text', text: request.prompt, text_elements: [] }], clientUserMessageId: typeof request.context?.clientUserMessageId === 'string' ? request.context.clientUserMessageId : null, model: model.model, effort: config.effort, approvalPolicy: config.approvalPolicy, approvalsReviewer: 'user', ...(this.experimental(c.profile.id) ? { collaborationMode: { mode: config.collaborationMode, settings: { model: model.model, reasoning_effort: config.effort, developer_instructions: null } } } : {}) } satisfies TurnStartParams).then(raw => { if (!turn.ended) { if (!object(raw) || !object(raw.turn)) throw new Error('Invalid native turn start'); turn.bind(raw.turn.id); } }).catch(() => { turn.finish('turn.failed', 'Native turn could not start; resume explicitly before retrying.'); transport.close(); });
    try { yield* turn.events(); } finally { if (!turn.ended) await this.cancel({ native: request.native, turnId: request.turnId }); if (this.turns.get(key) === turn) this.turns.delete(key); }
  }
  private active(native: NativeSessionRef, turnId?: string): NativeTurn | undefined { const turn = this.turns.get(this.key(native)); if (turnId && turn && turn.request.turnId !== turnId) throw new Error('Interaction belongs to another turn'); return turn; }
  async cancel(request: CancelAgentTurnRequest): Promise<void> {
    const turn = this.active(request.native, request.turnId); if (!turn || turn.ended) return;
    turn.cancelled = true;
    if (!turn.nativeTurnId) { turn.finish('turn.cancelled'); turn.transport.close(); return; }
    try { await turn.transport.request('turn/interrupt', { threadId: request.native.nativeSessionId, turnId: turn.nativeTurnId }, 750); turn.finish('turn.cancelled'); }
    catch { turn.finish('turn.cancelled'); turn.transport.close(); }
  }
  async interrupt(input: { native: NativeSessionRef }): Promise<void> { await this.cancel(input); }
  async replyPermission(input: Parameters<PermissionExtension['replyPermission']>[0]): Promise<void> { const turn = this.active(input.native, input.turnId); if (!turn) throw new Error('Approval expired'); turn.permission(input.permissionId, input.reply); }
  async replyQuestion(input: Parameters<QuestionExtension['replyQuestion']>[0]): Promise<void> { const turn = this.active(input.native, input.turnId); if (!turn) throw new Error('Question expired'); turn.question(input.questionId, input.answer); }
  async rejectQuestion(input: Parameters<QuestionExtension['rejectQuestion']>[0]): Promise<void> { const turn = this.active(input.native, input.turnId); if (!turn) throw new Error('Question expired'); turn.question(input.questionId); }
  async health(connectionProfileId?: string): Promise<AdapterHealth> {
    if (!connectionProfileId) return { status: (this.options.executable === undefined ? resolveCodexExecutable() : this.options.executable) ? 'degraded' : 'unavailable', runtimeId: 'codex', runtimeVersion: CODEX_VERSION, checkedAt: new Date().toISOString(), message: 'Select a connection profile to check authentication.' };
    try { const c = await this.connect(connectionProfileId); return { status: c.snapshot.state === 'authenticated' ? 'healthy' : 'degraded', runtimeId: 'codex', runtimeVersion: CODEX_VERSION, connectionProfileId, generation: c.snapshot.generation, checkedAt: new Date().toISOString() }; }
    catch { return { status: 'unavailable', runtimeId: 'codex', connectionProfileId, checkedAt: new Date().toISOString(), message: this.connection(connectionProfileId).snapshot.message }; }
  }
  close(): void { for (const c of this.connections.values()) c.transport?.close(); }
}
