import { normalizePathSync } from "./diskFingerprint";
import { appState } from "../state/appState";

/**
 * Collapse `.` / `..` segments and duplicate slashes on an already
 * slash-normalized path. Does not resolve symlinks or expand `~`.
 * Absolute paths never climb above the root (`/` or `C:/`).
 */
export function collapsePathSegments(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.length === 0) {
    return normalized;
  }

  const absolute = normalized.startsWith("/");
  const driveMatch = /^[A-Za-z]:\//.exec(normalized);
  let prefix = "";
  let rest = normalized;
  if (driveMatch) {
    prefix = driveMatch[0]!;
    rest = normalized.slice(prefix.length);
  } else if (absolute) {
    prefix = "/";
    rest = normalized.slice(1);
  }

  const stack: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length > 0) {
        stack.pop();
      } else if (!prefix) {
        stack.push("..");
      }
      continue;
    }
    stack.push(segment);
  }

  if (!prefix) {
    return stack.join("/") || ".";
  }
  if (prefix === "/") {
    return `/${stack.join("/")}`;
  }
  return `${prefix}${stack.join("/")}`;
}

function normalizePathForContainment(path: string): string {
  let normalized = collapsePathSegments(normalizePathSync(path));
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Path routing contract:
 * - Returns true for root itself and any descendant path under the same root
 * - Resolves `.` / `..` before the prefix check so `<root>/../outside` is rejected
 * - Uses `normalizePathSync` for slash/case comparison keys (macOS + Windows fold)
 * - Callers should switch to Notepad before opening/saving files outside the active workspace root
 */
export function isPathUnderRoot(filePath: string, workspaceRoot: string): boolean {
  const normalizedPath = normalizePathForContainment(filePath);
  const normalizedRoot = normalizePathForContainment(workspaceRoot);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function workspaceRelativePath(filePath: string, workspaceRoot: string): string | null {
  const normalizedPath = normalizePathForContainment(filePath);
  const normalizedRoot = normalizePathForContainment(workspaceRoot);
  if (normalizedPath === normalizedRoot) {
    return "";
  }
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return null;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
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
