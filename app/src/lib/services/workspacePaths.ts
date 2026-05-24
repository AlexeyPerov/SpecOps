import { normalizePathSync } from "./diskFingerprint";
import { appState } from "../state/appState";

/**
 * Path routing contract:
 * - Returns true for root itself and any descendant path under the same normalized root
 * - Uses `normalizePathSync` for slash/case normalization
 * - Callers should switch to Notepad before opening/saving files outside the active workspace root
 */
export function isPathUnderRoot(filePath: string, workspaceRoot: string): boolean {
  const normalizedPath = normalizePathSync(filePath).replace(/\/+$/, "");
  const normalizedRoot = normalizePathSync(workspaceRoot).replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function ensureNotepadForOutsidePath(path: string): {
  switchedToNotepad: boolean;
  activeWorkspaceRoot: string | null;
} {
  const activeWorkspaceRoot = appState.getWorkspaceRoot();
  if (!activeWorkspaceRoot) {
    return { switchedToNotepad: false, activeWorkspaceRoot: null };
  }
  if (isPathUnderRoot(path, activeWorkspaceRoot)) {
    return { switchedToNotepad: false, activeWorkspaceRoot };
  }
  const switched = appState.switchContext("notepad");
  return { switchedToNotepad: switched, activeWorkspaceRoot };
}

export function runInNotepadContext<T>(fn: () => Promise<T> | T): Promise<T> | T {
  if (!appState.isNotepadActive()) {
    appState.switchContext("notepad");
  }
  return fn();
}
