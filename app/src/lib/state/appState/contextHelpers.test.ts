import { describe, expect, it } from "vitest";
import type { AppDomainState, ContextSnapshot } from "../../domain/contracts";
import {
  createFileTab,
  createSinglePaneLayout,
  getSessionSelectedTabId,
  setActivePaneTabs,
} from "../../domain/contracts";
import {
  getContextSnapshotById,
  patchActiveContext,
  patchContextById,
} from "./contextHelpers";
import { defaultSettings } from "./settingsSlice";

function buildSnapshot(docId: string, tabId: string): ContextSnapshot {
  return {
    documents: [
      {
        id: docId,
        filePath: null,
        title: "Untitled",
        content: "",
        savedContent: "",
        isDirty: false,
        contentKind: "text",
        language: "plaintext",
        encoding: "utf-8",
        lineEnding: "lf",
        diskFingerprint: null,
        dismissedFingerprint: null,
        fileMissing: false,
        scrollTop: 0,
        markdownViewMode: "edit",
      },
    ],
    session: {
      editorLayout: createSinglePaneLayout([createFileTab(tabId, docId)], tabId),
      lastActiveWindowId: "main",
      windowBounds: null,
      lastActiveSessionId: null,
    },
  };
}

function buildState(activeContextId: AppDomainState["contexts"]["activeContextId"]): AppDomainState {
  return {
    contexts: {
      activeContextId,
      notepad: buildSnapshot("doc-1", "tab-1"),
      chatHttp: buildSnapshot("doc-2", "tab-2"),
      workspaces: [
        {
          id: "ws-1",
          rootPath: "/tmp/ws",
          snapshot: buildSnapshot("doc-3", "tab-3"),
        },
      ],
    },
    settings: {
      ...defaultSettings,
      externalFiles: {
        watchExternalChanges: false,
        autoReloadCleanFiles: false,
        checkOnWindowFocus: false,
        checkOnTabActivate: false,
        maxBinaryOpenAsTextBytes: 200_000,
        maxOpenWithoutConfirmBytes: 1024 * 1024,
      },
    },
    theme: {
      mode: "auto",
      darkTheme: { kind: "builtin", id: "dark-amber" },
      lightTheme: { kind: "builtin", id: "light-blue" },
      manualTheme: { kind: "builtin", id: "dark-amber" },
      customThemes: [],
    },
    recentFiles: [],
    editor: {
      cursorLine: 1,
      cursorColumn: 1,
      zoomPercent: 100,
      wrapLines: true,
      findReplaceOpen: false,
      goToOpen: false,
      previewMode: "editor",
    },
    activityRailWidthPx: 48,
  };
}

describe("contextHelpers chat-http support", () => {
  it("returns chat-http snapshot by context id", () => {
    const state = buildState("notepad");
    expect(getContextSnapshotById(state, "chat-http")).toBe(state.contexts.chatHttp);
  });

  it("patchActiveContext updates chat-http snapshot when active", () => {
    const state = buildState("chat-http");
    const next = patchActiveContext(state, (snapshot) => ({
      ...snapshot,
      session: {
        ...snapshot.session,
        editorLayout: setActivePaneTabs(
          snapshot.session.editorLayout,
          snapshot.session.editorLayout.panes[0].tabs,
          "tab-changed",
        ),
      },
    }));
    expect(getSessionSelectedTabId(next.contexts.chatHttp.session)).toBe("tab-changed");
    expect(getSessionSelectedTabId(next.contexts.notepad.session)).toBe("tab-1");
    expect(getSessionSelectedTabId(next.contexts.workspaces[0]?.snapshot.session as never)).toBe(
      "tab-3",
    );
  });

  it("patchContextById updates chat-http snapshot by id", () => {
    const state = buildState("notepad");
    const next = patchContextById(state, "chat-http", (snapshot) => ({
      ...snapshot,
      session: {
        ...snapshot.session,
        editorLayout: setActivePaneTabs(
          snapshot.session.editorLayout,
          snapshot.session.editorLayout.panes[0].tabs,
          "tab-patched",
        ),
      },
    }));
    expect(getSessionSelectedTabId(next.contexts.chatHttp.session)).toBe("tab-patched");
    expect(getSessionSelectedTabId(next.contexts.notepad.session)).toBe("tab-1");
  });
});
