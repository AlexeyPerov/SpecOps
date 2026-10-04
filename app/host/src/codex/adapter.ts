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
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import type { AgentRuntimeAdapter, AgentAuthRequest, AgentAuthResult, CreateAgentSessionRequest, ResumeAgentSessionRequest, NativeSessionRef, AgentTurnRequest, CancelAgentTurnRequest, AdapterHealth } from '../../../src/lib/session/adapter';
import type { CatalogExtension, PermissionExtension, QuestionExtension, LifecycleExtension } from '../../../src/lib/session/adapter/extensions';
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
export class CodexRuntimeAdapter implements AgentRuntimeAdapter, CatalogExtension, PermissionExtension, QuestionExtension, LifecycleExtension {
  readonly runtimeId = 'codex' as const;
  readonly store: ProfileStore;
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
  async describeCapabilities() { return { schemaVersion: 1 as const, supported: ['catalogs', 'permissions', 'questions'], details: { catalogs: { supported: true }, permissions: { supported: true }, questions: { supported: true, notes: 'Requires explicit selected-profile experimental opt-in; otherwise requests are rejected. Secret input is unsupported.' }, nativeTurns: { supported: true }, steer: { supported: false, notes: 'Send only after the active turn completes.' } } }; }
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
      c.transport = this.options.transportFactory?.(executable, this.store.home(c.profile.id)) ?? new CodexTransport(executable, this.store.home(c.profile.id), process.env, this.options.experimental || c.profile.experimental);
      c.transport.onExit = generation => {
        for (const turn of this.turns.values()) if (turn.request.native.connectionProfileId === c.profile.id && turn.generation === generation) turn.finish('turn.failed', 'Native profile process exited; resume explicitly to continue.');
        c.attempt++; delete c.loginId; delete c.snapshot.loginId; delete c.snapshot.account;
        c.snapshot.generation = generation; c.snapshot.state = 'disconnected'; this.publish(c);
      };
      c.transport.onRequest = (id, method, params, generation) => {
        const turn = object(params) && typeof params.threadId === 'string' ? this.turns.get(nativeRoutingKey('codex', c.profile.id, params.threadId)) : undefined;
        if (!turn || turn.ended || generation !== turn.generation || (method === 'item/tool/requestUserInput' && !this.experimental(c.profile.id))) { c.transport!.reject(id, generation); return; }
        try { turn.serverRequest(id, method, params, generation); } catch { turn.finish('turn.failed', 'Invalid native interaction'); c.transport!.reject(id, generation); }
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
    } else if (object(raw) && typeof raw.threadId === 'string' && this.turns.has(nativeRoutingKey('codex', c.profile.id, raw.threadId))) {
      const turn = this.turns.get(nativeRoutingKey('codex', c.profile.id, raw.threadId))!;
      try { turn.notification(method, raw, generation); } catch { turn.finish('turn.failed', 'Incompatible native turn notification'); }
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
    if (action === 'experimental-on' || action === 'experimental-off') {
      c.transport?.close(); c.transport = null; c.profile = this.store.setExperimental(c.profile.id, action === 'experimental-on'); c.snapshot = { ...c.snapshot, ...c.profile }; this.models.delete(c.profile.id); this.publish(c);
      return { status: 'challenge', profile: { ...c.snapshot } };
    }
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
    return models.filter(m => !m.hidden).map(m => ({ id: m.id, name: m.displayName, reasoningEfforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort), defaultReasoningEffort: m.defaultReasoningEffort }));
  }
  async listModes(input?: { modelId?: string; connectionProfileId?: string }) {
    const c = await this.connect(input?.connectionProfileId);
    if (!this.experimental(c.profile.id)) return [{ id: 'default', name: 'Default' }];
    const raw = await c.transport!.request('collaborationMode/list', {});
    if (!object(raw) || !Array.isArray(raw.data)) throw new Error('Incompatible collaboration catalog');
    return raw.data.filter(m => object(m) && ['default', 'plan'].includes(String(m.mode))).map(m => ({ id: String((m as Record<string, unknown>).mode), name: String((m as Record<string, unknown>).name) }));
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
  async createSession(request: CreateAgentSessionRequest): Promise<NativeSessionRef> {
    const c = await this.connect(request.connectionProfileId);
    if (c.snapshot.state !== 'authenticated') throw new Error('Authenticate the selected Codex profile before creating a session.');
    if (!this.experimental(c.profile.id)) throw new Error('Enable experimental protocol for this profile before creating a coding session: this pinned runtime requires legacy history for resume.');
    const { config, model } = await this.selection(c.profile.id, request.modelId, request.runtimeMetadata, request.modeId);
    const raw = await c.transport!.request('thread/start', { cwd: request.workspaceRootPath, model: model.model, sandbox: config.sandbox, approvalPolicy: config.approvalPolicy, approvalsReviewer: 'user', ephemeral: false, historyMode: 'legacy', config: { model_reasoning_effort: config.effort } } satisfies ThreadStartParams);
    if (!object(raw) || !object(raw.thread) || typeof raw.thread.id !== 'string' || raw.thread.historyMode !== 'legacy') throw new Error('Incompatible native thread response');
    const native: NativeSessionRef = { runtimeId: 'codex', connectionProfileId: c.profile.id, nativeSessionId: asNativeSessionId(raw.thread.id), modelId: model.id, modeId: config.collaborationMode, runtimeMetadata: { ...config, writeCapability: config.sandbox !== 'read-only' } };
    this.sessions.set(this.key(native), { cwd: request.workspaceRootPath, generation: c.transport!.generation, settings: config, modelId: model.id });
    return native;
  }
  async resumeSession(request: ResumeAgentSessionRequest): Promise<NativeSessionRef> {
    if (!request.native.connectionProfileId) throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId));
    if (request.native.runtimeId !== 'codex' || !request.native.connectionProfileId || (request.connectionProfileId && request.connectionProfileId !== request.native.connectionProfileId)) throw new Error('Native profile binding mismatch');
    try { this.store.require(request.native.connectionProfileId); } catch { throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId)); }
    const c = await this.connect(request.native.connectionProfileId);
    if (!this.experimental(c.profile.id)) throw new Error('Enable experimental protocol for the bound profile to resume native history.');
    const key = this.key(request.native);
    if (this.turns.has(key) && !this.turns.get(key)!.ended) throw new Error('Thread already has an active turn');
    const { config, model } = await this.selection(c.profile.id, request.native.modelId, request.native.runtimeMetadata, request.native.modeId);
    const read = await c.transport!.request('thread/read', { threadId: request.native.nativeSessionId, includeTurns: false }).catch(() => { throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId)); });
    if (!object(read) || !object(read.thread) || read.thread.id !== request.native.nativeSessionId) throw adapterErrors.sessionNotFound(String(request.native.nativeSessionId));
    if (read.thread.cwd !== request.workspaceRootPath) throw new Error('Native workspace binding mismatch');
    const raw = await c.transport!.request('thread/resume', { threadId: request.native.nativeSessionId, cwd: request.workspaceRootPath, model: model.model, approvalPolicy: config.approvalPolicy, approvalsReviewer: 'user', sandbox: config.sandbox, config: { model_reasoning_effort: config.effort }, excludeTurns: false } satisfies ThreadResumeParams);
    if (!object(raw) || !object(raw.thread) || raw.thread.id !== request.native.nativeSessionId) throw new Error('Native resume identity mismatch');
    const history = await this.history(c.transport!, request.native, raw.thread);
    this.sessions.set(key, { cwd: request.workspaceRootPath, generation: c.transport!.generation, settings: config, modelId: model.id });
    return { ...request.native, modelId: model.id, modeId: config.collaborationMode, runtimeMetadata: { ...config, writeCapability: config.sandbox !== 'read-only' }, history };
  }
  private async history(transport: CodexTransport, native: NativeSessionRef, thread: Record<string, unknown>): Promise<NonNullable<NativeSessionRef['history']>> {
    let turns = Array.isArray(thread.turns) ? thread.turns : [];
    if (thread.historyMode === 'paginated') turns = await this.pages(transport, 'thread/turns/list', { threadId: native.nativeSessionId });
    const history: NonNullable<NativeSessionRef['history']>[number][] = [];
    for (const turn of turns) {
      if (!object(turn) || typeof turn.id !== 'string') throw new Error('Invalid native history turn');
      if (turn.status === 'inProgress') { await transport.request('turn/interrupt', { threadId: native.nativeSessionId, turnId: turn.id }); continue; }
      let items = Array.isArray(turn.items) ? turn.items : [];
      if (turn.itemsView !== undefined && turn.itemsView !== 'full' || thread.historyMode === 'paginated') items = (await this.pages(transport, 'thread/items/list', { threadId: native.nativeSessionId, turnId: turn.id })).map(entry => object(entry) ? entry.item : undefined);
      const at = new Date(typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : 0).toISOString();
      const mapped = new NativeTurn({ native, turnId: asSpecOpsTurnId(turn.id), workspaceRootPath: String(thread.cwd), prompt: '' }, transport, () => 1);
      for (const raw of items) { if (!object(raw) || typeof raw.id !== 'string' || typeof raw.type !== 'string') throw new Error('Invalid native history item'); const item = raw as unknown as ThreadItem;
        if (item.type === 'userMessage') history.push({ id: item.clientId ?? item.id, nativeTurnId: turn.id, role: 'user', content: item.content.filter(v => v.type === 'text').map(v => v.type === 'text' ? v.text : '').join(''), createdAt: at });
        else mapped.item(item, true);
      }
      mapped.finish(turn.status === 'completed' ? 'turn.finished' : 'turn.failed', 'Native history turn did not complete');
      const events: SessionEvent[] = []; for await (const event of mapped.events()) events.push(event);
      const text = events.find(e => e.type === 'text.finished');
      history.push({ id: `native-assistant:${turn.id}`, nativeTurnId: turn.id, role: 'assistant', content: text?.type === 'text.finished' ? text.text : '', createdAt: at, events });
    }
    return history;
  }
  private async pages(transport: CodexTransport, method: string, params: Record<string, unknown>): Promise<unknown[]> {
    const data: unknown[] = []; const seen = new Set<string>(); let cursor: string | undefined;
    do { const raw = await transport.request(method, { ...params, sortDirection: 'asc', limit: 100, ...(cursor ? { cursor } : {}) }); if (!object(raw) || !Array.isArray(raw.data)) throw new Error('Invalid native history page'); data.push(...raw.data); cursor = typeof raw.nextCursor === 'string' ? raw.nextCursor : undefined; if (cursor && seen.has(cursor) || data.length > 10000) throw new Error('Native history exceeds hydration limit'); if (cursor) seen.add(cursor); } while (cursor);
    return data;
  }
  async *send(request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    const c = await this.connect(request.native.connectionProfileId); const key = this.key(request.native); const bound = this.sessions.get(key);
    if (!bound || bound.generation !== c.transport!.generation || bound.cwd !== request.workspaceRootPath) throw new Error('Explicit native resume is required before sending');
    if (this.turns.has(key) && !this.turns.get(key)!.ended) throw new Error('Thread already has an active turn');
    if (c.snapshot.state !== 'authenticated') throw adapterErrors.authenticationRequired();
    const { config, model } = await this.selection(c.profile.id, request.native.modelId, request.native.runtimeMetadata, request.native.modeId);
    if (request.attachments?.length) throw new Error('Attachments are unsupported by this developer slice');
    if (this.turns.has(key) && !this.turns.get(key)!.ended) throw new Error('Thread already has an active turn');
    const turn = new NativeTurn(request, c.transport!, () => { const seq = (this.cursors.get(key) ?? 0) + 1; this.cursors.set(key, seq); return seq; }, this.options.interactionTimeoutMs);
    this.turns.set(key, turn);
    void c.transport!.request('turn/start', { threadId: request.native.nativeSessionId, input: [{ type: 'text', text: request.prompt, text_elements: [] }], clientUserMessageId: typeof request.context?.clientUserMessageId === 'string' ? request.context.clientUserMessageId : null, model: model.model, effort: config.effort, approvalPolicy: config.approvalPolicy, approvalsReviewer: 'user', ...(this.experimental(c.profile.id) ? { collaborationMode: { mode: config.collaborationMode, settings: { model: model.model, reasoning_effort: config.effort, developer_instructions: null } } } : {}) } satisfies TurnStartParams).then(raw => { if (!turn.ended) { if (!object(raw) || !object(raw.turn)) throw new Error('Invalid native turn start'); turn.bind(raw.turn.id); } }).catch(() => { turn.finish('turn.failed', 'Native turn could not start; resume explicitly before retrying.'); c.transport!.close(); });
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
