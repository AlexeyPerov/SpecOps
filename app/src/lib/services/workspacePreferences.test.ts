import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...segments: string[]) => segments.join("/"),
  appDataDir: async () => "/app-data",
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  readTextFile: vi.fn().mockResolvedValue("{}"),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    // Force macOS-style lowercasing so the round-trip test is deterministic
    // regardless of the host platform running the suite.
    normalizePathSync: (path: string) => {
      let normalized = path.replaceAll("\\", "/");
      while (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }
      return normalized.toLowerCase();
    },
  };
});

import {
  _resetWorkspacePreferencesForTests,
  getHiddenRootPaths,
  isHiddenFromRail,
  loadWorkspacePreferences,
  setHiddenFromRail,
  subscribeWorkspacePreferences,
} from "./workspacePreferences";
import { writeTextFile, readTextFile, exists } from "@tauri-apps/plugin-fs";

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);
const existsMock = vi.mocked(exists);

beforeEach(() => {
  _resetWorkspacePreferencesForTests();
  readTextFileMock.mockReset();
  writeTextFileMock.mockReset();
  existsMock.mockReset();
  existsMock.mockResolvedValue(false);
  readTextFileMock.mockResolvedValue("{}");
  writeTextFileMock.mockResolvedValue(undefined);
});

afterEach(() => {
  _resetWorkspacePreferencesForTests();
});

describe("workspacePreferences", () => {
  it("reports no hidden paths before load", () => {
    expect(getHiddenRootPaths()).toEqual(new Set());
    expect(isHiddenFromRail("/projects/foo")).toBe(false);
  });

  it("loads persisted hidden flags from disk", async () => {
    existsMock.mockResolvedValue(true);
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        workspaces: {
          "/projects/foo": { hiddenFromRail: true },
          "/projects/bar": { hiddenFromRail: false },
        },
      }),
    );
    const hidden = await loadWorkspacePreferences();
    expect(hidden).toEqual(new Set(["/projects/foo"]));
    expect(isHiddenFromRail("/projects/foo")).toBe(true);
    expect(isHiddenFromRail("/projects/bar")).toBe(false);
  });

  it("is resilient to malformed files", async () => {
    existsMock.mockResolvedValue(true);
    readTextFileMock.mockResolvedValue("{not json");
    const hidden = await loadWorkspacePreferences();
    expect(hidden).toEqual(new Set());
  });

  it("sets and persists a hidden flag, normalizing the path key", async () => {
    await setHiddenFromRail("/Projects/Foo", true);
    expect(isHiddenFromRail("/projects/foo")).toBe(true);
    expect(getHiddenRootPaths()).toEqual(new Set(["/projects/foo"]));
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    const [, contents] = writeTextFileMock.mock.calls[0];
    const parsed = JSON.parse(contents as string) as { workspaces: Record<string, { hiddenFromRail: boolean }> };
    expect(parsed.workspaces["/projects/foo"]).toEqual({ hiddenFromRail: true });
  });

  it("can unhide a previously hidden path", async () => {
    await setHiddenFromRail("/projects/foo", true);
    expect(isHiddenFromRail("/projects/foo")).toBe(true);
    await setHiddenFromRail("/projects/foo", false);
    expect(isHiddenFromRail("/projects/foo")).toBe(false);
    expect(getHiddenRootPaths()).toEqual(new Set());
  });

  it("notifies subscribers on load and on every set", async () => {
    const seen: Set<string>[] = [];
    const unsubscribe = subscribeWorkspacePreferences((hidden) => {
      seen.push(new Set(hidden));
    });
    try {
      await loadWorkspacePreferences();
      await setHiddenFromRail("/projects/foo", true);
      await setHiddenFromRail("/projects/foo", false);
      // First emission (load) is empty; the two sets flip foo in then out.
      expect(seen.map((set) => set.has("/projects/foo"))).toEqual([false, true, false]);
    } finally {
      unsubscribe();
    }
  });

  it("unsubscribe stops further notifications", async () => {
    const seen: Set<string>[] = [];
    const unsubscribe = subscribeWorkspacePreferences((hidden) => {
      seen.push(new Set(hidden));
    });
    unsubscribe();
    await setHiddenFromRail("/projects/foo", true);
    expect(seen).toEqual([]);
  });
});
