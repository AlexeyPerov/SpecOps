import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { DEFAULT_HISTORY_FILTER_MODE } from "./types";
import {
  HISTORY_FILTER_MODE_OPTIONS,
  parsePersistedHistoryFilterMode,
  parsePersistedHistoryFilterSnapshot,
  readPersistedHistoryFilterMode,
  reconcileHistoryFilterMode,
  writePersistedHistoryFilterMode,
} from "./versionControlHistoryFilter";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../services/appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);

describe("parsePersistedHistoryFilterMode", () => {
  it("accepts known filter modes", () => {
    for (const option of HISTORY_FILTER_MODE_OPTIONS) {
      expect(parsePersistedHistoryFilterMode(option.value)).toBe(option.value);
    }
  });

  it("rejects unknown values", () => {
    expect(parsePersistedHistoryFilterMode("everything")).toBeNull();
    expect(parsePersistedHistoryFilterMode(null)).toBeNull();
  });
});

describe("reconcileHistoryFilterMode", () => {
  it("falls back to the default mode", () => {
    expect(reconcileHistoryFilterMode(null)).toBe(DEFAULT_HISTORY_FILTER_MODE);
    expect(reconcileHistoryFilterMode("invalid")).toBe(DEFAULT_HISTORY_FILTER_MODE);
  });

  it("restores a valid stored mode", () => {
    expect(reconcileHistoryFilterMode("all-branches-and-remotes")).toBe(
      "all-branches-and-remotes",
    );
  });
});

describe("history filter persistence", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
  });

  it("returns null when no snapshot exists", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(readPersistedHistoryFilterMode("/tmp/repo")).resolves.toBeNull();
  });

  it("reads a stored mode for a normalized repo key", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        version: 1,
        updatedAt: "2026-07-04T00:00:00.000Z",
        byRepo: {
          "/tmp/repo": "all-branches",
        },
      }),
    );

    await expect(readPersistedHistoryFilterMode("/tmp/repo")).resolves.toBe("all-branches");
  });

  it("writes non-default modes and omits default mode entries", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        version: 1,
        updatedAt: "2026-07-04T00:00:00.000Z",
        byRepo: {
          "/tmp/other": "all-branches",
        },
      }),
    );

    await writePersistedHistoryFilterMode("/tmp/repo", "all-branches-and-remotes");

    expect(writeTextFileMock).toHaveBeenCalledOnce();
    const [, raw] = writeTextFileMock.mock.calls[0] ?? [];
    const snapshot = parsePersistedHistoryFilterSnapshot(String(raw));
    expect(snapshot?.byRepo["/tmp/other"]).toBe("all-branches");
    expect(snapshot?.byRepo["/tmp/repo"]).toBe("all-branches-and-remotes");

    readTextFileMock.mockResolvedValue(String(raw));
    await writePersistedHistoryFilterMode("/tmp/repo", DEFAULT_HISTORY_FILTER_MODE);

    const [, resetRaw] = writeTextFileMock.mock.calls[1] ?? [];
    const resetSnapshot = parsePersistedHistoryFilterSnapshot(String(resetRaw));
    expect(resetSnapshot?.byRepo["/tmp/repo"]).toBeUndefined();
    expect(resetSnapshot?.byRepo["/tmp/other"]).toBe("all-branches");
  });
});
