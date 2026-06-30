import { describe, expect, it, vi } from "vitest";
import {
  createProjectTreeController,
  directoriesToRefreshForChange,
  expandedAncestorPathsForFile,
  type ProjectTreeControllerState,
} from "./projectTreeController";
import type { ProjectTreeNode } from "./projectTree";

function makeNode(name: string, path: string, kind: "directory" | "file"): ProjectTreeNode {
  return { name, path, kind };
}

describe("expandedAncestorPathsForFile", () => {
  it("returns ancestors for file under workspace root", () => {
    expect(expandedAncestorPathsForFile("/repo", "/repo/src/lib/main.ts")).toEqual([
      "/repo/src",
      "/repo/src/lib",
    ]);
  });

  it("returns empty for root-level file", () => {
    expect(expandedAncestorPathsForFile("/repo", "/repo/main.ts")).toEqual([]);
  });

  it("returns empty for paths outside root", () => {
    expect(expandedAncestorPathsForFile("/repo", "/other/main.ts")).toEqual([]);
  });
});

describe("directoriesToRefreshForChange", () => {
  it("includes workspace root parent and expanded dirs", () => {
    const expanded = new Set(["/repo/src"]);
    const dirs = directoriesToRefreshForChange("/repo", "/repo/src/main.ts", expanded);
    expect(dirs).toContain("/repo");
    expect(dirs).toContain("/repo/src");
  });

  it("returns empty for paths outside workspace", () => {
    expect(directoriesToRefreshForChange("/repo", "/other/x.txt", new Set())).toEqual([]);
  });
});

describe("createProjectTreeController", () => {
  it("expands and loads missing ancestors for active file", async () => {
    const snapshots: ProjectTreeControllerState[] = [];
    const loadDirectoryChildrenFn = vi.fn(async (workspaceRoot: string, directoryPath: string) => {
      if (workspaceRoot !== "/repo") {
        return [];
      }
      if (directoryPath === "/repo") {
        return [makeNode("src", "/repo/src", "directory")];
      }
      if (directoryPath === "/repo/src") {
        return [makeNode("lib", "/repo/src/lib", "directory")];
      }
      if (directoryPath === "/repo/src/lib") {
        return [makeNode("main.ts", "/repo/src/lib/main.ts", "file")];
      }
      return [];
    });
    const controller = createProjectTreeController(
      (state) => snapshots.push(state),
      { loadDirectoryChildrenFn },
    );

    await controller.loadProjectTreeRoot({
      workspaceRoot: "/repo",
      isSessionTabActive: false,
    });
    await controller.ensureExpandedForActiveFile("/repo", "/repo/src/lib/main.ts");

    const lastState = snapshots[snapshots.length - 1];
    expect(lastState.expandedPaths).toEqual(new Set(["/repo/src", "/repo/src/lib"]));
    expect(lastState.childrenByPath.get("/repo/src")?.map((node) => node.path)).toEqual([
      "/repo/src/lib",
    ]);
    expect(lastState.childrenByPath.get("/repo/src/lib")?.map((node) => node.path)).toEqual([
      "/repo/src/lib/main.ts",
    ]);
  });

  it("does not reload ancestors that are already expanded and loaded", async () => {
    const snapshots: ProjectTreeControllerState[] = [];
    const loadDirectoryChildrenFn = vi.fn(async (workspaceRoot: string, directoryPath: string) => {
      if (workspaceRoot !== "/repo") {
        return [];
      }
      if (directoryPath === "/repo") {
        return [makeNode("src", "/repo/src", "directory")];
      }
      if (directoryPath === "/repo/src") {
        return [makeNode("lib", "/repo/src/lib", "directory")];
      }
      if (directoryPath === "/repo/src/lib") {
        return [makeNode("main.ts", "/repo/src/lib/main.ts", "file")];
      }
      return [];
    });
    const controller = createProjectTreeController(
      (state) => snapshots.push(state),
      { loadDirectoryChildrenFn },
    );

    await controller.loadProjectTreeRoot({
      workspaceRoot: "/repo",
      isSessionTabActive: false,
    });
    await controller.ensureExpandedForActiveFile("/repo", "/repo/src/lib/main.ts");
    loadDirectoryChildrenFn.mockClear();
    const publishCountBefore = snapshots.length;

    await controller.ensureExpandedForActiveFile("/repo", "/repo/src/lib/main.ts");

    expect(loadDirectoryChildrenFn).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(publishCountBefore);
  });

  it("resets state when workspace root is missing", async () => {
    const snapshots: ProjectTreeControllerState[] = [];
    const controller = createProjectTreeController((state) => snapshots.push(state), {
      loadDirectoryChildrenFn: vi.fn(async () => [makeNode("src", "/repo/src", "directory")]),
    });
    await controller.loadProjectTreeRoot({ workspaceRoot: "/repo", isSessionTabActive: false });
    await controller.loadProjectTreeRoot({ workspaceRoot: null, isSessionTabActive: false });

    const lastState = snapshots[snapshots.length - 1];
    expect(lastState.rootNodes).toEqual([]);
    expect(lastState.childrenByPath.size).toBe(0);
    expect(lastState.expandedPaths.size).toBe(0);
    expect(lastState.loadingPaths.size).toBe(0);
  });
});
