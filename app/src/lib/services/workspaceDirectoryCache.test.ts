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

  it("clear drops all cached and in-flight entries", async () => {
    const readDirFn = vi.fn(async () => [
      { name: "a.ts", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    const cache = createWorkspaceDirectoryCache({ readDirFn });

    await cache.readDir("/ws");
    cache.clear();
    await cache.readDir("/ws");

    expect(readDirFn).toHaveBeenCalledTimes(2);
  });
});
