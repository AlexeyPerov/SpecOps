import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../state/appState/settingsSlice";
import type { AppDomainState } from "../domain/contracts";
import { createSinglePaneLayout } from "../domain/contracts";
import {
  flushSettingsPersistence,
  resetAppShellEffectsForTests,
  syncSettingsPersistenceEffect,
} from "./appShellEffects";
import { settingsPersistenceFingerprint } from "../state/appStateSelectors";

vi.mock("./settingsStore", () => ({
  savePersistedSettings: vi.fn().mockResolvedValue(undefined),
  toPersistedSettings: vi.fn((value) => value),
}));

import { savePersistedSettings } from "./settingsStore";

const saveMock = vi.mocked(savePersistedSettings);

function makeState(overrides: Partial<AppDomainState> = {}): AppDomainState {
  return {
    contexts: {
      activeContextId: "notepad",
      notepad: {
        documents: [],
        session: {
          editorLayout: createSinglePaneLayout([], null),
          lastActiveWindowId: "main",
          windowBounds: null,
          lastActiveSessionId: null,
        },
      },
      chatHttp: {
        documents: [],
        session: {
          editorLayout: createSinglePaneLayout([], null),
          lastActiveWindowId: "main",
          windowBounds: null,
          lastActiveSessionId: null,
        },
      },
      workspaces: [],
    },
    settings: defaultSettings,
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
    ...overrides,
  };
}

describe("syncSettingsPersistenceEffect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAppShellEffectsForTests();
    saveMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips disk write when only cursor fields change", () => {
    const base = makeState();
    syncSettingsPersistenceEffect({
      runtimeReady: true,
      currentWindowId: "main",
      snapshot: base,
    });
    vi.runAllTimers();
    expect(saveMock).toHaveBeenCalledTimes(1);

    syncSettingsPersistenceEffect({
      runtimeReady: true,
      currentWindowId: "main",
      snapshot: makeState({
        editor: {
          ...base.editor,
          cursorLine: 42,
          cursorColumn: 7,
          selectionCount: 3,
        },
      }),
    });
    vi.runAllTimers();
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("persists again when a settings field changes", () => {
    const base = makeState();
    syncSettingsPersistenceEffect({
      runtimeReady: true,
      currentWindowId: "main",
      snapshot: base,
    });
    vi.runAllTimers();

    syncSettingsPersistenceEffect({
      runtimeReady: true,
      currentWindowId: "main",
      snapshot: makeState({
        settings: {
          ...base.settings,
          showMinimap: !base.settings.showMinimap,
        },
      }),
    });
    vi.runAllTimers();
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it("debounces rapid settings changes into one write", () => {
    const base = makeState();
    for (let scaleOffset = 1; scaleOffset <= 10; scaleOffset += 1) {
      syncSettingsPersistenceEffect({
        runtimeReady: true,
        currentWindowId: "main",
        snapshot: makeState({
          settings: {
            ...base.settings,
            fontSettings: {
              ...base.settings.fontSettings,
              editorScale: 100 + scaleOffset,
            },
          },
        }),
      });
    }
    expect(saveMock).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const persisted = saveMock.mock.calls[0]?.[0] as { fontSettings: { editorScale: number } };
    expect(persisted.fontSettings.editorScale).toBe(110);
  });

  it("flushSettingsPersistence writes pending settings immediately", async () => {
    const base = makeState();
    syncSettingsPersistenceEffect({
      runtimeReady: true,
      currentWindowId: "main",
      snapshot: base,
    });
    expect(saveMock).not.toHaveBeenCalled();
    await flushSettingsPersistence();
    expect(saveMock).toHaveBeenCalledTimes(1);
    // No pending write left behind for the timer to repeat.
    vi.runAllTimers();
    expect(saveMock).toHaveBeenCalledTimes(1);
  });
});

describe("settingsPersistenceFingerprint", () => {
  it("ignores cursor position", () => {
    const base = makeState();
    const moved = makeState({
      editor: {
        ...base.editor,
        cursorLine: 99,
        cursorColumn: 99,
        selectionCount: 5,
      },
    });
    expect(settingsPersistenceFingerprint(base)).toBe(settingsPersistenceFingerprint(moved));
  });
});
