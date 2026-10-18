import { normalizePathSync } from './diskFingerprint';
const closingRoots = new Set<string>();
export function setWorkspaceContextClosing(root: string, closing: boolean): void {
  const key = normalizePathSync(root);
  if (closing) closingRoots.add(key); else closingRoots.delete(key);
}
export function workspaceContextIsClosing(root: string): boolean { return closingRoots.has(normalizePathSync(root)); }
