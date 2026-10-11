import { describe, expect, it } from "vitest";
import { selectProjectPaths, topLevelProjectEntries } from "./projectSelection";
describe("project selection", () => {
  it("extends through all visible rows, including virtualized rows", () => {
    const visible = Array.from({ length: 400 }, (_, i) => `/p/${i}`);
    const result = selectProjectPaths(new Set([visible[10]]), visible[10], visible[300], visible, { shift: true, toggle: false });
    expect(result.paths.size).toBe(291); expect(result.anchor).toBe(visible[10]);
  });
  it("toggles independent rows without opening a file", () => {
    const selected = new Set(["/p/a"]);
    expect([...selectProjectPaths(selected, null, "/p/b", [], { shift: false, toggle: true }).paths]).toEqual(["/p/a", "/p/b"]);
    expect(selectProjectPaths(selected, null, "/p/a", [], { shift: false, toggle: true }).paths.size).toBe(0);
  });
  it("processes a selected parent only once, without confusing path prefixes", () => {
    const entries = [{ path: "/p/a", kind: "directory" as const, name: "a" }, { path: "/p/a/file", kind: "file" as const, name: "file" }, { path: "/p/ab", kind: "file" as const, name: "ab" }];
    expect(topLevelProjectEntries(entries)).toEqual([entries[0], entries[2]]);
  });
});
