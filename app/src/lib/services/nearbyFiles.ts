import { dirname } from "@tauri-apps/api/path";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { normalizePathSync } from "./diskFingerprint";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? path;
}

function isTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  for (const extension of TEXT_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

export interface NearbyTextFile {
  path: string;
  basename: string;
}

export interface NearbyListEntry {
  name: string;
  isDirectory?: boolean;
}

export function listNearbyTextFiles(
  entries: NearbyListEntry[],
  options: {
    directoryPath: string;
    currentFilePath: string;
    openPaths: string[];
    limit?: number;
  },
): NearbyTextFile[] {
  const limit = options.limit ?? 10;
  const directoryBase = options.directoryPath.replace(/[\\/]+$/, "");
  const normalizedCurrent = normalizePathSync(options.currentFilePath);
  const openPathSet = new Set(options.openPaths.map((path) => normalizePathSync(path)));

  return entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => {
      const path = `${directoryBase}/${entry.name}`;
      const normalized = normalizePathSync(path);
      return { path, normalized, basename: basename(path) };
    })
    .filter((entry) => isTextPath(entry.path))
    .filter((entry) => entry.normalized !== normalizedCurrent)
    .filter((entry) => !openPathSet.has(entry.normalized))
    .sort((a, b) => a.basename.localeCompare(b.basename))
    .slice(0, limit)
    .map(({ path, basename: fileBasename }) => ({ path, basename: fileBasename }));
}

export async function readNearbyTextFiles(
  filePath: string,
  openPaths: string[],
  limit = 10,
): Promise<NearbyTextFile[]> {
  try {
    const directoryPath = await dirname(filePath);
    const entries = await readDir(directoryPath);
    return listNearbyTextFiles(entries, {
      directoryPath,
      currentFilePath: filePath,
      openPaths,
      limit,
    });
  } catch {
    return [];
  }
}

export async function openNearbyPath(path: string): Promise<{ path: string; content: string; sizeBytes: number }> {
  const content = await readTextFile(path);
  return {
    path,
    content,
    sizeBytes: new TextEncoder().encode(content).length,
  };
}
