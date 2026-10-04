import { redactForLogs } from '../redact';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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
      const raw = JSON.parse(readFileSync(path, 'utf8')) as ConnectionProfile;
      if (raw.id !== id || raw.runtimeId !== 'codex' || typeof raw.label !== 'string' || typeof raw.createdAt !== 'string' || (raw.experimental !== undefined && typeof raw.experimental !== 'boolean')) throw new Error('Invalid profile metadata');
      return [{ id, label: String(redactForLogs(raw.label)), runtimeId: 'codex' as const, createdAt: raw.createdAt, ...(raw.experimental === true ? { experimental: true } : {}) }];
    });
  }
  create(label: string): ConnectionProfile {
    const profile: ConnectionProfile = { id: randomUUID(), label: String(redactForLogs(label.trim().slice(0, 80))) || 'Codex account', runtimeId: 'codex', createdAt: new Date().toISOString() };
    const home = this.home(profile.id);
    writeFileSync(join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\nmodel_provider = "openai"\n', { mode: 0o600, flag: 'wx' });
    writeFileSync(join(this.root, profile.id, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return profile;
  }
  setExperimental(id: string, enabled: boolean): ConnectionProfile {
    const profile = this.require(id); const next = { ...profile, experimental: enabled };
    writeFileSync(join(this.root, id, 'profile.json'), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    return next;
  }
  require(id: unknown): ConnectionProfile {
    const profile = this.list().find(p => p.id === id);
    if (!profile) throw new Error('Connection profile not found');
    return profile;
  }
  secure(id: string): void {
    const home = this.home(id);
    for (const name of ['config.toml', 'auth.json', 'api-key']) {
      const path = join(home, name);
      if (entryExists(path)) {
        if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('Unsafe credential storage');
        chmodSync(path, 0o600);
      }
    }
  }
}
/** Only credential/provider control variables are removed; ordinary tool environment survives. */
export function isolatedEnvironment(home: string, ambient: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(ambient)) {
    if (/^(CODEX_|OPENAI_|AZURE_OPENAI_|CHATGPT_|SPECOPS_CODEX_)/i.test(key) || /^(ANTHROPIC_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_PROFILE|AWS_WEB_IDENTITY_TOKEN_FILE|AWS_CONTAINER_CREDENTIALS_RELATIVE_URI|AWS_CONTAINER_CREDENTIALS_FULL_URI)$/i.test(key)) continue;
    env[key] = value;
  }
  env.CODEX_HOME = home;
  return env;
}
