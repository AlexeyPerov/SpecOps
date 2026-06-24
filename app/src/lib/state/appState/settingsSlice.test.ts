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

describe("appState settings and editor chrome", () => {
  beforeEach(() => {
    appState.resetAppState();
    resetThemePersistenceForTests();
    saveThemeFileMock.mockClear();
  });

  it("setActiveTheme updates the active built-in theme", () => {
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
    appState.setActiveTheme({ kind: "builtin", id: "light-blue" });
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
    expect(saveThemeFileMock).toHaveBeenCalled();
  });

  it("cycleTheme toggles between the two built-in themes", () => {
    expect(appState.getSnapshot().theme.activeTheme.id).toBe("dark-amber");
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("cycleTheme from active custom switches to opposite built-in", () => {
    appState.createCustomTheme();
    expect(appState.getSnapshot().theme.activeTheme.kind).toBe("custom");
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
    appState.createCustomTheme();
    appState.setActiveTheme({ kind: "builtin", id: "light-blue" });
    appState.createCustomTheme();
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("createCustomTheme adds a custom theme and selects it", () => {
    appState.createCustomTheme();
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.activeTheme.kind).toBe("custom");
    expect(snapshot.theme.customThemes).toHaveLength(1);
    expect(snapshot.theme.customThemes[0]?.name).toBe("Custom 1");
    expect(saveThemeFileMock).toHaveBeenCalled();
  });

  it("renameCustomTheme trims and persists the new name", () => {
    appState.createCustomTheme();
    const customId = appState.getSnapshot().theme.customThemes[0]!.id;
    appState.renameCustomTheme(customId, "  My Theme  ");
    expect(appState.getSnapshot().theme.customThemes[0]?.name).toBe("My Theme");
    appState.renameCustomTheme(customId, "   ");
    expect(appState.getSnapshot().theme.customThemes[0]?.name).toBe("My Theme");
  });

  it("deleteCustomTheme falls back to dark-amber when active custom is deleted", () => {
    appState.createCustomTheme();
    const customId = appState.getSnapshot().theme.customThemes[0]!.id;
    appState.deleteCustomTheme(customId);
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.customThemes).toHaveLength(0);
    expect(snapshot.theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("updateCustomThemeToken debounces save and keeps in-memory state on write failure", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    setThemeSaveErrorNotifier(notify);
    saveThemeFileMock.mockRejectedValueOnce(new Error("disk full"));

    appState.createCustomTheme();
    const customId = appState.getSnapshot().theme.customThemes[0]!.id;
    saveThemeFileMock.mockClear();

    appState.updateCustomThemeToken(customId, "accent-color", "#112233");
    expect(appState.getSnapshot().theme.customThemes[0]?.tokens["accent-color"]).toBe("#112233");

    await vi.advanceTimersByTimeAsync(300);
    expect(notify).toHaveBeenCalledWith(
      "Failed to save theme. Changes kept in memory; will retry on next change.",
    );
    expect(appState.getSnapshot().theme.customThemes[0]?.tokens["accent-color"]).toBe("#112233");

    saveThemeFileMock.mockResolvedValueOnce(undefined);
    appState.updateCustomThemeToken(customId, "accent-color", "#445566");
    await vi.advanceTimersByTimeAsync(300);
    expect(saveThemeFileMock).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("applyPersistedSettings updates only provided fields", () => {
    appState.applyPersistedSettings({ zoomPercent: 130, wrapLines: false });
    const snapshot = appState.getSnapshot();
    expect(snapshot.editor.zoomPercent).toBe(130);
    expect(snapshot.editor.wrapLines).toBe(false);
    expect(snapshot.theme.activeTheme.id).toBe("dark-amber");
  });

  it("applyWindowSession preserves the active theme", () => {
    appState.setActiveTheme({ kind: "builtin", id: "light-blue" });
    appState.applyWindowSession({
      activeContextId: "notepad",
      notepad: {
        documents: [
          {
            id: "doc-1",
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
        },
      },
      workspaces: [],
      editorPreferences: {
        zoomPercent: 100,
        wrapLines: true,
      },
    });
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
  });

  it("setPreviewMode, zoom, wrap, and workspace layout update editor state", () => {
    appState.addWorkspace("/tmp/ws-layout");
    appState.setPreviewMode("diff");
    appState.setZoomPercent(110);
    appState.toggleWrap();
    appState.setProjectPanelCollapsed(true);

    const editor = appState.getSnapshot().editor;
    expect(editor.previewMode).toBe("diff");
    expect(editor.zoomPercent).toBe(110);
    expect(editor.wrapLines).toBe(false);
    expect(appState.getActiveWorkspaceLayout().projectPanelCollapsed).toBe(true);
  });

  it("setPreviewMode normalizes legacy markdown preview to editor", () => {
    appState.setPreviewMode("markdown");
    expect(appState.getSnapshot().editor.previewMode).toBe("editor");
  });
});

