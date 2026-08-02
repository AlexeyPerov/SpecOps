import { vi } from "vitest";
import type { AppSessionSnapshot } from "../domain/contracts";

/** In-memory session.json backing store for unit tests. */
export function createSessionFsMock() {
  let sessionStore: AppSessionSnapshot | null = null;
  const diskFiles = new Map<string, string>();
  const isPrimarySessionPath = (path: string): boolean =>
    path.endsWith("/session.json") || path.includes("/session.json.");
  const isBackupSessionPath = (path: string): boolean =>
    path.endsWith("/session.backup.json") || path.includes("/session.backup.json.");

  const readTextFile = vi.fn(async (path: string) => {
    if (isPrimarySessionPath(path) || isBackupSessionPath(path)) {
      if (!sessionStore) {
        throw new Error("no such file or directory");
      }
      return JSON.stringify(sessionStore);
    }
    if (diskFiles.has(path)) {
      return diskFiles.get(path)!;
    }
    throw new Error(`no such file or directory: ${path}`);
  });

  const writeTextFile = vi.fn(async (path: string, content: string) => {
    if (isPrimarySessionPath(path) || isBackupSessionPath(path)) {
      sessionStore = JSON.parse(content) as AppSessionSnapshot;
      return;
    }
    diskFiles.set(path, content);
  });

  /** Metadata-only existence probe mirroring readTextFile's view of disk. */
  const stat = vi.fn(async (path: string) => {
    if (isPrimarySessionPath(path) || isBackupSessionPath(path)) {
      if (!sessionStore) {
        throw new Error("no such file or directory");
      }
      return { size: JSON.stringify(sessionStore).length, mtime: new Date() };
    }
    if (diskFiles.has(path)) {
      return { size: diskFiles.get(path)!.length, mtime: new Date() };
    }
    throw new Error(`no such file or directory: ${path}`);
  });

  /** Atomic-write (temp + rename) and lock-dir helpers; permissive no-ops. */
  const rename = vi.fn(async (from: string, to: string) => {
    if (diskFiles.has(from)) {
      diskFiles.set(to, diskFiles.get(from)!);
      diskFiles.delete(from);
    }
  });
  const remove = vi.fn(async (path: string) => {
    // Mirror a real remove so cleanup paths (incremental session teardown)
    // observe the file disappearing from subsequent listings.
    for (const key of [...diskFiles.keys()]) {
      if (key === path) {
        diskFiles.delete(key);
      }
    }
  });
  const mkdir = vi.fn(async () => undefined);
  /**
   * Directory listing over the in-memory file map. Returns the basenames the
   * incremental session layer writes under the data dir so prefix-based buffer
   * cleanup can be exercised without a real filesystem.
   */
  const readDir = vi.fn(async (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }> = [];
    for (const key of diskFiles.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const rest = key.slice(prefix.length);
      if (rest.length === 0 || rest.includes("/")) {
        continue;
      }
      entries.push({ name: rest, isDirectory: false, isFile: true });
    }
    return entries;
  });

  function restoreFsImplementations(): void {
    readTextFile.mockReset();
    writeTextFile.mockReset();
    rename.mockReset();
    remove.mockReset();
    readDir.mockReset();
    readTextFile.mockImplementation(async (path: string) => {
      if (isPrimarySessionPath(path) || isBackupSessionPath(path)) {
        if (!sessionStore) {
          throw new Error("no such file or directory");
        }
        return JSON.stringify(sessionStore);
      }
      if (diskFiles.has(path)) {
        return diskFiles.get(path)!;
      }
      throw new Error(`no such file or directory: ${path}`);
    });
    writeTextFile.mockImplementation(async (path: string, content: string) => {
      if (isPrimarySessionPath(path) || isBackupSessionPath(path)) {
        sessionStore = JSON.parse(content) as AppSessionSnapshot;
        return;
      }
      diskFiles.set(path, content);
    });
    rename.mockImplementation(async (from: string, to: string) => {
      if (diskFiles.has(from)) {
        diskFiles.set(to, diskFiles.get(from)!);
        diskFiles.delete(from);
      }
    });
    remove.mockImplementation(async (path: string) => {
      for (const key of [...diskFiles.keys()]) {
        if (key === path) {
          diskFiles.delete(key);
        }
      }
    });
    readDir.mockImplementation(async (dir: string) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }> = [];
      for (const key of diskFiles.keys()) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        if (rest.length === 0 || rest.includes("/")) {
          continue;
        }
        entries.push({ name: rest, isDirectory: false, isFile: true });
      }
      return entries;
    });
  }

  return {
    diskFiles,
    getSessionStore: () => sessionStore,
    setSessionStore: (snapshot: AppSessionSnapshot | null) => {
      sessionStore = snapshot;
    },
    readTextFile,
    writeTextFile,
    stat,
    rename,
    remove,
    mkdir,
    readDir,
    /** Clears call history and restores default read/write implementations. */
    restoreFsImplementations,
  };
}

export async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
