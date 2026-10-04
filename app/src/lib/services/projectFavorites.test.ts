import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ raw: "{}", chain: Promise.resolve(), listeners: [] as ((event: { payload: { root: string } }) => void)[] }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/") }));
vi.mock("./appDataDir", () => ({ ensureSpecOpsDataDir: async () => "/data" }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: async () => true, readTextFile: async () => io.raw }));
vi.mock("./atomicWrite", () => ({ atomicWriteTextFile: async (_path: string, raw: string) => { io.raw = raw; } }));
vi.mock("./sessionWriteLock", () => ({ withProjectFavoritesLock: (fn: () => Promise<void>) => {
  const next = io.chain.then(fn); io.chain = next.catch(() => {}); return next;
} }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: async (_event: string, payload: { root: string }) => { for (const listener of io.listeners) listener({ payload }); },
  listen: async (_event: string, listener: (event: { payload: { root: string } }) => void) => {
    io.listeners.push(listener); return () => { io.listeners = io.listeners.filter((entry) => entry !== listener); };
  },
}));
import { decodeProjectFavorites, loadProjectFavorites, setProjectFavorite, listenProjectFavorites, relocateProjectFavorites } from "./projectFavorites";
const node = (path: string, kind: "file" | "directory" = "file") => ({ path, name: path.split("/").pop()!, kind });
beforeEach(() => { io.raw = "{}"; io.chain = Promise.resolve(); io.listeners = []; });
describe("project favorites", () => {
  it("preserves concurrent additions and project isolation, sorts alphabetically and notifies both windows", async () => {
    const first = vi.fn(); const second = vi.fn(); const other = vi.fn();
    const stop = await listenProjectFavorites("/repo", first);
    await listenProjectFavorites("/repo", second);
    await listenProjectFavorites("/other", other);
    await Promise.all([
      setProjectFavorite("/repo", node("/repo/z.md"), true),
      setProjectFavorite("/repo", node("/repo/a.md"), true),
      setProjectFavorite("/other", node("/other/b.md"), true),
    ]);
    expect((await loadProjectFavorites("/repo")).map((entry) => entry.name)).toEqual(["a.md", "z.md"]);
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2); expect(other).toHaveBeenCalledTimes(1);
    stop();
    await setProjectFavorite("/repo", node("/repo/a.md"), false);
    expect(first).toHaveBeenCalledTimes(2);
    expect((await loadProjectFavorites("/other"))[0].name).toBe("b.md");
  });
  it("moves descendant favorites and removes deleted entries without touching similarly named folders", async () => {
    await setProjectFavorite("/repo", node("/repo/docs", "directory"), true);
    await setProjectFavorite("/repo", node("/repo/docs/a.md"), true);
    await setProjectFavorite("/repo", node("/repo/docs-old/b.md"), true);
    await relocateProjectFavorites("/repo", "/repo/docs", "/repo/notes");
    expect((await loadProjectFavorites("/repo")).map((entry) => entry.path)).toEqual(["/repo/notes/a.md", "/repo/docs-old/b.md", "/repo/notes"]);
    await relocateProjectFavorites("/repo", "/repo/notes", null);
    expect((await loadProjectFavorites("/repo")).map((entry) => entry.path)).toEqual(["/repo/docs-old/b.md"]);
  });
  it("rejects outside paths and removes duplicate or malformed stored entries", async () => {
    await expect(setProjectFavorite("/repo", node("/other/a.md"), true)).rejects.toThrow();
    expect(decodeProjectFavorites({ "/repo": [node("/repo/a.md"), node("/repo/a.md"), node("/other/b.md"), { kind: "bad" }] })).toEqual({ "/repo": [node("/repo/a.md")] });
  });
});
