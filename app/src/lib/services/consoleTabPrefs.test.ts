import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  readWorkspaceConsoleTabPreference,
  workspacePathHashKey,
  writeWorkspaceConsoleTabPreference,
} from "./consoleTabPrefs";
import { mockNavigatorPlatform } from "../test/helpers";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);

describe("workspacePathHashKey", () => {
  let restorePlatform: (() => void) | undefined;

  afterEach(() => {
    restorePlatform?.();
    restorePlatform = undefined;
  });

  it("is stable for identical normalized paths", () => {
    restorePlatform = mockNavigatorPlatform("Linux x86_64");
    expect(workspacePathHashKey("/work/a")).toBe(workspacePathHashKey("/work/a/"));
  });

  it("uses normalized path semantics on macOS", () => {
    restorePlatform = mockNavigatorPlatform("MacIntel");
    expect(workspacePathHashKey("/Work/Repo")).toBe(workspacePathHashKey("/work/repo"));
  });
});

describe("console tab preference persistence", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("returns null when prefs file is missing", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(readWorkspaceConsoleTabPreference("/work/a")).resolves.toBeNull();
  });

  it("returns stored tab for workspace key", async () => {
    const key = workspacePathHashKey("/work/a");
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        version: 1,
        updatedAt: "2026-05-25T00:00:00.000Z",
        tabsByWorkspaceKey: {
          [key]: "logs",
        },
      }),
    );
    await expect(readWorkspaceConsoleTabPreference("/work/a")).resolves.toBe("logs");
  });

  it("writes tab preference keyed by normalized workspace hash", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await writeWorkspaceConsoleTabPreference("/work/a/", "chat");
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    const [path, content] = writeTextFileMock.mock.calls[0];
    expect(path).toBe("/data/spec-ops/console-tab-prefs.json");
    const parsed = JSON.parse(content as string) as {
      version: number;
      updatedAt: string;
      tabsByWorkspaceKey: Record<string, string>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.tabsByWorkspaceKey[workspacePathHashKey("/work/a")]).toBe("chat");
  });
});
