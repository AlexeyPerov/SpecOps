import { join } from "@tauri-apps/api/path";
import { emit, listen } from "@tauri-apps/api/event";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { atomicWriteTextFile } from "./atomicWrite";
import { withProjectFavoritesLock } from "./sessionWriteLock";
import { normalizePathSync } from "./diskFingerprint";
import { isPathUnderRoot } from "./workspacePaths";
import type { ProjectTreeNode } from "./projectTree";

type FavoritesFile = Record<string, ProjectTreeNode[]>;
const EVENT = "spec-ops/project-favorites-changed";

async function filePath(): Promise<string> {
  return join(await ensureSpecOpsDataDir(), "project-favorites.json");
}

export function decodeProjectFavorites(raw: unknown): FavoritesFile {
  const result: FavoritesFile = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [root, entries] of Object.entries(raw)) {
    if (!Array.isArray(entries)) continue;
    const unique = new Map<string, ProjectTreeNode>();
    for (const entry of entries) {
      if (entry && typeof entry.path === "string" && typeof entry.name === "string" &&
          (entry.kind === "file" || entry.kind === "directory") && isPathUnderRoot(entry.path, root)) {
        unique.set(normalizePathSync(entry.path), { path: entry.path, name: entry.name, kind: entry.kind });
      }
    }
    result[normalizePathSync(root)] = [...unique.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
  }
  return result;
}

async function readFavorites(): Promise<FavoritesFile> {
  const path = await filePath();
  if (!(await exists(path))) return {};
  return decodeProjectFavorites(JSON.parse(await readTextFile(path)));
}

export async function loadProjectFavorites(root: string): Promise<ProjectTreeNode[]> {
  const entries = (await readFavorites())[normalizePathSync(root)] ?? [];
  const present = await Promise.all(entries.map(async (entry) => {
    try { return await exists(entry.path); } catch { return true; }
  }));
  return entries.filter((_, index) => present[index]);
}

async function mutate(root: string, change: (entries: ProjectTreeNode[]) => ProjectTreeNode[]): Promise<void> {
  await withProjectFavoritesLock(async () => {
    const file = await readFavorites();
    const key = normalizePathSync(root);
    file[key] = change(file[key] ?? []);
    await atomicWriteTextFile(await filePath(), JSON.stringify(file));
    await emit(EVENT, { root: key });
  });
}

export async function setProjectFavorite(root: string, node: ProjectTreeNode, favorite: boolean): Promise<void> {
  if (!isPathUnderRoot(node.path, root)) throw new Error("Favorite is outside the project.");
  await mutate(root, (entries) => {
    const remaining = entries.filter((entry) => normalizePathSync(entry.path) !== normalizePathSync(node.path));
    return favorite ? [...remaining, node] : remaining;
  });
}

export function relocateFavoriteEntries(entries: ProjectTreeNode[], oldPath: string, newPath: string | null): ProjectTreeNode[] {
  const oldKey = normalizePathSync(oldPath).replace(/\/+$/, "");
  return entries.flatMap((entry) => {
    const key = normalizePathSync(entry.path);
    if (key !== oldKey && !key.startsWith(`${oldKey}/`)) return [entry];
    if (newPath === null) return [];
    const path = newPath.replace(/\/+$/, "") + entry.path.replaceAll("\\", "/").slice(oldPath.replaceAll("\\", "/").replace(/\/+$/, "").length);
    return [{ ...entry, path, name: path.split("/").pop() ?? entry.name }];
  });
}

export async function relocateProjectFavorites(root: string, oldPath: string, newPath: string | null): Promise<void> {
  await mutate(root, (entries) => relocateFavoriteEntries(entries, oldPath, newPath));
}

export function listenProjectFavorites(root: string, changed: () => void): Promise<() => void> {
  return listen<{ root: string }>(EVENT, (event) => {
    if (event.payload.root === normalizePathSync(root)) changed();
  });
}
