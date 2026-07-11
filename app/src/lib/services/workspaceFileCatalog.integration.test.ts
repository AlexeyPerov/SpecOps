/**
 * Integration tests for the workspace file catalog against the real traversal
 * policy (mocked Tauri fs). Covers end-to-end enumeration, watcher-driven
 * incremental invalidation, workspace close/switch, generation cancellation,
 * and content-free diagnostics — the M1.1 acceptance checklist for Task 3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory filesystem keyed by absolute directory path. Each value is the
// list of entries a `readDir` call for that directory returns.
type FsDir = Record<string, { name: string; isDirectory: boolean; isFile: boolean }[]>;

const pathJoin = (a: string, b: string) => `${a.replace(/\/$/, "")}/${b}`;

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(async (dir: string) => {
    const fs = currentFs();
    if (!fs[dir]) {
      const error = new Error(`unreadable: ${dir}`);
      return Promise.reject(error);
    }
    return fs[dir];
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn(async (...segments: string[]) =>
    segments.reduce((acc, seg) => pathJoin(acc, seg)),
  ),
}));

// Mutable FS holder so each test can stage a fresh tree.
let fsState: FsDir = {};
function currentFs(): FsDir {
  return fsState;
}
function setFs(fs: FsDir): void {
  fsState = fs;
}

// Import after mocks are registered.
import { createWorkspaceFileCatalog } from "./workspaceFileCatalog";

function file(name: string): { name: string; isDirectory: boolean; isFile: boolean } {
  return { name, isDirectory: false, isFile: true };
}
function sub(name: string) {
  return { name, isDirectory: true, isFile: false };
}

/**
 * Build an in-memory FS tree from a nested object description and register it.
 * Keys are directory paths; values are entry lists.
 */
function stageFs(root: string, tree: Record<string, string[]>): void {
  const fs: FsDir = {};
  fs[root] = tree[root]?.map((name) =>
    name.endsWith("/") ? sub(name.slice(0, -1)) : file(name),
  ) ?? [];
  for (const [dirPath, names] of Object.entries(tree)) {
    if (dirPath === root) continue;
    fs[dirPath] = names.map((name) =>
      name.endsWith("/") ? sub(name.slice(0, -1)) : file(name),
    );
  }
  setFs(fs);
}

describe("workspace file catalog (integration)", () => {
  beforeEach(() => {
    setFs({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enumerates openable files end-to-end without reading contents", async () => {
    stageFs("/ws", {
      "/ws": ["src/", "README", ".hidden"],
      "/ws/src": ["a.ts", "b.md"],
    });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));

    const paths = catalog.getOpenablePaths()!;
    expect(paths.some((p) => p.endsWith("/ws/src/a.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/ws/src/b.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/ws/README"))).toBe(true);
    // Hidden file filtered by traversal policy.
    expect(paths.some((p) => p.endsWith(".hidden"))).toBe(false);
    catalog.dispose();
  });

  it("surfaces unreadable directories as non-fatal partial errors", async () => {
    stageFs("/ws", {
      "/ws": ["locked/", "ok.ts"],
      // "/ws/locked" intentionally absent → readDir rejects.
    });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));

    const snap = catalog.getSnapshot();
    expect(snap.status).toBe("ready");
    expect(snap.partialErrors.some((e) => e.endsWith("/ws/locked"))).toBe(true);
    expect(snap.entries.some((e) => e.absolutePath.endsWith("ok.ts"))).toBe(true);
    catalog.dispose();
  });

  it("incrementally adds a created file via a watcher event", async () => {
    stageFs("/ws", {
      "/ws": ["a.ts"],
    });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));
    expect(catalog.getSnapshot().entries).toHaveLength(1);

    catalog.notifyFilesystemChange("/ws/new.ts", "create");
    expect(
      catalog.getSnapshot().entries.some((e) => e.absolutePath.endsWith("new.ts")),
    ).toBe(true);
    catalog.dispose();
  });

  it("incrementally removes a deleted file via a watcher event", async () => {
    stageFs("/ws", {
      "/ws": ["a.ts", "b.ts"],
    });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));
    expect(catalog.getSnapshot().entries).toHaveLength(2);

    catalog.notifyFilesystemChange("/ws/a.ts", "remove");
    expect(
      catalog.getSnapshot().entries.some((e) => e.absolutePath.endsWith("a.ts")),
    ).toBe(false);
    expect(catalog.getSnapshot().entries).toHaveLength(1);
    catalog.dispose();
  });

  it("debounces a burst of watcher events into one rebuild", async () => {
    vi.useFakeTimers();
    stageFs("/ws", { "/ws": ["a.ts"] });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));

    // Simulate a rename storm that cannot be classified incrementally.
    for (let i = 0; i < 5; i += 1) {
      catalog.notifyFilesystemChange(`/ws/f${i}.ts`, "rename");
    }
    await vi.advanceTimersByTimeAsync(50);
    // Exactly one rebuild fired after the burst collapsed.
    expect(catalog.getDiagnostics().debouncedRebuilds).toBe(1);
    catalog.dispose();
  });

  it("cancels stale enumeration when switching workspaces mid-build", async () => {
    stageFs("/ws-a", { "/ws-a": ["a.ts"] });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws-a");
    // Immediately switch before the first build settles.
    stageFs("/ws-b", { "/ws-b": ["b.ts"] });
    catalog.setWorkspaceRoot("/ws-b");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));

    const snap = catalog.getSnapshot();
    expect(snap.workspaceRoot).toMatch(/ws-b$/);
    // ws-a candidate must not leak through.
    expect(snap.entries.every((e) => !e.absolutePath.includes("ws-a"))).toBe(true);
    expect(snap.entries.some((e) => e.absolutePath.endsWith("b.ts"))).toBe(true);
    catalog.dispose();
  });

  it("disposes cleanly on workspace close and ignores later events", async () => {
    stageFs("/ws", { "/ws": ["a.ts"] });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));

    catalog.dispose();
    expect(catalog.getSnapshot().status).toBe("idle");
    expect(catalog.getOpenablePaths()).toBeNull();
    // Events after dispose are no-ops.
    catalog.notifyFilesystemChange("/ws/a.ts", "remove");
    expect(catalog.getSnapshot().status).toBe("idle");
  });

  it("diagnostics contain entry counts and status but no file contents", async () => {
    stageFs("/ws", { "/ws": ["a.ts", "b.ts"] });
    const catalog = createWorkspaceFileCatalog({ invalidateDebounceMs: 50 });
    catalog.setWorkspaceRoot("/ws");
    await vi.waitFor(() => expect(catalog.getSnapshot().status).toBe("ready"));

    const diag = catalog.getDiagnostics();
    expect(diag.entryCount).toBe(2);
    expect(diag.status).toBe("ready");
    // Diagnostics object must not expose any entry contents.
    const json = JSON.stringify(diag);
    expect(json).not.toContain("a.ts");
    catalog.dispose();
  });
});
