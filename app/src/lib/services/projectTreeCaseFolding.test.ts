import { beforeEach, describe, expect, it, vi } from "vitest";

// macOS/Windows fold paths for comparison, so every comparison key differs from
// the tree's own spelling for any path with an uppercase segment — which, with
// `/Users/...`, is every path on a Mac. The default test platform is
// case-sensitive, so these cases would be invisible without this mock.
vi.mock("./platform", () => ({
  isMacOs: () => true,
  isWindows: () => false,
  isCaseInsensitivePathPlatform: () => true,
  revealInFileManagerLabel: () => "Reveal in Finder",
}));

const {
  createProjectTreeController,
  directoriesToRefreshForChange,
  expandedAncestorPathsForFile,
} = await import("./projectTreeController");
type ProjectTreeNode = import("./projectTree").ProjectTreeNode;

const ROOT = "/Users/Me/Repo";

function makeNode(name: string, path: string, kind: "directory" | "file"): ProjectTreeNode {
  return { name, path, kind };
}

describe("project tree on a case-folding platform", () => {
  let listings: Map<string, ProjectTreeNode[]>;
  const loadDirectoryChildrenFn = async (
    _workspaceRoot: string,
    directoryPath: string,
  ): Promise<ProjectTreeNode[]> => listings.get(directoryPath) ?? [];

  beforeEach(() => {
    listings = new Map<string, ProjectTreeNode[]>([
      [ROOT, [makeNode("Src", `${ROOT}/Src`, "directory")]],
      [`${ROOT}/Src`, [makeNode("main.ts", `${ROOT}/Src/main.ts`, "file")]],
    ]);
  });

  it("keeps the tree's spelling in the ancestors it expands for the active file", () => {
    expect(expandedAncestorPathsForFile(ROOT, `${ROOT}/Src/Lib/main.ts`)).toEqual([
      `${ROOT}/Src`,
      `${ROOT}/Src/Lib`,
    ]);
  });

  it("matches a changed path against the expanded folders it is under", () => {
    const dirs = directoriesToRefreshForChange(
      ROOT,
      `${ROOT}/Src/main.ts`,
      new Set([`${ROOT}/Src`]),
    );
    expect(dirs).toContain("/users/me/repo/src");
  });

  it("stores a reloaded listing under the key its row reads", async () => {
    const controller = createProjectTreeController(() => {}, { loadDirectoryChildrenFn });
    await controller.loadProjectTreeRoot({ workspaceRoot: ROOT, isSessionTabActive: false });
    await controller.handleToggleProjectTreeDirectory(ROOT, `${ROOT}/Src`);

    listings.set(`${ROOT}/Src`, [
      makeNode("main.ts", `${ROOT}/Src/main.ts`, "file"),
      makeNode("added.ts", `${ROOT}/Src/added.ts`, "file"),
    ]);
    // The debounced watcher flush reloads comparison-form directories.
    await controller.reloadDirectories(ROOT, ["/users/me/repo/src"]);

    expect(
      controller.getState().childrenByPath.get(`${ROOT}/Src`)?.map((node) => node.name),
    ).toEqual(["main.ts", "added.ts"]);
  });

  it("keeps the root rows spelled as the tree spells them after a folded reload", async () => {
    const controller = createProjectTreeController(() => {}, { loadDirectoryChildrenFn });
    await controller.loadProjectTreeRoot({ workspaceRoot: ROOT, isSessionTabActive: false });

    await controller.reloadDirectories("/users/me/repo", ["/users/me/repo"]);

    expect(controller.getState().rootNodes.map((node) => node.path)).toEqual([`${ROOT}/Src`]);
  });

  it("drops the shared cached listings before an authoritative reload", async () => {
    const invalidateDirectoryCache = vi.fn();
    const controller = createProjectTreeController(() => {}, {
      loadDirectoryChildrenFn,
      invalidateDirectoryCache,
    });
    await controller.loadProjectTreeRoot({ workspaceRoot: ROOT, isSessionTabActive: false });
    invalidateDirectoryCache.mockClear();

    await controller.reloadDirectories(ROOT, [ROOT, `${ROOT}/Src`]);

    expect(invalidateDirectoryCache).toHaveBeenCalledWith([
      "/users/me/repo",
      "/users/me/repo/src",
    ]);
  });
});
