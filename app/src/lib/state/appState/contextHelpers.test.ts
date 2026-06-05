import { describe, expect, it } from "vitest";
import type { AppDomainState, ContextSnapshot } from "../../domain/contracts";
import { createFileTab } from "../../domain/contracts";
import {
  getContextSnapshotById,
  patchActiveContext,
  patchContextById,
} from "./contextHelpers";

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
      selectedTabId: tabId,
      openTabs: [createFileTab(tabId, docId)],
      lastActiveWindowId: "main",
      windowBounds: null,
      lastActiveAgentId: null,
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
      statusBarVisible: true,
      externalFiles: {
        watchExternalChanges: false,
        autoReloadCleanFiles: false,
        checkOnWindowFocus: false,
        checkOnTabActivate: false,
        maxBinaryOpenAsTextBytes: 200_000,
      },
      decoratePlaintextSymbols: true,
      hideActivityRailWhenNotepadOnly: true,
      commandBindingOverrides: {},
      providerSettings: {
        http: {
          enabled: false,
          baseUrl: "",
        },
        debug: {
          enabled: false,
          simulationSeed: null,
          delayMsMin: 0,
          delayMsMax: 0,
          chunkCharsMin: 1,
          chunkCharsMax: 1,
          failureProbability: 0,
          failureMessage: "",
          includeDiagnostics: false,
        },
      },
      providerModelCatalogs: {},
      providerApiKeys: {},
    },
    theme: {
      activeTheme: { kind: "builtin", id: "dark-amber" },
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
        selectedTabId: "tab-changed",
      },
    }));
    expect(next.contexts.chatHttp.session.selectedTabId).toBe("tab-changed");
    expect(next.contexts.notepad.session.selectedTabId).toBe("tab-1");
    expect(next.contexts.workspaces[0]?.snapshot.session.selectedTabId).toBe("tab-3");
  });

  it("patchContextById updates chat-http snapshot by id", () => {
    const state = buildState("notepad");
    const next = patchContextById(state, "chat-http", (snapshot) => ({
      ...snapshot,
      session: {
        ...snapshot.session,
        selectedTabId: "tab-patched",
      },
    }));
    expect(next.contexts.chatHttp.session.selectedTabId).toBe("tab-patched");
    expect(next.contexts.notepad.session.selectedTabId).toBe("tab-1");
  });
});
