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
      selectionCount: 1,
      zoomPercent: 100,
      wrapLines: true,
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

describe("context-aware document lookup", () => {
  function buildFileSnapshot(docId: string, tabId: string, filePath: string): ContextSnapshot {
    const snap = buildSnapshot(docId, tabId);
    return {
      ...snap,
      documents: snap.documents.map((doc) =>
        doc.id === docId
          ? { ...doc, filePath, title: filePath.split("/").pop() ?? filePath }
          : doc,
      ),
    };
  }

  function buildWorkspaceState(activeContextId: AppDomainState["contexts"]["activeContextId"]): AppDomainState {
    return {
      contexts: {
        activeContextId,
        notepad: buildSnapshot("doc-1", "tab-1"),
        chatHttp: buildSnapshot("doc-2", "tab-2"),
        workspaces: [
          {
            id: "ws-1",
            rootPath: "/tmp/ws",
            snapshot: buildFileSnapshot("doc-3", "tab-3", "/tmp/ws/active-in-ws.txt"),
          },
          {
            id: "ws-2",
            rootPath: "/tmp/other",
            snapshot: buildFileSnapshot("doc-4", "tab-4", "/tmp/other/inactive.txt"),
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
        selectionCount: 1,
        zoomPercent: 100,
        wrapLines: true,
        previewMode: "editor",
      },
      activityRailWidthPx: 48,
    };
  }

  it("findDocumentContext locates a document in an inactive workspace by id", async () => {
    const { findDocumentContext } = await import("./contextHelpers");
    // ws-2 is inactive; doc-4 lives there.
    const state = buildWorkspaceState("ws-1");
    const result = findDocumentContext(state, "doc-4");
    expect(result).toEqual({
      contextId: "ws-2",
      document: expect.objectContaining({ id: "doc-4", filePath: "/tmp/other/inactive.txt" }),
    });
  });

  it("findDocumentByNormalizedPathAllContexts resolves a path in an inactive workspace", async () => {
    const { findDocumentByNormalizedPathAllContexts } = await import("./contextHelpers");
    const state = buildWorkspaceState("ws-1");
    const result = findDocumentByNormalizedPathAllContexts(state, "/tmp/other/inactive.txt");
    expect(result).toEqual(
      expect.objectContaining({
        contextId: "ws-2",
        documentId: "doc-4",
        tabId: "tab-4",
        document: expect.objectContaining({ filePath: "/tmp/other/inactive.txt" }),
      }),
    );
  });

  it("allContextSnapshots includes notepad, chat-http, and every workspace", async () => {
    const { allContextSnapshots } = await import("./contextHelpers");
    const state = buildWorkspaceState("ws-1");
    const ids = allContextSnapshots(state).map((entry) => entry.id);
    // Active first, then notepad, chat-http, and the two workspaces.
    expect(ids).toContain("ws-1");
    expect(ids).toContain("ws-2");
    expect(ids).toContain("notepad");
    expect(ids).toContain("chat-http");
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("collectAllOpenDocumentIds includes inactive context documents", async () => {
    const { collectAllOpenDocumentIds } = await import("./contextHelpers");
    const state = buildWorkspaceState("ws-1");
    expect(collectAllOpenDocumentIds(state)).toEqual(
      new Set(["doc-1", "doc-2", "doc-3", "doc-4"]),
    );
  });
});
