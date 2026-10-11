import { readTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { ensureSpecOpsDataDir } from './appDataDir';
import { atomicWriteTextFile } from './atomicWrite';
import { withSessionWriteLock } from './sessionWriteLock';
import { normalizePathSync } from './diskFingerprint';
import type { WindowSessionSnapshot } from '../domain/contracts';
type Placement = Record<string, string>;
async function path(): Promise<string> { return join(await ensureSpecOpsDataDir(), 'workspace-windows.json'); }
async function read(): Promise<Placement> {
  let raw: string;
  try { raw = await readTextFile(await path()); } catch (error) {
    if (/not found|no such file|does not exist|ENOENT/i.test(String(error))) return {};
    throw error;
  }
  const result: unknown = JSON.parse(raw);
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.values(result).some(value => typeof value !== 'string')) throw new Error('Workspace window placement is invalid.');
  return result as Placement;
}
export async function workspaceWindowOwner(root: string): Promise<string | undefined> { return (await read())[normalizePathSync(root)]; }
export async function setWorkspaceWindowOwner(root: string, windowId: string | null, expectedOwner?: string | null): Promise<void> {
  await withSessionWriteLock(async () => {
    const placements = await read(); const key = normalizePathSync(root);
    if (expectedOwner !== undefined && placements[key] && placements[key] !== expectedOwner) throw new Error("Workspace ownership changed during the move.");
    if (windowId) placements[key] = windowId; else delete placements[key];
    await atomicWriteTextFile(await path(), JSON.stringify(placements));
  });
}
/** A committed move makes old source crash records non-authoritative. */
export async function filterWorkspacePlacement(snapshot: WindowSessionSnapshot, windowId: string): Promise<WindowSessionSnapshot> {
  const placements = await read();
  const workspaces = snapshot.workspaces.filter(entry => !placements[normalizePathSync(entry.rootPath)] || placements[normalizePathSync(entry.rootPath)] === windowId);
  return { ...snapshot, workspaces, activeContextId: snapshot.activeContextId === 'notepad' || workspaces.some(entry => entry.id === snapshot.activeContextId) ? snapshot.activeContextId : workspaces[0]?.id ?? 'notepad' };
}
const outgoing = new Set<string>();
const incoming = new Set<string>();
export function markWorkspaceOutgoing(root: string, value: boolean): void { const key = normalizePathSync(root); if (value) outgoing.add(key); else outgoing.delete(key); }
export function workspaceWasMovedOut(root: string): boolean { return outgoing.has(normalizePathSync(root)); }
export function markWorkspaceIncoming(root: string): void { incoming.add(normalizePathSync(root)); }
export function consumeWorkspaceIncoming(root: string): boolean { const key = normalizePathSync(root); const present = incoming.delete(key); return present; }
