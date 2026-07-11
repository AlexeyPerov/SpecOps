import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFileCatalog } from "./workspaceFileCatalog";
import type { EnumerateOpenableFilesResult } from "./workspaceTraversal";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createWorkspaceFileCatalog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enumerates entries with relative paths and skips content reads", async () => {
    const enumerate = vi.fn(async () => ({
      paths: ["/ws/src/a.ts", "/ws/README"],
      partialErrors: ["/ws/locked"],
      cancelled: false,
    }));
    const catalog = createWorkspaceFileCatalog({ enumerate });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));

    const snap = catalog.getSnapshot();
    expect(snap.entries).toEqual([
      expect.objectContaining({
        absolutePath: expect.stringMatching(/\/ws\/src\/a\.ts$/),
        relativePath: "src/a.ts",
        basename: "a.ts",
      }),
      expect.objectContaining({
        relativePath: "README",
        basename: "README",
      }),
    ]);
    expect(snap.partialErrors).toEqual(["/ws/locked"]);
    expect(catalog.getOpenablePaths()).toHaveLength(2);
    expect(enumerate).toHaveBeenCalledTimes(1);
    catalog.dispose();
  });

  it("suppresses stale enumeration when a newer generation finishes first", async () => {
    const first = deferred<EnumerateOpenableFilesResult>();
    const second = deferred<EnumerateOpenableFilesResult>();
    let call = 0;
    const enumerate = vi.fn((_root: string, options: { isCancelled: () => boolean }) => {
      call += 1;
      if (call === 1) {
        return first.promise.then((result) => {
          // Simulate slow walk checking cancellation before apply
          if (options.isCancelled()) {
            return { paths: [], partialErrors: [], cancelled: true };
          }
          return result;
        });
      }
      return second.promise;
    });

    const catalog = createWorkspaceFileCatalog({ enumerate });
    catalog.setWorkspaceRoot("/ws-a");
    catalog.setWorkspaceRoot("/ws-b");

    second.resolve({
      paths: ["/ws-b/new.ts"],
      partialErrors: [],
      cancelled: false,
    });
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));
    expect(catalog.getSnapshot().workspaceRoot).toMatch(/ws-b$/);
    expect(catalog.getOpenablePaths()?.some((p) => p.endsWith("new.ts"))).toBe(true);

    first.resolve({
      paths: ["/ws-a/old.ts"],
      partialErrors: [],
      cancelled: false,
    });
    await Promise.resolve();
    expect(catalog.getOpenablePaths()?.some((p) => p.endsWith("old.ts"))).toBe(false);
    catalog.dispose();
  });

  it("clears state on dispose and ignores later completions", async () => {
    const pending = deferred<EnumerateOpenableFilesResult>();
    const enumerate = vi.fn(() => pending.promise);
    const catalog = createWorkspaceFileCatalog({ enumerate });
    catalog.setWorkspaceRoot("/ws");
    catalog.dispose();
    expect(catalog.getSnapshot().status).toBe("idle");
    expect(catalog.getOpenablePaths()).toBeNull();

    pending.resolve({ paths: ["/ws/a.ts"], partialErrors: [], cancelled: false });
    await Promise.resolve();
    expect(catalog.getSnapshot().entries).toEqual([]);
  });

  it("debounces watcher invalidation into one rebuild", async () => {
    vi.useFakeTimers();
    const enumerate = vi.fn(async () => ({
      paths: ["/ws/a.ts"],
      partialErrors: [],
      cancelled: false,
    }));
    const catalog = createWorkspaceFileCatalog({
      enumerate,
      invalidateDebounceMs: 50,
    });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));
    expect(enumerate).toHaveBeenCalledTimes(1);

    catalog.notifyFilesystemChange("/ws/a.ts");
    catalog.notifyFilesystemChange("/ws/b.ts");
    catalog.notifyFilesystemChange("/ws/c.ts");
    expect(enumerate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(enumerate).toHaveBeenCalledTimes(2));
    catalog.dispose();
  });

  it("records non-fatal partial directory errors without failing the catalog", async () => {
    const catalog = createWorkspaceFileCatalog({
      enumerate: async () => ({
        paths: ["/ws/ok.ts"],
        partialErrors: ["/ws/unreadable"],
        cancelled: false,
      }),
    });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));
    expect(catalog.getSnapshot().partialErrors).toEqual(["/ws/unreadable"]);
    expect(catalog.getSnapshot().errorMessage).toBeNull();
    catalog.dispose();
  });

  it("passes isCancelled that flips when workspace changes", async () => {
    const seen: boolean[] = [];
    const pending = deferred<EnumerateOpenableFilesResult>();
    const enumerate = vi.fn((_root: string, options: { isCancelled: () => boolean }) => {
      seen.push(options.isCancelled());
      return pending.promise.then((result) => {
        seen.push(options.isCancelled());
        return options.isCancelled()
          ? { paths: [], partialErrors: [], cancelled: true }
          : result;
      });
    });
    const catalog = createWorkspaceFileCatalog({ enumerate });
    catalog.setWorkspaceRoot("/ws");
    catalog.setWorkspaceRoot(null);
    pending.resolve({ paths: ["/ws/a.ts"], partialErrors: [], cancelled: false });
    await Promise.resolve();
    expect(seen[0]).toBe(false);
    expect(seen[1]).toBe(true);
    expect(catalog.getSnapshot().status).toBe("idle");
    catalog.dispose();
  });
});
