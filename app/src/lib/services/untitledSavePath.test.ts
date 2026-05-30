import { beforeEach, describe, expect, it, vi } from "vitest";

const joinMock = vi.fn();

vi.mock("@tauri-apps/api/path", () => ({
  join: (...args: string[]) => joinMock(...args),
}));

import { untitledSaveDefaultPath } from "./untitledSavePath";

describe("untitledSaveDefaultPath", () => {
  beforeEach(() => {
    joinMock.mockReset();
    joinMock.mockImplementation((...parts: string[]) => parts.join("/"));
  });

  it("returns undefined when workspace root is null", async () => {
    await expect(untitledSaveDefaultPath("hello", null)).resolves.toBeUndefined();
    expect(joinMock).not.toHaveBeenCalled();
  });

  it("joins workspace root with derived title from first line", async () => {
    await expect(
      untitledSaveDefaultPath("# My Spec\nbody", "/tmp/workspace"),
    ).resolves.toBe("/tmp/workspace/# My Spec");

    expect(joinMock).toHaveBeenCalledWith("/tmp/workspace", "# My Spec");
  });

  it("uses Untitled for empty content", async () => {
    await expect(untitledSaveDefaultPath("", "/tmp/workspace")).resolves.toBe(
      "/tmp/workspace/Untitled",
    );
    expect(joinMock).toHaveBeenCalledWith("/tmp/workspace", "Untitled");
  });
});
