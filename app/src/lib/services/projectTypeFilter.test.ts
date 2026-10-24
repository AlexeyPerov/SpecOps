import { afterEach, expect, it, vi } from "vitest";
import { createProjectTypeFilter, filterProjectNodes, matchesProjectFileFilter, type ProjectFilterSnapshot } from "./projectTypeFilter";
import { isOpenableFilePath } from "../editor/editorLanguage";
const dir = (name: string) => ({ name, isDirectory: true, isFile: false });
const file = (name: string) => ({ name, isDirectory: false, isFile: true });
afterEach(() => vi.useRealTimers());

it("recognizes images and texture sources without changing editor eligibility", () => {
  for (const path of ["a.PNG", "a.DDS", "a.ktx2", "a.EXR", "a.psb", "a.tiff", "a.tga", "a.hdr"]) expect(matchesProjectFileFilter(path, "images")).toBe(true);
  expect(matchesProjectFileFilter("a.dds.meta", "images")).toBe(false);
  expect(matchesProjectFileFilter("a.ts", "images")).toBe(false);
  expect(matchesProjectFileFilter("a.MD", "markdown")).toBe(true);
  expect(isOpenableFilePath("a.dds")).toBe(false);
});
it("starts only for an active filter, preserves nested matches and respects hidden/heavy policy", async () => {
  let snapshot!: ProjectFilterSnapshot;
  const listings = new Map([
    ["/repo", [dir("assets"), dir("empty"), dir(".hidden"), dir("node_modules"), file("readme.md")]],
    ["/repo/assets", [dir("nested")]], ["/repo/assets/nested", [file("a.DDS")]],
    ["/repo/empty", [file("a.ts")]], ["/repo/.hidden", [file("a.exr")]],
  ]);
  const readDir = vi.fn(async (path: string) => listings.get(path) ?? []);
  const c = createProjectTypeFilter({ readDir, publish: (value) => { snapshot = value; } });
  c.configure("/repo", "all", false, true); await vi.waitFor(() => expect(readDir).not.toHaveBeenCalled());
  c.configure("/repo", "images", true, true);
  await vi.waitFor(() => expect(snapshot.loading).toBe(false));
  const nodes = ["assets", "empty", ".hidden"].map((name) => ({ name, path: `/repo/${name}`, kind: "directory" as const }));
  expect(filterProjectNodes(nodes, "images", snapshot).map((n) => n.name)).toEqual(["assets", ".hidden"]);
  expect(readDir).not.toHaveBeenCalledWith("/repo/node_modules"); c.dispose();
});
it("keeps unreadable branches and their ancestors instead of claiming no matches", async () => {
  let snapshot!: ProjectFilterSnapshot;
  const c = createProjectTypeFilter({ readDir: async (path) => {
    if (path === "/repo") return [dir("assets")]; throw new Error("unreadable");
  }, publish: (value) => { snapshot = value; } });
  c.configure("/repo", "images", false, true);
  await vi.waitFor(() => expect(snapshot.loading).toBe(false));
  expect(snapshot.incomplete).toBe(true);
  expect(filterProjectNodes([{ name: "assets", path: "/repo/assets", kind: "directory" }], "images", snapshot)).toHaveLength(1);
  c.dispose();
});
it("cancels stale workspace enumeration and rebuilds once after a change burst", async () => {
  vi.useFakeTimers();
  let snapshot!: ProjectFilterSnapshot;
  let finish!: (value: ReturnType<typeof file>[]) => void;
  const readDir = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue([file("a.dds")]);
  const c = createProjectTypeFilter({ readDir, publish: (value) => { snapshot = value; } });
  c.configure("/old", "images", false, true); c.configure("/new", "images", false, true);
  finish([file("old.dds")]); await vi.advanceTimersByTimeAsync(1);
  expect(readDir).toHaveBeenCalledWith("/new"); expect(snapshot.loading).toBe(false);
  c.changed("/new/a.dds", "modify"); await vi.advanceTimersByTimeAsync(500); expect(readDir).toHaveBeenCalledTimes(2);
  c.changed("/new/b.dds", "create"); c.changed("/new/c.dds", "create");
  await vi.advanceTimersByTimeAsync(500); expect(readDir).toHaveBeenCalledTimes(3); c.dispose();
});
it("bounds a wide tree even when none of its files match", async () => {
  let snapshot!: ProjectFilterSnapshot;
  let last = 0;
  const c = createProjectTypeFilter({ readDir: async () => Array.from({ length: 100_010 }, (_, n) => file(`source_${n}.ts`)),
    publish: (value) => { snapshot = value; last += 1; } });
  c.configure("/repo", "images", false, true);
  await vi.waitFor(() => expect(snapshot.loading).toBe(false), { timeout: 5000 });
  expect(snapshot.incomplete).toBe(true);
  expect(snapshot.directories).toBeNull();
  expect(last).toBeLessThan(5); c.dispose();
});
