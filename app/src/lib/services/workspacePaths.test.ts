import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../state/appState";
import {
  ensureNotepadForOutsidePath,
  isPathUnderRoot,
  runInNotepadContext,
  workspaceRelativePath,
} from "./workspacePaths";

describe("isPathUnderRoot", () => {
  it("matches root and nested paths", () => {
    expect(isPathUnderRoot("/Users/me/ws", "/Users/me/ws")).toBe(true);
    expect(isPathUnderRoot("/Users/me/ws/src/main.ts", "/Users/me/ws")).toBe(true);
  });

  it("handles trailing slashes", () => {
    expect(isPathUnderRoot("/Users/me/ws/src", "/Users/me/ws/")).toBe(true);
    expect(isPathUnderRoot("/Users/me/other", "/Users/me/ws/")).toBe(false);
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
});

describe("ensureNotepadForOutsidePath", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("does nothing in notepad mode", () => {
    const result = ensureNotepadForOutsidePath("/tmp/file.txt");
    expect(result.activeWorkspaceRoot).toBeNull();
    expect(result.switchedToNotepad).toBe(false);
    expect(appState.isNotepadActive()).toBe(true);
  });

  it("switches to notepad when active workspace path is outside root", () => {
    const workspaceId = appState.addWorkspace("/tmp/workspace");
    expect(workspaceId).not.toBeNull();
    expect(appState.isNotepadActive()).toBe(false);

    const result = ensureNotepadForOutsidePath("/tmp/elsewhere/file.txt");
    expect(result.activeWorkspaceRoot).toBe("/tmp/workspace");
    expect(result.switchedToNotepad).toBe(true);
    expect(appState.isNotepadActive()).toBe(true);
  });
});

describe("runInNotepadContext", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("switches to notepad and runs callback", async () => {
    appState.addWorkspace("/tmp/workspace");
    let ran = false;
    await runInNotepadContext(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(appState.isNotepadActive()).toBe(true);
  });
});
