import { describe, expect, it, vi } from "vitest";
import { createWorkspaceDirectoryCache } from "./workspaceDirectoryCache";

describe("createWorkspaceDirectoryCache", () => {
  it("memoizes readDir results by normalized path", async () => {
    const readDirFn = vi.fn(async (path: string) => [
      { name: "a.ts", isDirectory: false, isFile: true, isSymlink: false, path: `${path}/a.ts` },
    ]);
    const cache = createWorkspaceDirectoryCache({ readDirFn });

    await cache.readDir("/ws");
    await cache.readDir("/ws/");
    await cache.readDir("/ws");

    expect(readDirFn).toHaveBeenCalledTimes(1);
    expect(readDirFn).toHaveBeenCalledWith("/ws");
  });

  it("coalesces concurrent readDir calls for the same path", async () => {
    let resolveRead!: (value: unknown[]) => void;
    const readDirFn = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const cache = createWorkspaceDirectoryCache({ readDirFn });

    const first = cache.readDir("/ws");
    const second = cache.readDir("/ws");
    resolveRead([{ name: "a.ts", isDirectory: false, isFile: true, isSymlink: false }]);
    const [a, b] = await Promise.all([first, second]);

    expect(readDirFn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("invalidates cached directories", async () => {
    const readDirFn = vi.fn(async () => [
      { name: "a.ts", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    const cache = createWorkspaceDirectoryCache({ readDirFn });

    await cache.readDir("/ws");
    cache.invalidate(["/ws"]);
    await cache.readDir("/ws");

    expect(readDirFn).toHaveBeenCalledTimes(2);
  });

  it("evicts oldest entries when over maxEntries", async () => {
    const readDirFn = vi.fn(async (path: string) => [
      { name: "a.ts", isDirectory: false, isFile: true, isSymlink: false, path: `${path}/a.ts` },
    ]);
    const cache = createWorkspaceDirectoryCache({ readDirFn, maxEntries: 2 });

    await cache.readDir("/ws/a");
    await cache.readDir("/ws/b");
    await cache.readDir("/ws/c");

    expect(cache.size()).toBe(2);
    await cache.readDir("/ws/a");
    expect(readDirFn).toHaveBeenCalledWith("/ws/a");
    // First /ws/a was evicted; third call to /ws/a is a miss.
    expect(readDirFn.mock.calls.filter((call) => call[0] === "/ws/a")).toHaveLength(2);
  });

  it("discards in-flight listings invalidated before they settle", async () => {
    let resolveFirst!: (value: unknown[]) => void;
    const readDirFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<unknown[]>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([
        { name: "fresh.ts", isDirectory: false, isFile: true, isSymlink: false },
      ]);
    const cache = createWorkspaceDirectoryCache({ readDirFn });

    const pending = cache.readDir("/ws");
    cache.invalidate(["/ws"]);
    resolveFirst([{ name: "stale.ts", isDirectory: false, isFile: true, isSymlink: false }]);
    const result = await pending;

    expect(result[0]?.name).toBe("fresh.ts");
    expect(readDirFn).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(1);
  });
});
