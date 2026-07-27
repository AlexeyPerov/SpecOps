import { describe, expect, it } from "vitest";
import type { ProjectTreeNode } from "./projectTree";
import { flattenProjectTree, projectTreeRowKey } from "./projectTreeFlatten";

function dir(path: string): ProjectTreeNode {
  return { name: path.split("/").pop() ?? path, path, kind: "directory" };
}

function file(path: string): ProjectTreeNode {
  return { name: path.split("/").pop() ?? path, path, kind: "file" };
}

const none = new Set<string>();
const noChildren = new Map<string, ProjectTreeNode[]>();

describe("flattenProjectTree", () => {
  it("emits collapsed roots only", () => {
    const rows = flattenProjectTree([dir("/r/a"), file("/r/x.txt")], none, noChildren, none);
    expect(rows.map(projectTreeRowKey)).toEqual(["/r/a", "/r/x.txt"]);
    expect(rows[0]).toMatchObject({ kind: "node", depth: 0, canExpand: true, expanded: false });
  });

  it("recurses into expanded directories with loaded children", () => {
    const children = new Map([["/r/a", [file("/r/a/1.txt"), dir("/r/a/b")]]]);
    const rows = flattenProjectTree([dir("/r/a")], new Set(["/r/a"]), children, none);
    expect(rows.map(projectTreeRowKey)).toEqual(["/r/a", "/r/a/1.txt", "/r/a/b"]);
    expect(rows[1]).toMatchObject({ depth: 1 });
  });

  it("emits a loading row for an expanded directory still loading", () => {
    const rows = flattenProjectTree(
      [dir("/r/a")],
      new Set(["/r/a"]),
      noChildren,
      new Set(["/r/a"]),
    );
    expect(rows.map(projectTreeRowKey)).toEqual(["/r/a", "loading:/r/a"]);
    expect(rows[1]).toMatchObject({ kind: "loading", depth: 1 });
  });

  it("treats a loaded-empty directory as not expandable and emits no children", () => {
    const children = new Map([["/r/empty", [] as ProjectTreeNode[]]]);
    const rows = flattenProjectTree(
      [dir("/r/empty")],
      new Set(["/r/empty"]),
      children,
      none,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ canExpand: false, expanded: true });
  });

  it("does not recurse into collapsed directories", () => {
    const children = new Map([["/r/a", [file("/r/a/1.txt")]]]);
    const rows = flattenProjectTree([dir("/r/a")], none, children, none);
    expect(rows).toHaveLength(1);
  });
});
