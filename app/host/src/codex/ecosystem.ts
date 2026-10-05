import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, join } from 'node:path';
import type { NativeAction, NativeExtensionRow, NativeExtensionSnapshot, NativeView } from '../../../src/lib/session/adapter/nativeExtensions';
import type { ConfigReadParams } from './generated/v2/ConfigReadParams';
import type { ConfigValueWriteParams } from './generated/v2/ConfigValueWriteParams';
import type { SkillsListParams } from './generated/v2/SkillsListParams';
import type { SkillsConfigWriteParams } from './generated/v2/SkillsConfigWriteParams';
import type { ListMcpServerStatusParams } from './generated/v2/ListMcpServerStatusParams';
import { object } from './transport';
interface Context { owner?: object; revision?: string; key: string; generation: number; home: string; cwd: string; threadId: string; request(method: string, params: unknown): Promise<unknown>; check(): void; secure?(): void; safe(text: string, limit: number): string }
const OPTIONS: Record<string, readonly string[]> = { web_search: ['disabled', 'cached', 'indexed', 'live'], model_reasoning_summary: ['auto', 'concise', 'detailed', 'none'], model_verbosity: ['low', 'medium', 'high'] };
interface Target { owner?: object; revision?: string; key: string; generation: number; expires: number; kind: 'skill' | 'config' | 'server'; path?: string; scope?: string; name?: string; enabled?: boolean; configKey?: string; version?: string; choices?: readonly string[] }
function within(path: string, root: string): boolean { try { const r = relative(realpathSync(root), realpathSync(path)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); } catch { return false; } }
/** Native data stays host-side; UI tokens authorize only one bounded, selected-profile mutation. */
export class NativeEcosystem {
  private targets = new Map<string, Target>();
  private clear(key: string, kind?: Target['kind']) { for (const [id, t] of this.targets) if (t.key === key && (!kind || t.kind === kind)) this.targets.delete(id); }
  private token(c: Context, target: Omit<Target, 'key' | 'generation' | 'expires' | 'owner' | 'revision'>) { if (this.targets.size >= 2048) this.targets.clear(); const id = randomUUID(); this.targets.set(id, { ...target, owner: c.owner, revision: c.revision, key: c.key, generation: c.generation, expires: Date.now() + 300000 }); return id; }
  private async config(c: Context) {
    c.secure?.();
    const raw = await c.request('config/read', { cwd: c.cwd, includeLayers: true } satisfies ConfigReadParams); c.check();
    if (!object(raw) || !object(raw.config) || !Array.isArray(raw.layers) || raw.layers.length > 128) throw new Error('Native configuration is unavailable');
    const file = join(c.home, 'config.toml');
    const layer = raw.layers.find(v => object(v) && object(v.name) && v.name.type === 'user' && v.name.file === file && v.name.profile === null && v.disabledReason === null);
    if (!object(layer) || typeof layer.version !== 'string' || layer.version.length > 256 || !object(layer.config)) throw new Error('Owned native configuration version is unavailable');
    return { effective: raw.config, user: layer.config, version: layer.version, file };
  }
  async inspect(c: Context, view: NativeView): Promise<NativeExtensionSnapshot> {
    const rows: NativeExtensionRow[] = [];
    if (view === 'configuration') {
      this.clear(c.key, 'config'); const config = await this.config(c);
      for (const [key, choices] of Object.entries(OPTIONS)) {
        const value = typeof config.effective[key] === 'string' && choices.includes(config.effective[key] as string) ? config.effective[key] as string : '';
        rows.push({ id: this.token(c, { kind: 'config', configKey: key, version: config.version, choices }), label: key.replaceAll('_', ' '), detail: value || 'Native default', control: { action: 'setNativeConfig', value, choices } });
      }
      return { generation: c.generation, scope: 'Allowlisted effective native settings. Save writes only this profile config with version checking. Existing thread settings remain frozen; use a new native session for these defaults. Model, effort, approvals and sandbox use session controls. Secrets, instructions, providers and raw configuration are excluded.', actions: [], rows };
    }
    this.clear(c.key, 'skill'); this.clear(c.key, 'server');
    const config = await this.config(c);
    const secrets: string[] = [];
    if (object(config.user.mcp_servers)) {
      const servers = Object.values(config.user.mcp_servers); if (servers.length > 256) throw new Error('Native server configuration exceeds its limit');
      for (const server of servers) if (object(server)) {
        for (const field of ['env', 'http_headers']) if (object(server[field])) {
          const values = Object.values(server[field]); if (values.length > 256) throw new Error('Native server credentials exceed their limit');
          for (const value of values) if (typeof value === 'string' && value.length) { if (value.length > 16384) throw new Error('Native credential exceeds its limit'); secrets.push(value); }
        }
        for (const field of ['bearer_token', 'token', 'api_key', 'client_secret']) if (typeof server[field] === 'string' && server[field].length) { if (server[field].length > 16384) throw new Error('Native credential exceeds its limit'); secrets.push(server[field]); }
      }
    }
    if (secrets.length > 2048 || secrets.reduce((n, v) => n + v.length, 0) > 1048576) throw new Error('Native server credentials exceed their limit');
    const safe = (text: string, limit: number) => { for (const secret of secrets) text = text.split(secret).join('[redacted]'); return c.safe(text, limit); };
    const observed = new Set<string>();
    const raw = await c.request('skills/list', { cwds: [c.cwd], forceReload: true } satisfies SkillsListParams); c.check();
    if (!object(raw) || !Array.isArray(raw.data) || raw.data.length > 8) throw new Error('Native skills catalog is unavailable');
    const entry = raw.data.find(v => object(v) && v.cwd === c.cwd);
    if (!object(entry) || !Array.isArray(entry.skills) || entry.skills.length > 256) throw new Error('Native skills catalog exceeds its limit');
    for (const s of entry.skills) {
      if (!object(s) || typeof s.name !== 'string' || typeof s.description !== 'string' || typeof s.path !== 'string' || typeof s.enabled !== 'boolean') throw new Error('Malformed native skill');
      const editable = (s.scope === 'user' && within(s.path, c.home)) || (s.scope === 'repo' && within(s.path, c.cwd));
      rows.push({ id: editable ? this.token(c, { kind: 'skill', path: s.path, scope: String(s.scope), name: s.name, enabled: s.enabled }) : randomUUID(), label: safe(s.name, 120), detail: safe(`${s.enabled ? 'Enabled' : 'Disabled'} · ${s.scope === 'user' || s.scope === 'repo' ? s.scope : 'managed'} · ${s.description}`, 300), ...(editable ? { control: { action: 'setSkillEnabled' as const, value: String(s.enabled), choices: ['true', 'false'] } } : {}) });
    }
    let cursor: string | undefined; const seen = new Set<string>();
    for (let page = 0; page < 8; page++) {
      const status = await c.request('mcpServerStatus/list', { threadId: c.threadId, detail: 'full', limit: 32, cursor } satisfies ListMcpServerStatusParams); c.check();
      if (!object(status) || !Array.isArray(status.data) || status.data.length > 32) throw new Error('Native tool server catalog exceeds its limit');
      for (const server of status.data) {
        if (!object(server) || typeof server.name !== 'string' || !object(server.tools) || !Array.isArray(server.resources) || !Array.isArray(server.resourceTemplates)) throw new Error('Malformed native tool server');
        if (Object.keys(server.tools).length > 256 || server.resources.length > 256 || server.resourceTemplates.length > 256 || rows.length > 512) throw new Error('Native tool metadata exceeds its limit');
        observed.add(server.name);
        const configured = /^[a-zA-Z0-9_-]{1,80}$/.test(server.name) && object(config.user.mcp_servers) && Object.hasOwn(config.user.mcp_servers, server.name) && object(config.user.mcp_servers[server.name]) && !server.pluginId;
        const nativeConfig = configured ? (config.user.mcp_servers as Record<string, Record<string, unknown>>)[server.name]! : undefined;
        const enabled = nativeConfig?.enabled !== false;
        const detail = `${typeof server.runtimeStatus === 'string' ? server.runtimeStatus : 'Native status unavailable'} · ${typeof server.authStatus === 'string' ? server.authStatus : 'unknown'} · ${Object.keys(server.tools).length} tools · ${server.resources.length} resources · ${server.resourceTemplates.length} templates`;
        rows.push({ id: configured ? this.token(c, { kind: 'server', name: server.name, enabled, version: config.version }) : randomUUID(), label: safe(server.name, 120), detail: safe(detail, 300), ...(configured ? { targetKind: 'toolServer' as const } : {}) });
        for (const [name, tool] of Object.entries(server.tools).slice(0, 20)) rows.push({ id: randomUUID(), label: safe(name, 120), detail: safe(object(tool) && typeof tool.description === 'string' ? tool.description : 'Native tool', 240) });
        for (const template of server.resourceTemplates.slice(0, 20)) if (object(template)) rows.push({ id: randomUUID(), label: safe(typeof template.name === 'string' ? template.name : 'Native resource template', 120), detail: 'Native resource template; URI and content are private.' });
        for (const resource of server.resources.slice(0, 20)) if (object(resource)) rows.push({ id: randomUUID(), label: safe(typeof resource.name === 'string' ? resource.name : 'Native resource', 120), detail: 'Native resource; URI and content are private.' });
      }
      if (status.nextCursor === null) break;
      if (typeof status.nextCursor !== 'string' || status.nextCursor.length > 1024 || seen.has(status.nextCursor) || page === 7) throw new Error('Native tool pagination is invalid or exceeds its limit');
      cursor = status.nextCursor; seen.add(cursor);
    }
    if (object(config.user.mcp_servers)) for (const [name, server] of Object.entries(config.user.mcp_servers)) {
      if (observed.has(name) || !/^[a-zA-Z0-9_-]{1,80}$/.test(name) || !object(server)) continue;
      rows.push({ id: this.token(c, { kind: 'server', name, enabled: server.enabled !== false, version: config.version }), label: safe(name, 120), detail: server.enabled === false ? 'Disabled in profile; no current-thread inventory.' : 'Configured in profile; current-thread inventory is unavailable.', targetKind: 'toolServer' });
    }
    if (rows.length > 600) throw new Error('Native inventory exceeds its limit');
    return { generation: c.generation, scope: 'Native skills and current-thread MCP inventory. Skill toggles write the selected profile; native reload determines when discovery updates. Connect/disconnect changes enabled for existing profile-owned servers and requests native reload. Acknowledgment does not prove a connection; refresh to observe status. Managed/plugin servers are read only. New-server editing, OAuth, elicitation forms and plugin APIs are unavailable in this verified slice. Plugin APIs are under development upstream. Tool schemas, endpoints, credentials and resource contents are excluded.', actions: rows.some(r => r.targetKind === 'toolServer') ? ['connectToolServer', 'disconnectToolServer'] : [], rows };
  }
  async act(c: Context, action: NativeAction, id?: string, value?: string) {
    c.secure?.();
    const target = id ? this.targets.get(id) : undefined;
    if (!target || target.owner !== c.owner || target.revision !== c.revision || target.key !== c.key || target.generation !== c.generation || target.expires < Date.now()) throw new Error('Refresh the selected native catalog before changing it');
    if (action === 'setSkillEnabled') {
      if (target.kind !== 'skill' || !['true', 'false'].includes(value ?? '')) throw new Error('Invalid native skill control');
      const raw = await c.request('skills/list', { cwds: [c.cwd], forceReload: true } satisfies SkillsListParams); c.check();
      const found = object(raw) && Array.isArray(raw.data) && raw.data.flatMap(v => object(v) && v.cwd === c.cwd && Array.isArray(v.skills) && v.skills.length <= 256 ? v.skills : []).find(v => object(v) && v.path === target.path && v.name === target.name && v.scope === target.scope && v.enabled === target.enabled);
      if (!found || !within(target.path!, target.scope === 'user' ? c.home : c.cwd)) throw new Error('Native skill changed; refresh before changing it');
      c.secure?.(); this.clear(c.key);
      const result = await c.request('skills/config/write', { path: target.path!, enabled: value === 'true' } satisfies SkillsConfigWriteParams); c.check();
      if (!object(result) || typeof result.effectiveEnabled !== 'boolean' || result.effectiveEnabled !== (value === 'true')) throw new Error('Native skill setting was overridden; refresh native state');
    } else {
      const serverAction = action === 'connectToolServer' || action === 'disconnectToolServer';
      if (serverAction && value !== undefined) throw new Error('Unexpected native server control value');
      if ((serverAction && target.kind !== 'server') || (!serverAction && (action !== 'setNativeConfig' || target.kind !== 'config' || !target.choices?.includes(value ?? '')))) throw new Error('Invalid native configuration control');
      const config = await this.config(c);
      if (config.version !== target.version) throw new Error('Native configuration changed; refresh before saving');
      c.secure?.(); this.clear(c.key);
      const raw = await c.request('config/value/write', { keyPath: serverAction ? `mcp_servers.${target.name}.enabled` : target.configKey!, value: serverAction ? action === 'connectToolServer' : value!, mergeStrategy: 'replace', filePath: config.file, expectedVersion: target.version } satisfies ConfigValueWriteParams); c.check();
      if (!object(raw) || raw.filePath !== config.file || raw.status !== 'ok' || typeof raw.version !== 'string') throw new Error('Native setting changed or was overridden; refresh native state');
      if (serverAction) { await c.request('config/mcpServer/reload', undefined); c.check(); }
    }
    return { generation: c.generation };
  }
}
