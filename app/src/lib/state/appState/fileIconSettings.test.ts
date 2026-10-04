import { describe, expect, it } from "vitest";
import { appState } from "../appState";
import { settingsPersistenceFingerprint } from "../appStateSelectors";

describe("file icon settings", () => {
  it("includes the file icon choice in persistence and restores it on load", () => {
    appState.resetAppState();
    const previous = settingsPersistenceFingerprint(appState.getSnapshot());
    appState.setColoredProjectFileIcons(false);
    expect(appState.getSnapshot().settings.coloredProjectFileIcons).toBe(false);
    expect(settingsPersistenceFingerprint(appState.getSnapshot())).not.toBe(previous);
    appState.applyPersistedSettings({ coloredProjectFileIcons: true });
    expect(appState.getSnapshot().settings.coloredProjectFileIcons).toBe(true);
  });

});
