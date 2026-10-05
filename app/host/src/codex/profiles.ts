import { adapterErrors } from '../../../src/lib/session/adapter/errors';
import { redactForLogs } from '../redact';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync, unlinkSync, renameSync, openSync, closeSync, fstatSync, readSync, fsyncSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export interface ConnectionProfile { id: string; label: string; runtimeId: 'codex'; createdAt: string; experimental?: boolean }
export function validProfileId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
}
function entryExists(path: string): boolean { try { lstatSync(path); return true; } catch { return false; } }
function privateDirectory(path: string): void {
  if (entryExists(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new Error('Unsafe profile storage');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
function readPrivate(path: string, limit: number): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('Unsafe or oversized private storage');
    const bytes = Buffer.alloc(limit + 1); const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > limit) throw new Error('Private storage exceeds limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally { closeSync(fd); }
}
export class ProfileStore {
  constructor(readonly root: string) { privateDirectory(root); }
  home(id: string): string {
    if (!validProfileId(id)) throw new Error('Invalid connection profile');
    const path = join(resolve(this.root), id);
    privateDirectory(path);
    const home = join(path, 'home');
    privateDirectory(home);
    return home;
  }
  list(): ConnectionProfile[] {
    return readdirSync(this.root).filter(validProfileId).flatMap(id => {
      const directory = join(this.root, id);
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe profile directory');
      const path = join(directory, 'profile.json');
      if (!existsSync(path)) return [];
      if (lstatSync(path).isSymbolicLink()) throw new Error('Unsafe profile metadata');
      const raw = JSON.parse(readPrivate(path, 4096)) as ConnectionProfile;
      if (raw.id !== id || raw.runtimeId !== 'codex' || typeof raw.label !== 'string' || typeof raw.createdAt !== 'string' || (raw.experimental !== undefined && typeof raw.experimental !== 'boolean')) throw new Error('Invalid profile metadata');
      return [{ id, label: String(redactForLogs(raw.label)), runtimeId: 'codex' as const, createdAt: raw.createdAt, ...(raw.experimental === true ? { experimental: true } : {}) }];
    });
  }
  create(label: string): ConnectionProfile {
    const profile: ConnectionProfile = { id: randomUUID(), label: String(redactForLogs(label.trim().slice(0, 80))) || 'Codex account', runtimeId: 'codex', createdAt: new Date().toISOString() };
    const home = this.home(profile.id);
    writeFileSync(join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\nmcp_oauth_credentials_store = "file"\nmodel_provider = "openai"\n', { mode: 0o600, flag: 'wx' });
    writeFileSync(join(this.root, profile.id, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return profile;
  }
  rename(id: string, label: string): ConnectionProfile {
    const previous = this.require(id);
    const next = { ...previous, label: String(redactForLogs(label.trim().slice(0, 80))) };
    if (!next.label) throw new Error('Profile name is required');
    this.save(next); return next;
  }
  private save(profile: ConnectionProfile): void {
    this.require(profile.id);
    const path = join(this.root, profile.id, 'profile.json');
    const temporary = path + '.' + randomUUID() + '.tmp';
    try { writeFileSync(temporary, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  remove(id: string): void {
    this.require(id); this.clearCredentials(id);
    // Native history/config remain private in this home; removal never transfers them.
    unlinkSync(join(this.root, id, 'profile.json'));
  }
  clearCredentials(id: string): void {
    this.require(id); this.secure(id);
    for (const name of ['auth.json', 'api-key']) { const path = join(this.home(id), name); if (existsSync(path)) unlinkSync(path); }
  }
  importKey(id: string): string {
    this.require(id); this.secure(id);
    const key = readPrivate(join(this.home(id), 'api-key'), 16384).trim();
    if (!key) throw new Error('Invalid private API key file');
    return key;
  }
  identity(id: string, account: { type: string; email?: string }): string {
    this.require(id); this.secure(id);
    const path = join(this.home(id), 'auth.json'); let auth: Record<string, unknown> = {};
    if (existsSync(path)) {
      const value = JSON.parse(readPrivate(path, 1024 * 1024));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid private authentication storage');
      auth = value;
    }
    const tokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens as Record<string, unknown> : {};
    const identity = account.type === 'apiKey' ? auth.OPENAI_API_KEY : tokens.account_id;
    if (typeof identity !== 'string' || !identity.trim() || identity.length > 16384) throw new Error('Stable native account identity is unavailable; authenticate the selected profile');
    return createHash('sha256').update(JSON.stringify([account.type, identity ?? null])).digest('hex');
  }
  bindSession(id: string, nativeId: string, identity: string): void {
    const path = this.bindingPath(id, nativeId);
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify({ nativeId, identity }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  }
  credentialValues(id: string): string[] {
    this.require(id); this.secure(id);
    const path = join(this.home(id), 'auth.json');
    if (!existsSync(path)) return [];
    const auth = JSON.parse(readPrivate(path, 1024 * 1024));
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) throw new Error('Invalid private authentication storage');
    const tokens = auth.tokens && typeof auth.tokens === 'object' && !Array.isArray(auth.tokens) ? auth.tokens : {};
    return [auth.OPENAI_API_KEY, tokens.access_token, tokens.refresh_token, tokens.id_token].filter((value): value is string => typeof value === 'string' && value.length >= 8 && value.length <= 16384);
  }
  /** Read only recognized secret fields from the native profile's bounded file store. */
  mcpCredentialValues(id: string): string[] {
    this.require(id); this.secure(id);
    const path = join(this.home(id), '.credentials.json'); if (!existsSync(path)) return [];
    let root: unknown;
    try { root = JSON.parse(readPrivate(path, 1048576)); } catch { throw new Error('Native credential storage is unreadable'); }
    const values: string[] = []; let count = 0;
    const visit = (value: unknown, depth: number): void => {
      if (++count > 4096 || depth > 16) throw new Error('Native credentials exceed their limit');
      if (!value || typeof value !== 'object') return;
      for (const [key, field] of Object.entries(value)) {
        if (++count > 4096) throw new Error('Native credentials exceed their limit');
        if (/^(access_token|refresh_token|id_token|client_secret|bearer_token|api_key)$/i.test(key) && typeof field === 'string' && field.length) {
          if (field.length > 16384) throw new Error('Native credential exceeds its limit'); values.push(field);
        } else if (field && typeof field === 'object') visit(field, depth + 1);
      }
    };
    visit(root, 0); return values;
  }
  reserveSteering(id: string, nativeId: string, clientId: string): void {
    this.require(id);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(clientId)) throw new Error('Invalid steering identity');
    const directory = join(this.root, id, 'operations'); privateDirectory(directory);
    const path = join(directory, createHash('sha256').update(JSON.stringify([nativeId, clientId])).digest('hex') + '.json');
    if (existsSync(path)) throw new Error('Steering was already dispatched or its outcome is uncertain; inspect native history without replaying');
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify({ nativeId, clientId, state: 'dispatched' }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  assertSessionIdentity(id: string, nativeId: string, identity: string): void {
    const path = this.bindingPath(id, nativeId);
    if (!existsSync(path)) throw adapterErrors.sessionNotFound(nativeId);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).size > 4096) throw new Error('Unsafe native account binding');
    const saved = JSON.parse(readPrivate(path, 4096));
    if (saved.nativeId !== nativeId || saved.identity !== identity) throw new Error('Native account binding mismatch; use the original account to resume');
  }
  private bindingPath(id: string, nativeId: string): string {
    this.require(id);
    if (!nativeId || nativeId.length > 1024) throw new Error('Invalid native identity');
    const directory = join(this.root, id, 'bindings'); privateDirectory(directory);
    return join(directory, createHash('sha256').update(nativeId).digest('hex') + '.json');
  }
  setExperimental(id: string, enabled: boolean): ConnectionProfile {
    const profile = this.require(id); const next = { ...profile, experimental: enabled };
    this.save(next);
    return next;
  }
  require(id: unknown): ConnectionProfile {
    const profile = this.list().find(p => p.id === id);
    if (!profile) throw new Error('Connection profile not found');
    return profile;
  }
  secure(id: string): void {
    const home = this.home(id);
    for (const name of ['config.toml', 'auth.json', 'api-key', '.credentials.json']) {
      const path = join(home, name);
      if (entryExists(path)) {
        if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('Unsafe credential storage');
        chmodSync(path, 0o600);
      }
    }
  }
}
/** Native tools inherit only ordinary execution variables; account/config roots are profile-owned. */
export function isolatedEnvironment(home: string, ambient: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(ambient)) {
    if (/^(PATH|SystemRoot|WINDIR|COMSPEC|PATHEXT|TMP|TEMP|TMPDIR|LANG|LC_[A-Z_]+|TERM|COLORTERM)$/i.test(key)) env[key] = value;
  }
  env.CODEX_HOME = home; env.HOME = home; env.USERPROFILE = home;
  env.XDG_CONFIG_HOME = join(home, '.config'); env.XDG_DATA_HOME = join(home, '.local', 'share'); env.XDG_CACHE_HOME = join(home, '.cache');
  env.APPDATA = join(home, '.config'); env.LOCALAPPDATA = join(home, '.local', 'share');
  return env;
}
