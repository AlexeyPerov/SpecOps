import { describe, expect, it, vi } from "vitest";
import {
  createProjectTreeController,
  directoriesToInvalidateForChange,
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

describe("directoriesToInvalidateForChange", () => {
  it("always includes parent even when not expanded", () => {
    const dirs = directoriesToInvalidateForChange("/repo", "/repo/src/deep/file.ts");
    expect(dirs).toContain("/repo");
    expect(dirs).toContain("/repo/src/deep");
    expect(dirs).toContain("/repo/src/deep/file.ts");
  });

  it("returns empty for paths outside workspace", () => {
    expect(directoriesToInvalidateForChange("/repo", "/other/x.txt")).toEqual([]);
  });
});

describe("directoriesToRefreshForChange", () => {
  it("includes workspace root parent and expanded dirs", () => {
    const expanded = new Set(["/repo/src"]);
    const dirs = directoriesToRefreshForChange("/repo", "/repo/src/main.ts", expanded);
    expect(dirs).toContain("/repo");
    expect(dirs).toContain("/repo/src");
  });

  it("omits collapsed deep parents from the tree refresh set", () => {
    expect(
      directoriesToRefreshForChange("/repo", "/repo/src/deep/file.ts", new Set()),
    ).toEqual([]);
  });

  it("returns empty for paths outside workspace", () => {
    expect(directoriesToRefreshForChange("/repo", "/other/x.txt", new Set())).toEqual([]);
  });
});

describe("createProjectTreeController", () => {
  it("publishes loading and loaded states once per child directory load", async () => {
    const snapshots: ProjectTreeControllerState[] = [];
    const loadDirectoryChildrenFn = vi.fn(async (workspaceRoot: string, directoryPath: string) => {
      if (workspaceRoot !== "/repo") {
        return [];
      }
      if (directoryPath === "/repo") {
        return [makeNode("src", "/repo/src", "directory")];
      }
      if (directoryPath === "/repo/src") {
        return [makeNode("main.ts", "/repo/src/main.ts", "file")];
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
    const publishCountBefore = snapshots.length;

    await controller.loadProjectTreeChildren("/repo", "/repo/src");

    const publishCountAfter = snapshots.length;
    expect(publishCountAfter - publishCountBefore).toBe(2);
    const lastState = snapshots[publishCountAfter - 1];
    expect(lastState.loadingPaths.has("/repo/src")).toBe(false);
    expect(lastState.childrenByPath.get("/repo/src")?.map((node) => node.path)).toEqual([
      "/repo/src/main.ts",
    ]);
  });

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
    const publishCountBefore = snapshots.length;
    await controller.ensureExpandedForActiveFile("/repo", "/repo/src/lib/main.ts");
    const publishCountAfter = snapshots.length;

    const lastState = snapshots[snapshots.length - 1];
    expect(lastState.expandedPaths).toEqual(new Set(["/repo/src", "/repo/src/lib"]));
    expect(lastState.childrenByPath.get("/repo/src")?.map((node) => node.path)).toEqual([
      "/repo/src/lib",
    ]);
    expect(lastState.childrenByPath.get("/repo/src/lib")?.map((node) => node.path)).toEqual([
      "/repo/src/lib/main.ts",
    ]);
    expect(publishCountAfter - publishCountBefore).toBeLessThanOrEqual(5);
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

  it("skips directory IO when root is already loaded for the same workspace", async () => {
    const loadDirectoryChildrenFn = vi.fn(async () => [
      makeNode("src", "/repo/src", "directory"),
    ]);
    const controller = createProjectTreeController(() => {}, { loadDirectoryChildrenFn });

    await controller.loadProjectTreeRoot({ workspaceRoot: "/repo", isSessionTabActive: false });
    await controller.loadProjectTreeRoot({ workspaceRoot: "/repo", isSessionTabActive: false });
    await controller.loadProjectTreeRoot({ workspaceRoot: "/repo", isSessionTabActive: true });

    expect(loadDirectoryChildrenFn).toHaveBeenCalledTimes(1);
  });

  it("ignores a slower root load from a previous workspace after a switch", async () => {
    let resolveUnity: ((nodes: ProjectTreeNode[]) => void) | null = null;
    const loadDirectoryChildrenFn = vi.fn(async (workspaceRoot: string) => {
      if (workspaceRoot === "/unity") {
        return await new Promise<ProjectTreeNode[]>((resolve) => {
          resolveUnity = resolve;
        });
      }
      return [makeNode("archero", "/notes/archero", "file")];
    });
    const snapshots: ProjectTreeControllerState[] = [];
    const controller = createProjectTreeController(
      (state) => snapshots.push(state),
      { loadDirectoryChildrenFn },
    );

    const unityLoad = controller.loadProjectTreeRoot({
      workspaceRoot: "/unity",
      isSessionTabActive: false,
    });
    await controller.loadProjectTreeRoot({
      workspaceRoot: "/notes",
      isSessionTabActive: false,
    });
    const afterNotes = snapshots[snapshots.length - 1];
    expect(afterNotes.rootNodes.map((node) => node.path)).toEqual(["/notes/archero"]);

    resolveUnity?.([makeNode("hub", "/unity/hub", "directory")]);
    await unityLoad;

    const afterStale = snapshots[snapshots.length - 1];
    expect(afterStale.rootNodes.map((node) => node.path)).toEqual(["/notes/archero"]);
  });

  it("reloads root when force is set", async () => {
    const loadDirectoryChildrenFn = vi.fn(async () => [
      makeNode("src", "/repo/src", "directory"),
    ]);
    const controller = createProjectTreeController(() => {}, { loadDirectoryChildrenFn });

    await controller.loadProjectTreeRoot({ workspaceRoot: "/repo", isSessionTabActive: false });
    await controller.refreshProjectTree("/repo", false);

    expect(loadDirectoryChildrenFn).toHaveBeenCalledTimes(2);
  });
});
