import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../state/appState";
import {
  collapsePathSegments,
  ensureTabGroupForOutsidePath,
  isPathUnderRoot,
  runInTabGroupContext,
  workspaceRelativePath,
} from "./workspacePaths";

describe("collapsePathSegments", () => {
  it("resolves . and .. segments", () => {
    expect(collapsePathSegments("/Users/me/ws/../secrets")).toBe("/Users/me/secrets");
    expect(collapsePathSegments("/Users/me/ws/./src/../main.ts")).toBe("/Users/me/ws/main.ts");
    expect(collapsePathSegments("/Users/me/ws/foo/../../ws/bar")).toBe("/Users/me/ws/bar");
  });

  it("does not climb above the filesystem root", () => {
    expect(collapsePathSegments("/../etc/passwd")).toBe("/etc/passwd");
    expect(collapsePathSegments("/Users/../..")).toBe("/");
  });
});

describe("isPathUnderRoot", () => {
  it("matches root and nested paths", () => {
    expect(isPathUnderRoot("/Users/me/ws", "/Users/me/ws")).toBe(true);
    expect(isPathUnderRoot("/Users/me/ws/src/main.ts", "/Users/me/ws")).toBe(true);
  });

  it("handles trailing slashes", () => {
    expect(isPathUnderRoot("/Users/me/ws/src", "/Users/me/ws/")).toBe(true);
    expect(isPathUnderRoot("/Users/me/other", "/Users/me/ws/")).toBe(false);
  });

  it("rejects paths that escape the root via ..", () => {
    expect(isPathUnderRoot("/Users/me/ws/../secrets", "/Users/me/ws")).toBe(false);
    expect(isPathUnderRoot("/Users/me/ws/foo/../../outside", "/Users/me/ws")).toBe(false);
    expect(isPathUnderRoot("/Users/me/ws/./src/file.ts", "/Users/me/ws")).toBe(true);
  });
});

describe("workspaceRelativePath", () => {
  it("returns path relative to workspace root", () => {
    expect(workspaceRelativePath("/Users/me/ws/src/main.ts", "/Users/me/ws")).toBe("src/main.ts");
  });

  it("returns empty string for workspace root itself", () => {
    expect(workspaceRelativePath("/Users/me/ws", "/Users/me/ws/")).toBe("");
  });

  it("returns null for paths outside workspace root", () => {
    expect(workspaceRelativePath("/Users/me/other/file.ts", "/Users/me/ws")).toBeNull();
  });

  it("returns null when .. escapes the workspace root", () => {
    expect(workspaceRelativePath("/Users/me/ws/../secrets/a.txt", "/Users/me/ws")).toBeNull();
  });

  it("preserves the original casing of the relative path", () => {
    expect(workspaceRelativePath("/Users/Me/Ws/Src/Main.ts", "/Users/Me/Ws")).toBe("Src/Main.ts");
  });

  it("still matches when root and path casing differ", () => {
    expect(workspaceRelativePath("/users/me/ws/Src/Main.ts", "/Users/Me/Ws")).toBe("Src/Main.ts");
  });
});

describe("ensureTabGroupForOutsidePath", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("does nothing in notepad mode", () => {
    const result = ensureTabGroupForOutsidePath("/tmp/file.txt");
    expect(result.activeWorkspaceRoot).toBeNull();
    expect(result.switchedToTabGroup).toBe(false);
    expect(appState.isTabGroupActive()).toBe(true);
  });

  it("switches to notepad when active workspace path is outside root", () => {
    const workspaceId = appState.addWorkspace("/tmp/workspace");
    expect(workspaceId).not.toBeNull();
    expect(appState.isTabGroupActive()).toBe(false);

    const result = ensureTabGroupForOutsidePath("/tmp/elsewhere/file.txt");
    expect(result.activeWorkspaceRoot).toBe("/tmp/workspace");
    expect(result.switchedToTabGroup).toBe(true);
    expect(appState.isTabGroupActive()).toBe(true);
  });
});

describe("runInTabGroupContext", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("switches to notepad and runs callback", async () => {
    appState.addWorkspace("/tmp/workspace");
    let ran = false;
    await runInTabGroupContext(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(appState.isTabGroupActive()).toBe(true);
  });
});
