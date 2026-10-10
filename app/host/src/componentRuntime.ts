/** Native-only component bindings: the supervisor authenticates manifests and owns version leases. */
import { createHash } from 'node:crypto';
import { lstatSync, openSync, readSync, closeSync } from 'node:fs';
import { isAbsolute, join, parse } from 'node:path';
interface Binding { root: string; manifest: { id: string; version: string; target: { os: string; arch: string }; entries: Record<string, string>; files: { path: string; bytes: number; sha256: string }[] } }
const bindings = new Map<string, Binding>();
const verificationBuffer = Buffer.alloc(1024 * 1024);
const failure = () => new Error('Runtime component is missing or altered. Repair it in Software and reconnect the original profile.');
function verifyFile(binding: Binding, file: Binding['manifest']['files'][number]): void {
  try {
    if (!file.path || file.path.includes('\\') || file.path.split('/').some(part => !part || part === '.' || part === '..') || isAbsolute(file.path)) throw failure();
    let path = parse(binding.root).root;
    for (const part of binding.root.slice(path.length).split(/[\\/]/).filter(Boolean)) { path = join(path, part); if (lstatSync(path).isSymbolicLink()) throw failure(); }
    for (const part of file.path.split('/')) { path = join(path, part); if (lstatSync(path).isSymbolicLink()) throw failure(); }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size !== file.bytes) throw failure();
    const descriptor = openSync(path, 'r');
    const hash = createHash('sha256');
    try { const buffer = verificationBuffer; let bytes: number; while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes)); } finally { closeSync(descriptor); }
    if (hash.digest('hex') !== file.sha256) throw failure();
  } catch { throw failure(); }
}
export function bindManagedComponent(raw: unknown): void {
  try {
    const binding = raw as Binding;
    if (!binding || !isAbsolute(binding.root) || !binding.manifest || !['codex', 'opencode', 'claude', 'cursor'].includes(binding.manifest.id)) throw failure();
    const manifest = binding.manifest;
    if (manifest.target.os !== process.platform || manifest.target.arch !== process.arch || !Array.isArray(manifest.files) || manifest.files.length > 20000) throw failure();
    const previous = bindings.get(manifest.id);
    if (previous && (previous.root !== binding.root || previous.manifest.version !== manifest.version)) throw failure();
    // Full tree integrity at each explicit operation boundary; streaming hashes cap memory.
    for (const file of manifest.files) verifyFile(binding, file);
    bindings.set(manifest.id, binding);
  } catch { throw failure(); }
}
export function managedEntry(id: string, name = 'main'): string | undefined {
  const binding = bindings.get(id);
  if (!binding) { if (process.env.SPECOPS_MANAGED_COMPONENTS === '1') throw failure(); return undefined; }
  const relative = binding.manifest.entries[name];
  const file = binding.manifest.files.find(file => file.path === relative);
  if (!relative || !file) throw failure();
  verifyFile(binding, file);
  return join(binding.root, relative);
}
export function managedRoot(id: string): string | undefined { managedEntry(id); return bindings.get(id)?.root; }
