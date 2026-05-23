import { beforeEach, describe, expect, it } from "vitest";
import type { ExternalFilesSettings } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  collectOpenFilePaths,
  resetExternalFileChangesForTests,
  shouldRunAutomaticCheck,
  shouldSyncFileWatcher,
} from "./externalFileChanges";

const defaultSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

describe("shouldSyncFileWatcher", () => {
  it("returns true when watching is enabled", () => {
    expect(shouldSyncFileWatcher({ ...defaultSettings, watchExternalChanges: true })).toBe(true);
  });

  it("returns false when watching is disabled", () => {
    expect(shouldSyncFileWatcher({ ...defaultSettings, watchExternalChanges: false })).toBe(false);
  });
});

describe("shouldRunAutomaticCheck", () => {
  it("returns false for all triggers when master toggle is off", () => {
    const settings = { ...defaultSettings, watchExternalChanges: false };
    expect(shouldRunAutomaticCheck(settings, "watcher")).toBe(false);
    expect(shouldRunAutomaticCheck(settings, "focus")).toBe(false);
    expect(shouldRunAutomaticCheck(settings, "tab")).toBe(false);
    expect(shouldRunAutomaticCheck(settings, "startup")).toBe(false);
  });

  it("always runs watcher and startup when master toggle is on", () => {
    expect(shouldRunAutomaticCheck(defaultSettings, "watcher")).toBe(true);
    expect(shouldRunAutomaticCheck(defaultSettings, "startup")).toBe(true);
  });

  it("respects checkOnWindowFocus", () => {
    expect(
      shouldRunAutomaticCheck({ ...defaultSettings, checkOnWindowFocus: true }, "focus"),
    ).toBe(true);
    expect(
      shouldRunAutomaticCheck({ ...defaultSettings, checkOnWindowFocus: false }, "focus"),
    ).toBe(false);
  });

  it("respects checkOnTabActivate", () => {
    expect(
      shouldRunAutomaticCheck({ ...defaultSettings, checkOnTabActivate: true }, "tab"),
    ).toBe(true);
    expect(
      shouldRunAutomaticCheck({ ...defaultSettings, checkOnTabActivate: false }, "tab"),
    ).toBe(false);
  });
});

describe("collectOpenFilePaths", () => {
  beforeEach(() => {
    resetExternalFileChangesForTests();
    appState.resetWorkspace();
  });

  it("returns empty list when no saved files are open", () => {
    expect(collectOpenFilePaths()).toEqual([]);
  });

  it("skips untitled documents", () => {
    appState.createTab();
    expect(collectOpenFilePaths()).toEqual([]);
  });

  it("returns unique saved paths from open tabs", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/a.txt", "a again");

    const paths = collectOpenFilePaths();
    expect(paths).toHaveLength(2);
    expect(paths).toContain("/tmp/a.txt");
    expect(paths).toContain("/tmp/b.txt");
  });
});
