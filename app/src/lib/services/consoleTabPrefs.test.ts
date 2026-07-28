import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import {
  DEFAULT_CONSOLE_HEIGHT_PX,
  normalizeConsoleHeightPx,
  readConsoleHeightPreference,
  writeConsoleHeightPreference,
} from "./consoleTabPrefs";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}));

vi.mock("./atomicWrite", () => ({
  atomicWriteTextFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const atomicWriteTextFileMock = vi.mocked(atomicWriteTextFile);

describe("normalizeConsoleHeightPx", () => {
  it("clamps invalid values to defaults and bounds", () => {
    expect(normalizeConsoleHeightPx(undefined, 900)).toBe(DEFAULT_CONSOLE_HEIGHT_PX);
    expect(normalizeConsoleHeightPx(40, 900)).toBe(120);
    expect(normalizeConsoleHeightPx(900, 900)).toBe(450);
  });
});

describe("console height preference persistence", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    atomicWriteTextFileMock.mockReset();
    atomicWriteTextFileMock.mockResolvedValue(undefined);
  });

  it("returns default height when prefs file is missing", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(readConsoleHeightPreference()).resolves.toBe(DEFAULT_CONSOLE_HEIGHT_PX);
  });

  it("reads and writes console height", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await writeConsoleHeightPreference(240);
    const [, content] = atomicWriteTextFileMock.mock.calls[0];
    const parsed = JSON.parse(content as string) as { consoleHeightPx: number };
    expect(parsed.consoleHeightPx).toBe(240);

    readTextFileMock.mockResolvedValue(content as string);
    await expect(readConsoleHeightPreference()).resolves.toBe(240);
  });
});
