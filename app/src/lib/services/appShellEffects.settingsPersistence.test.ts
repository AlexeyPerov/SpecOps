import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../state/appState/settingsSlice";
import type { AppDomainState } from "../domain/contracts";
import {
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
          editorLayout: {
            panes: [],
            activePaneId: "pane-1",
          },
          lastActiveWindowId: "main",
          windowBounds: null,
          lastActiveSessionId: null,
        },
      },
      chatHttp: {
        documents: [],
        session: {
          editorLayout: {
            panes: [],
            activePaneId: "pane-1",
          },
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
      darkThemeId: { kind: "builtin", id: "dark" },
      lightThemeId: { kind: "builtin", id: "light" },
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
    resetAppShellEffectsForTests();
    saveMock.mockClear();
  });

  it("skips disk write when only cursor fields change", () => {
    const base = makeState();
    syncSettingsPersistenceEffect({
      runtimeReady: true,
      currentWindowId: "main",
      snapshot: base,
    });
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
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("persists again when a settings field changes", () => {
    const base = makeState();
    syncSettingsPersistenceEffect({
      runtimeReady: true,
      currentWindowId: "main",
      snapshot: base,
    });

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
    expect(saveMock).toHaveBeenCalledTimes(2);
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
