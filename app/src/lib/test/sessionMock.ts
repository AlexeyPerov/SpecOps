import { vi } from "vitest";
import type { AppSessionSnapshot } from "../domain/contracts";

/** In-memory session.json backing store for unit tests. */
export function createSessionFsMock() {
  let sessionStore: AppSessionSnapshot | null = null;
  const diskFiles = new Map<string, string>();

  const readTextFile = vi.fn(async (path: string) => {
    if (path.endsWith("/session.json") || path.endsWith("/session.backup.json")) {
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
    if (path.includes("session")) {
      sessionStore = JSON.parse(content) as AppSessionSnapshot;
      return;
    }
    diskFiles.set(path, content);
  });

  return {
    diskFiles,
    getSessionStore: () => sessionStore,
    setSessionStore: (snapshot: AppSessionSnapshot | null) => {
      sessionStore = snapshot;
    },
    readTextFile,
    writeTextFile,
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
