import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { formatOpenAllInFolderSummary, openAllInFolder } from "./openAllInFolder";

vi.mock("./openActivePath", () => ({
  openActivePath: vi.fn(),
}));

vi.mock("./openFileRegistry", () => ({
  readOpenFileRegistry: vi.fn().mockResolvedValue({}),
}));

import { openActivePath } from "./openActivePath";
import { readOpenFileRegistry } from "./openFileRegistry";

const openActivePathMock = vi.mocked(openActivePath);
const readOpenFileRegistryMock = vi.mocked(readOpenFileRegistry);

describe("formatOpenAllInFolderSummary", () => {
  it("describes a mixed batch result", () => {
    expect(
      formatOpenAllInFolderSummary({
        opened: 2,
        skippedExisting: 1,
        skippedTooLarge: 1,
        skippedFailed: 0,
        focusedExisting: false,
      }),
    ).toBe("Opened 2 file(s) (skipped 1 already open, skipped 1 too large).");
  });

  it("describes when everything was already open", () => {
    expect(
      formatOpenAllInFolderSummary({
        opened: 0,
        skippedExisting: 3,
        skippedTooLarge: 0,
        skippedFailed: 0,
        focusedExisting: true,
      }),
    ).toBe("All 3 file(s) were already open.");
  });
});

describe("openAllInFolder", () => {
  beforeEach(() => {
    appState.resetAppState();
    openActivePathMock.mockReset();
    readOpenFileRegistryMock.mockResolvedValue({});
  });

  it("opens new files and skips existing ones after the first new open", async () => {
    appState.openFileInTab("/tmp/a.ts", "a");
    openActivePathMock.mockResolvedValue({ kind: "opened", path: "/tmp/b.ts" });

    const summary = await openAllInFolder(["/tmp/a.ts", "/tmp/b.ts"], "main");

    expect(openActivePathMock).toHaveBeenCalledTimes(1);
    expect(openActivePathMock).toHaveBeenCalledWith("/tmp/b.ts", "main");
    expect(summary.opened).toBe(1);
    expect(summary.skippedExisting).toBe(1);
  });

  it("focuses the first existing file when nothing new opens", async () => {
    appState.openFileInTab("/tmp/a.ts", "a");
    appState.openFileInTab("/tmp/b.ts", "b");
    openActivePathMock.mockResolvedValue({ kind: "existing", path: "/tmp/a.ts" });

    const summary = await openAllInFolder(["/tmp/a.ts", "/tmp/b.ts"], "main");

    expect(openActivePathMock).toHaveBeenCalledTimes(1);
    expect(openActivePathMock).toHaveBeenCalledWith("/tmp/a.ts", "main");
    expect(summary.focusedExisting).toBe(true);
    expect(summary.opened).toBe(0);
  });
});
