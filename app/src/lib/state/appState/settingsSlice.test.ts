import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFileTab, createSessionTab, createSinglePaneLayout, isSessionTab, tabDocumentId } from "../../domain/contracts";
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

  it("setDarkTheme/setLightTheme update the corresponding slot", () => {
    // Fresh-install default dark slot is the `turnip` preset (see defaultThemeFile).
    expect(appState.getSnapshot().theme.darkTheme).toEqual({
      kind: "preset",
      id: "turnip",
    });
    appState.setDarkTheme({ kind: "builtin", id: "dark-amber" });
    appState.setLightTheme({ kind: "preset", id: "github" });
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.darkTheme).toEqual({ kind: "builtin", id: "dark-amber" });
    expect(snapshot.theme.lightTheme).toEqual({ kind: "preset", id: "github" });
    expect(saveThemeFileMock).toHaveBeenCalled();
  });

  it("setThemeMode updates the active mode", () => {
    appState.setThemeMode("manual");
    expect(appState.getSnapshot().theme.mode).toBe("manual");
    appState.setThemeMode("auto");
    expect(appState.getSnapshot().theme.mode).toBe("auto");
  });

  it("setActiveTheme routes a dark ref to the dark slot and a light ref to the light slot", () => {
    appState.setActiveTheme({ kind: "builtin", id: "light-blue" });
    expect(appState.getSnapshot().theme.lightTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
    appState.setActiveTheme({ kind: "builtin", id: "dark-amber" });
    expect(appState.getSnapshot().theme.darkTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("cycleTheme advances to the next theme and switches to manual mode", () => {
    // Default state: auto mode + OS dark → effective ref is `turnip` (preset). The
    // cycle order is builtins → presets → customs; `tron` is the preset that
    // follows `turnip` in the IMPORTED_THEMES list, so it is the next ref.
    appState.cycleTheme();
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.mode).toBe("manual");
    expect(snapshot.theme.manualTheme).toEqual({ kind: "preset", id: "tron" });
  });

  it("createCustomTheme adds a custom theme and assigns it to the matching slot", () => {
    appState.createCustomTheme();
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.customThemes).toHaveLength(1);
    expect(snapshot.theme.customThemes[0]?.name).toBe("Custom 1");
    // Default mode is auto with OS dark, so a dark custom theme lands in darkTheme.
    expect(snapshot.theme.darkTheme.kind).toBe("custom");
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

  it("deleteCustomTheme resets the affected slot to its builtin default", () => {
    appState.createCustomTheme();
    const customId = appState.getSnapshot().theme.customThemes[0]!.id;
    appState.deleteCustomTheme(customId);
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.customThemes).toHaveLength(0);
    expect(snapshot.theme.darkTheme).toEqual({
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
    expect(snapshot.theme.darkTheme.id).toBe("turnip");
  });

  it("default markdown view mode is preview and the setter updates it", () => {
    expect(appState.getSnapshot().settings.defaultMarkdownViewMode).toBe("preview");
    appState.setDefaultMarkdownViewMode("edit");
    expect(appState.getSnapshot().settings.defaultMarkdownViewMode).toBe("edit");
  });

  it("applyPersistedSettings clamps an invalid markdown view mode to preview", () => {
    appState.applyPersistedSettings({ defaultMarkdownViewMode: "garbage" as never });
    expect(appState.getSnapshot().settings.defaultMarkdownViewMode).toBe("preview");
  });

  it("restrictFilesToContext defaults to false and persists via applyPersistedSettings", () => {
    expect(appState.getSnapshot().settings.restrictFilesToContext).toBe(false);
    appState.setRestrictFilesToContext(true);
    expect(appState.getSnapshot().settings.restrictFilesToContext).toBe(true);
    appState.applyPersistedSettings({ restrictFilesToContext: false });
    expect(appState.getSnapshot().settings.restrictFilesToContext).toBe(false);
  });

  it("showMinimap defaults to true and the setter / apply path update it", () => {
    expect(appState.getSnapshot().settings.showMinimap).toBe(true);
    appState.setShowMinimap(false);
    expect(appState.getSnapshot().settings.showMinimap).toBe(false);
    appState.applyPersistedSettings({ showMinimap: true });
    expect(appState.getSnapshot().settings.showMinimap).toBe(true);
  });

  it("showFoldGutter defaults to true and the setter / apply path update it", () => {
    expect(appState.getSnapshot().settings.showFoldGutter).toBe(true);
    appState.setShowFoldGutter(false);
    expect(appState.getSnapshot().settings.showFoldGutter).toBe(false);
    appState.applyPersistedSettings({ showFoldGutter: true });
    expect(appState.getSnapshot().settings.showFoldGutter).toBe(true);
  });

  it("autoClosePairs defaults to true and the setter / apply path update it", () => {
    expect(appState.getSnapshot().settings.autoClosePairs).toBe(true);
    appState.setAutoClosePairs(false);
    expect(appState.getSnapshot().settings.autoClosePairs).toBe(false);
    appState.applyPersistedSettings({ autoClosePairs: true });
    expect(appState.getSnapshot().settings.autoClosePairs).toBe(true);
  });

  it("autoSuggest defaults to false and the setter / apply path update it", () => {
    expect(appState.getSnapshot().settings.autoSuggest).toBe(false);
    appState.setAutoSuggest(true);
    expect(appState.getSnapshot().settings.autoSuggest).toBe(true);
    appState.applyPersistedSettings({ autoSuggest: false });
    expect(appState.getSnapshot().settings.autoSuggest).toBe(false);
  });

  it("markdownSnippets defaults include all builtins and support CRUD", () => {
    const defaults = appState.getSnapshot().settings.markdownSnippets;
    expect(defaults.enabledBuiltinIds.length).toBeGreaterThan(0);
    expect(defaults.userSnippets).toEqual([]);

    appState.setBuiltinSnippetEnabled("table", false);
    expect(appState.getSnapshot().settings.markdownSnippets.enabledBuiltinIds).not.toContain(
      "table",
    );

    const id = appState.createUserSnippetDraft("My snip");
    expect(
      appState.getSnapshot().settings.markdownSnippets.userSnippets.some(
        (entry) => entry.id === id,
      ),
    ).toBe(true);

    appState.updateUserSnippet(id, {
      name: "Renamed",
      trigger: "mysnip",
      body: "${1:hi}${0}",
      enabled: true,
    });
    expect(
      appState.getSnapshot().settings.markdownSnippets.userSnippets.find(
        (entry) => entry.id === id,
      )?.name,
    ).toBe("Renamed");

    const dup = appState.duplicateUserSnippet(id);
    expect(dup).toBeTruthy();
    appState.removeUserSnippet(id);
    expect(
      appState.getSnapshot().settings.markdownSnippets.userSnippets.some(
        (entry) => entry.id === id,
      ),
    ).toBe(false);
  });

  it("applyWindowSession preserves the active theme", () => {
    appState.setLightTheme({ kind: "preset", id: "github" });
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
          editorLayout: createSinglePaneLayout([createFileTab("tab-1", "doc-1")], "tab-1"),
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
          editorLayout: createSinglePaneLayout([createFileTab("tab-chat", "doc-chat")], "tab-chat"),
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
    expect(appState.getSnapshot().theme.lightTheme).toEqual({
      kind: "preset",
      id: "github",
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

