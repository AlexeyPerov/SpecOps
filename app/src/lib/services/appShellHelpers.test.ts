import { describe, expect, it } from "vitest";
import type { AppDomainState, TabState } from "../domain/contracts";
import { createSessionTab, createFileTab, createSinglePaneLayout } from "../domain/contracts";
import {
  canFitMarkdownSplit,
  computeResponsiveLayoutFlags,
  externalFileWatcherSyncKey,
  formatStatusPath,
  watchedPathsFromState,
} from "./appShellHelpers";

function domainState(overrides: {
  openTabs?: TabState[];
  documents?: AppDomainState["contexts"]["notepad"]["documents"];
  watchExternalChanges?: boolean;
}): AppDomainState {
  const snapshot = {
    documents: overrides.documents ?? [],
    session: {
      editorLayout: createSinglePaneLayout(overrides.openTabs ?? [], null),
      lastActiveWindowId: "main",
      windowBounds: null,
    },
  };
  return {
    contexts: {
      activeContextId: "notepad",
      notepad: snapshot,
      chatHttp: snapshot,
      workspaces: [],
    },
    settings: {
      externalFiles: {
        watchExternalChanges: overrides.watchExternalChanges ?? true,
      },
    } as AppDomainState["settings"],
    theme: {} as AppDomainState["theme"],
    recentFiles: [],
    editor: {} as AppDomainState["editor"],
    activityRailWidthPx: 48,
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
    contentKind: "text" as const,
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
      openTabs: [createSessionTab("tab-agent", "agent-1"), createFileTab("tab-1", "doc-1")],
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

  it("resolves many file tabs via document id map without missing paths", () => {
    const openTabs = Array.from({ length: 40 }, (_, index) =>
      createFileTab(`tab-${index}`, `doc-${index}`),
    );
    const documents = Array.from({ length: 40 }, (_, index) =>
      emptyDocument(`doc-${index}`, `/tmp/file-${index}.txt`),
    );
    const state = domainState({ openTabs, documents });

    expect(watchedPathsFromState(state).sort()).toEqual(
      documents.map((doc) => doc.filePath!).sort(),
    );
  });
});

describe("externalFileWatcherSyncKey", () => {
  it("changes when watched paths change", () => {
    const withA = domainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [emptyDocument("doc-1", "/tmp/a.txt")],
    });
    const withB = domainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [emptyDocument("doc-1", "/tmp/b.txt")],
    });

    expect(externalFileWatcherSyncKey(withA)).not.toBe(externalFileWatcherSyncKey(withB));
  });

  it("changes when watchExternalChanges toggles", () => {
    const enabled = domainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [emptyDocument("doc-1", "/tmp/a.txt")],
      watchExternalChanges: true,
    });
    const disabled = domainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [emptyDocument("doc-1", "/tmp/a.txt")],
      watchExternalChanges: false,
    });

    expect(externalFileWatcherSyncKey(enabled)).not.toBe(externalFileWatcherSyncKey(disabled));
  });

  it("stays stable when only non-path document fields change", () => {
    const base = domainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [emptyDocument("doc-1", "/tmp/a.txt")],
    });
    const contentEdited = domainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [{ ...emptyDocument("doc-1", "/tmp/a.txt"), content: "edited", isDirty: true }],
    });

    expect(externalFileWatcherSyncKey(base)).toBe(externalFileWatcherSyncKey(contentEdited));
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
    sessionsSidebarWidthPx: 280,
    projectPanelCollapsed: false,
    sessionsSidebarCollapsed: false,
  };

  it("does not auto-collapse when width is zero", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 0,
        workspaceActive: true,
        isSessionTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }),
    ).toEqual({
      autoProjectPanelCollapsed: false,
      autoSessionsSidebarCollapsed: false,
      consoleOpen: true,
    });
  });

  it("auto-collapses project panel below 1100 when workspace is active", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1099,
        workspaceActive: true,
        isSessionTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoProjectPanelCollapsed,
    ).toBe(true);
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1100,
        workspaceActive: true,
        isSessionTabActive: false,
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
        isSessionTabActive: true,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoProjectPanelCollapsed,
    ).toBe(true);
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1200,
        workspaceActive: true,
        isSessionTabActive: true,
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
        isSessionTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoSessionsSidebarCollapsed,
    ).toBe(true);
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 1399,
        workspaceActive: true,
        isSessionTabActive: true,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoSessionsSidebarCollapsed,
    ).toBe(true);
  });

  it("does not auto-collapse agents sidebar outside workspace context", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 800,
        workspaceActive: false,
        isSessionTabActive: true,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).autoSessionsSidebarCollapsed,
    ).toBe(false);
  });

  it("closes console when project panel is collapsed and width is under 900", () => {
    expect(
      computeResponsiveLayoutFlags({
        shellMainRowWidth: 899,
        workspaceActive: true,
        isSessionTabActive: false,
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
        isSessionTabActive: false,
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
        isSessionTabActive: false,
        workspaceLayout: baseLayout,
        consoleOpen: true,
      }).consoleOpen,
    ).toBe(true);
  });
});
