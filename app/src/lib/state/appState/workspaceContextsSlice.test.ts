import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionTab, createFileTab, isSessionTab, tabDocumentId } from "../../domain/contracts";
import { appState, resetThemePersistenceForTests, setThemeSaveErrorNotifier } from "../appState";
import { saveThemeFile } from "../../services/themeStore";
import {
  defaultProviderModelCatalogs,
  getProviderDefaultModelId,
} from "../../ai/providers/providerModelCatalog";

vi.mock("../../services/themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/themeStore")>();
  return {
    ...actual,
    loadThemeFile: vi.fn().mockResolvedValue(actual.defaultThemeFile),
    saveThemeFile: vi.fn().mockResolvedValue(undefined),
  };
});

const saveThemeFileMock = vi.mocked(saveThemeFile);

describe("appState session restore", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("restores active workspace context, order, tabs, and project panel state", () => {
    appState.applyPersistedSettings({
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: true,
          baseUrl: "http://localhost:11434/v1",
        },
      },
      providerModelCatalogs: defaultProviderModelCatalogs,
    });
    appState.setProviderApiKey("http", "test-api-key");
    appState.applyWindowSession(
      {
        activeContextId: "ws-2",
        notepad: {
          documents: [
            {
              id: "doc-1",
              filePath: "/tmp/notepad.md",
              title: "notepad.md",
              content: "notepad",
              savedContent: "notepad",
              isDirty: false,
              contentKind: "text",
              language: "markdown",
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
            selectedTabId: "tab-1",
            openTabs: [createFileTab("tab-1", "doc-1")],
            lastActiveWindowId: "main",
            windowBounds: null,
          },
        },
        chatHttp: {
          documents: [
            {
              id: "doc-chat",
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
            selectedTabId: "tab-chat",
            openTabs: [createFileTab("tab-chat", "doc-chat")],
            lastActiveWindowId: "main",
            windowBounds: null,
            lastActiveSessionId: null,
          },
        },
        workspaces: [
          {
            id: "ws-1",
            rootPath: "/tmp/ws-one",
            snapshot: {
              documents: [
                {
                  id: "doc-2",
                  filePath: "/tmp/ws-one/a.ts",
                  title: "a.ts",
                  content: "export const a = 1;",
                  savedContent: "export const a = 1;",
                  isDirty: false,
                  contentKind: "text",
                  language: "typescript",
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
                selectedTabId: "tab-2",
                openTabs: [createFileTab("tab-2", "doc-2")],
                lastActiveWindowId: "main",
                windowBounds: null,
              },
            },
          },
          {
            id: "ws-2",
            rootPath: "/tmp/ws-two",
            snapshot: {
              documents: [
                {
                  id: "doc-3",
                  filePath: "/tmp/ws-two/b.ts",
                  title: "b.ts",
                  content: "export const b = 2;",
                  savedContent: "export const b = 2;",
                  isDirty: false,
                  contentKind: "text",
                  language: "typescript",
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
                selectedTabId: "tab-3",
                openTabs: [createFileTab("tab-3", "doc-3")],
                lastActiveWindowId: "main",
                windowBounds: null,
                layout: {
                  projectPanelWidthPx: 320,
                  sessionsSidebarWidthPx: 280,
                  projectPanelCollapsed: true,
                  sessionsSidebarCollapsed: false,
                  activityRailWidthPx: 48,
                },
              },
            },
          },
        ],
        editorPreferences: {
          zoomPercent: 120,
          wrapLines: false,
        },
      },
      ["/tmp/notepad.md"],
    );

    const snapshot = appState.getSnapshot();
    expect(snapshot.contexts.activeContextId).toBe("ws-2");
    expect(snapshot.contexts.workspaces.map((workspace) => workspace.id)).toEqual(["ws-1", "ws-2"]);
    expect(appState.getActiveSession().selectedTabId).toBe("tab-3");
    expect(appState.getActiveDocuments()[0]?.filePath).toBe("/tmp/ws-two/b.ts");
    expect(appState.getActiveWorkspaceLayout().projectPanelCollapsed).toBe(true);
    expect(appState.getActiveWorkspaceLayout().projectPanelWidthPx).toBe(320);
  });

  it("keeps per-workspace panel layout when switching workspaces", () => {
    appState.addWorkspace("/tmp/ws-one");
    appState.updateActiveWorkspaceLayout({
      projectPanelWidthPx: 300,
      sessionsSidebarWidthPx: 260,
      projectPanelCollapsed: true,
      sessionsSidebarCollapsed: false,
    });

    appState.addWorkspace("/tmp/ws-two");
    appState.updateActiveWorkspaceLayout({
      projectPanelWidthPx: 400,
      sessionsSidebarWidthPx: 360,
      projectPanelCollapsed: false,
      sessionsSidebarCollapsed: true,
    });

    const wsOneId = appState.getSnapshot().contexts.workspaces[0]?.id;
    expect(wsOneId).toBeDefined();
    appState.switchContext(wsOneId!);

    expect(appState.getActiveWorkspaceLayout().projectPanelWidthPx).toBe(300);
    expect(appState.getActiveWorkspaceLayout().sessionsSidebarWidthPx).toBe(260);
    expect(appState.getActiveWorkspaceLayout().projectPanelCollapsed).toBe(true);
    expect(appState.getActiveWorkspaceLayout().sessionsSidebarCollapsed).toBe(false);
  });

  it("switches between workspace and chat-http contexts without mutating workspace state", () => {
    const defaultHttpModelId = getProviderDefaultModelId(defaultProviderModelCatalogs, "http");
    appState.applyPersistedSettings({
      chatHttp: { enabled: true },
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: true,
          baseUrl: "http://localhost:11434/v1",
        },
      },
      providerModelCatalogs: {
        ...defaultProviderModelCatalogs,
        http: {
          modelIds: [defaultHttpModelId],
          defaultModelId: defaultHttpModelId,
        },
      },
    });
    appState.setProviderApiKey("http", "configured-key");

    appState.addWorkspace("/tmp/ws-chat-switch");
    const workspaceId = appState.getSnapshot().contexts.activeContextId;
    expect(workspaceId).not.toBe("chat-http");
    expect(workspaceId).not.toBe("notepad");

    appState.openFileInTab("/tmp/ws-chat-switch/note.ts", "export const ok = true;");
    const workspaceSelectedTabId = appState.getActiveSession().selectedTabId;
    expect(workspaceSelectedTabId).toBeTruthy();

    expect(appState.switchContext("chat-http")).toBe(true);
    expect(appState.getSnapshot().contexts.activeContextId).toBe("chat-http");
    expect(appState.getWorkspaceRoot()).toBeNull();

    expect(appState.switchContext(workspaceId)).toBe(true);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(workspaceId);
    expect(appState.getWorkspaceRoot()).toBe("/tmp/ws-chat-switch");
    expect(appState.getActiveSession().selectedTabId).toBe(workspaceSelectedTabId);
  });

  it("does not create file tabs in chat-http context", () => {
    const defaultHttpModelId = getProviderDefaultModelId(defaultProviderModelCatalogs, "http");
    appState.applyPersistedSettings({
      chatHttp: { enabled: true },
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: true,
          baseUrl: "http://localhost:11434/v1",
        },
      },
      providerModelCatalogs: {
        ...defaultProviderModelCatalogs,
        http: {
          modelIds: [defaultHttpModelId],
          defaultModelId: defaultHttpModelId,
        },
      },
    });
    appState.setProviderApiKey("http", "configured-key");

    expect(appState.switchContext("chat-http")).toBe(true);
    const beforeTabs = appState.getActiveSession().openTabs.length;
    const beforeDocuments = appState.getActiveDocuments().length;

    appState.createTab();
    appState.openFileInTab("/tmp/chat-http-no-file-tabs.txt", "content");

    expect(appState.getActiveSession().openTabs).toHaveLength(beforeTabs);
    expect(appState.getActiveDocuments()).toHaveLength(beforeDocuments);
    expect(appState.getActiveSession().selectedTabId).toBe("tab-1");
  });

  it("restores chat-http as active when chatHttp beta is enabled and HTTP connection is configured", () => {
    const defaultHttpModelId = getProviderDefaultModelId(defaultProviderModelCatalogs, "http");
    appState.applyPersistedSettings({
      chatHttp: { enabled: true },
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: true,
          baseUrl: "http://localhost:11434/v1",
        },
      },
      providerModelCatalogs: {
        ...defaultProviderModelCatalogs,
        http: {
          modelIds: [defaultHttpModelId],
          defaultModelId: defaultHttpModelId,
        },
      },
    });
    appState.setProviderApiKey("http", "configured-key");
    appState.applyWindowSession({
      ...appState.getWindowSessionSnapshot(),
      activeContextId: "chat-http",
    });
    expect(appState.getSnapshot().contexts.activeContextId).toBe("chat-http");
  });

  it("falls back to notepad when restoring chat-http with chatHttp beta disabled", () => {
    appState.applyPersistedSettings({
      chatHttp: { enabled: false },
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: true,
          baseUrl: "http://localhost:11434/v1",
        },
      },
    });
    appState.setProviderApiKey("http", "configured-key");
    appState.applyWindowSession({
      ...appState.getWindowSessionSnapshot(),
      activeContextId: "chat-http",
    });
    expect(appState.getSnapshot().contexts.activeContextId).toBe("notepad");
  });

  it("falls back to notepad when restoring chat-http without configured HTTP connection", () => {
    appState.applyPersistedSettings({
      chatHttp: { enabled: true },
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: false,
          baseUrl: "",
        },
        debugChat: {
          ...appState.getSnapshot().settings.providerSettings.debugChat,
          enabled: false,
        },
      },
      providerModelCatalogs: {
        ...defaultProviderModelCatalogs,
        http: {
          modelIds: [],
          defaultModelId: "",
        },
      },
    });
    appState.setProviderApiKey("http", "");
    appState.applyWindowSession({
      ...appState.getWindowSessionSnapshot(),
      activeContextId: "chat-http",
    });
    expect(appState.getSnapshot().contexts.activeContextId).toBe("notepad");
  });

  it("does not switch into chat-http when chatHttp beta is disabled", () => {
    appState.applyPersistedSettings({
      chatHttp: { enabled: false },
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: true,
          baseUrl: "http://localhost:11434/v1",
        },
      },
    });
    appState.setProviderApiKey("http", "configured-key");
    expect(appState.switchContext("chat-http")).toBe(false);
    expect(appState.getSnapshot().contexts.activeContextId).toBe("notepad");
  });

  it("does not switch into chat-http when HTTP connection is not configured", () => {
    appState.applyPersistedSettings({
      chatHttp: { enabled: true },
      providerSettings: {
        ...appState.getSnapshot().settings.providerSettings,
        http: {
          enabled: false,
          baseUrl: "",
        },
        debugChat: {
          ...appState.getSnapshot().settings.providerSettings.debugChat,
          enabled: false,
        },
      },
      providerModelCatalogs: {
        ...defaultProviderModelCatalogs,
        http: {
          modelIds: [],
          defaultModelId: "",
        },
      },
    });
    appState.setProviderApiKey("http", "");
    expect(appState.switchContext("chat-http")).toBe(false);
    expect(appState.getSnapshot().contexts.activeContextId).toBe("notepad");
  });
});
