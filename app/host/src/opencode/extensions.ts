import { openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { redactSecretStringValue } from '../../../src/lib/session/redact';
import type { NativeExtensionRow } from '../../../src/lib/session/adapter/nativeExtensions';
import type { RuntimeProfileStore } from './profiles';
/** Only known private credential values are loaded; none leave the host. */
export function extensionScrubber(store: RuntimeProfileStore, id: string, transportSecrets: readonly string[] = []) {
  const secrets = [...transportSecrets];
  let fd: number | undefined;
  try {
    fd = openSync(join(store.home(id), 'data', 'opencode', 'auth.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw new Error('Unsafe native credentials');
    const auth = JSON.parse(readFileSync(fd, 'utf8'));
    for (const entry of Object.values(auth)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const key of ['key', 'access', 'refresh']) {
        const value = (entry as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.length && value.length <= 8192) secrets.push(value);
      }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Private native credentials unavailable'); }
  finally { if (fd !== undefined) closeSync(fd); }
  return (value: unknown): string => {
    let text = typeof value === 'string' ? value : String(value ?? '');
    for (const secret of secrets.sort((a,b) => b.length-a.length)) text = text.split(secret).join('[redacted]');
    return redactSecretStringValue(text, 4096);
  };
}
export function projectRows(data: unknown, fields: readonly string[], scrub: (v: unknown) => string): NativeExtensionRow[] {
  if (Buffer.byteLength(JSON.stringify(data) ?? '') > 512 * 1024) throw new Error('Native view exceeds capacity');
  const entries = Array.isArray(data) ? data.map((v,i) => [String(i),v] as const) : Object.entries(data as Record<string, unknown> ?? {});
  if (entries.length > 256) throw new Error('Native view exceeds row capacity');
  const rows = entries.map(([key,value]) => {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return { id: scrub(record.id ?? record.name ?? key), label: scrub(record.name ?? record.content ?? record.title ?? record.path ?? record.file ?? key), detail: fields.flatMap(field => record[field] === undefined ? [] : [`${field}: ${scrub(Array.isArray(record[field]) ? record[field].join(', ') : record[field])}`]).join(' · ') };
  });
  if (Buffer.byteLength(JSON.stringify(rows)) > 512 * 1024) throw new Error('Native projection exceeds capacity');
  return rows;
}
