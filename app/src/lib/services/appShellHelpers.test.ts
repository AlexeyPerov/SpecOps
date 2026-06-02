import { describe, expect, it } from "vitest";
import type { AppDomainState } from "../domain/contracts";
import { createAgentTab, createFileTab } from "../domain/contracts";
import {
  canFitMarkdownSplit,
  computeResponsiveLayoutFlags,
  formatStatusPath,
  watchedPathsFromState,
} from "./appShellHelpers";

function domainState(overrides: {
  openTabs?: AppDomainState["contexts"]["notepad"]["session"]["openTabs"];
  documents?: AppDomainState["contexts"]["notepad"]["documents"];
}): AppDomainState {
  const snapshot = {
    documents: overrides.documents ?? [],
    session: {
      openTabs: overrides.openTabs ?? [],
      selectedTabId: null,
      lastActiveWindowId: "main",
      windowBounds: null,
    },
  };
  return {
    contexts: {
      activeContextId: "notepad",
      notepad: snapshot,
      workspaces: [],
    },
    settings: {} as AppDomainState["settings"],
    theme: {} as AppDomainState["theme"],
    recentFiles: [],
    editor: {} as AppDomainState["editor"],
  };
}

function emptyDocument(id: string, filePath: string | null) {
  return {
    id,
    filePath,
    title: "title",
    content: "",
    savedContent: "",
    isDirty: false,
    language: "plaintext",
    encoding: "utf-8" as const,
    lineEnding: "lf" as const,
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit" as const,
  };
}

describe("watchedPathsFromState", () => {
  it("collects paths from file tabs with filePath", () => {
    const state = domainState({
      openTabs: [createFileTab("tab-1", "doc-1"), createFileTab("tab-2", "doc-2")],
      documents: [
        emptyDocument("doc-1", "/tmp/a.txt"),
        emptyDocument("doc-2", "/tmp/b.txt"),
      ],
    });

    expect(watchedPathsFromState(state).sort()).toEqual(["/tmp/a.txt", "/tmp/b.txt"]);
  });

  it("skips agent tabs", () => {
    const state = domainState({
      openTabs: [createAgentTab("tab-agent", "agent-1"), createFileTab("tab-1", "doc-1")],
      documents: [emptyDocument("doc-1", "/tmp/a.txt")],
    });

    expect(watchedPathsFromState(state)).toEqual(["/tmp/a.txt"]);
  });

  it("skips file tabs whose document has no filePath", () => {
    const state = domainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [emptyDocument("doc-1", null)],
    });

    expect(watchedPathsFromState(state)).toEqual([]);
  });
});

describe("formatStatusPath", () => {
  const defaultUntitled = "Untitled";

  it("uses fallback title when filePath is null", () => {
    expect(formatStatusPath(null, "My Draft", defaultUntitled)).toBe("My Draft");
  });

  it("uses default untitled when filePath and fallback are missing", () => {
    expect(formatStatusPath(null, undefined, defaultUntitled)).toBe("Untitled");
  });

  it("shows parent/name for multi-segment paths", () => {
    expect(formatStatusPath("/tmp/specs/readme.md", undefined, defaultUntitled)).toBe(
      "specs/readme.md",
    );
  });

  it("normalizes Windows backslashes", () => {
    expect(formatStatusPath("C:\\Users\\me\\file.txt", undefined, defaultUntitled)).toBe(
      "me/file.txt",
    );
  });

  it("returns single segment for shallow paths", () => {
    expect(formatStatusPath("readme.md", undefined, defaultUntitled)).toBe("readme.md");
  });
});

describe("canFitMarkdownSplit", () => {
  it("returns false below default threshold", () => {
    expect(canFitMarkdownSplit(759)).toBe(false);
  });

  it("returns true at and above default threshold", () => {
    expect(canFitMarkdownSplit(760)).toBe(true);
    expect(canFitMarkdownSplit(900)).toBe(true);
  });

  it("respects custom min width", () => {
    expect(canFitMarkdownSplit(500, 600)).toBe(false);
    expect(canFitMarkdownSplit(600, 600)).toBe(true);
  });
});

describe("computeResponsiveLayoutFlags", () => {
  const baseLayout = {
    projectPanelWidthPx: 240,
    agentsSidebarWidthPx: 280,
    projectPanelCollapsed: false,
    agentsSidebarCollapsed: false,
  };

  it("does not auto-collapse when width is zero", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 0,
        workspaceActive: true,
        isAgentTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }),
    ).toEqual({
      autoProjectPanelCollapsed: false,
      autoAgentsSidebarCollapsed: false,
      consoleOpen: true,
    });
  });

  it("auto-collapses project panel below 1100 when workspace is active", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1099,
        workspaceActive: true,
        isAgentTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoProjectPanelCollapsed,
    ).toBe(true);
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1100,
        workspaceActive: true,
        isAgentTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoProjectPanelCollapsed,
    ).toBe(false);
  });

  it("uses 1200 panel threshold when agent tab is active in workspace", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1199,
        workspaceActive: true,
        isAgentTabActive: true,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoProjectPanelCollapsed,
    ).toBe(true);
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1200,
        workspaceActive: true,
        isAgentTabActive: true,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoProjectPanelCollapsed,
    ).toBe(false);
  });

  it("auto-collapses agents sidebar below 1320 or 1400 with agent tab", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1319,
        workspaceActive: true,
        isAgentTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoAgentsSidebarCollapsed,
    ).toBe(true);
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1399,
        workspaceActive: true,
        isAgentTabActive: true,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoAgentsSidebarCollapsed,
    ).toBe(true);
  });

  it("closes console when project panel is collapsed and width is under 900", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 899,
        workspaceActive: true,
        isAgentTabActive: false,
        workspaceLayout: { ...baseLayout, projectPanelCollapsed: true },
        consoleOpen: true,
      }).consoleOpen,
    ).toBe(false);
  });

  it("closes console when auto-collapsed panel makes project panel collapsed", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 850,
        workspaceActive: true,
        isAgentTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).consoleOpen,
    ).toBe(false);
  });

  it("keeps console open when width is under 900 but panel is not collapsed", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 850,
        workspaceActive: false,
        isAgentTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).consoleOpen,
    ).toBe(true);
  });
});
