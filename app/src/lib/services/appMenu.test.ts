import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "../domain/contracts";

vi.mock("@tauri-apps/api/menu", () => {
  const submenu = {
    items: vi.fn().mockResolvedValue([]),
    removeAt: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Menu: {
      new: vi.fn().mockResolvedValue({
        setAsAppMenu: vi.fn().mockResolvedValue(undefined),
      }),
    },
    MenuItem: { new: vi.fn().mockResolvedValue({}) },
    PredefinedMenuItem: { new: vi.fn().mockResolvedValue({}) },
    Submenu: { new: vi.fn().mockResolvedValue(submenu),
    },
  };
});

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/home/user"),
}));

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

import {
  initializeAppMenu,
  queueOpenRecentPath,
  resetAppMenuForTests,
  shouldInitializeAppMenu,
  takeQueuedOpenRecentPath,
} from "./appMenu";

describe("open recent path queue", () => {
  beforeEach(() => {
    resetAppMenuForTests();
  });

  afterEach(() => {
    resetAppMenuForTests();
  });

  it("returns null when the queue is empty", () => {
    expect(takeQueuedOpenRecentPath()).toBeNull();
  });

  it("round-trips a queued path through takeQueuedOpenRecentPath", async () => {
    const runCommand = vi.fn<(commandId: AppCommandId) => void>();
    await initializeAppMenu(runCommand, []);

    queueOpenRecentPath("/tmp/recent.txt");

    expect(runCommand).toHaveBeenCalledWith("file.openRecent");
    expect(takeQueuedOpenRecentPath()).toBe("/tmp/recent.txt");
    expect(takeQueuedOpenRecentPath()).toBeNull();
  });

  it("ignores queueOpenRecentPath when menuRunCommand is not registered", () => {
    queueOpenRecentPath("/tmp/orphan.txt");
    expect(takeQueuedOpenRecentPath()).toBeNull();
  });
});

describe("shouldInitializeAppMenu", () => {
  it("returns true only for the main window label", () => {
    expect(shouldInitializeAppMenu("main")).toBe(true);
    expect(shouldInitializeAppMenu("secondary")).toBe(false);
    expect(shouldInitializeAppMenu("win-2")).toBe(false);
  });
});
