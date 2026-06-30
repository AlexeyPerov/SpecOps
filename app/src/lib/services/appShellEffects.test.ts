import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAppShellEffectsForTests,
  syncActiveFileTreeExpandEffect,
  type SyncActiveFileTreeExpandEffectInput,
} from "./appShellEffects";

describe("syncActiveFileTreeExpandEffect", () => {
  beforeEach(() => {
    resetAppShellEffectsForTests();
    vi.useFakeTimers();
  });

  it("debounces rapid active-file changes and applies only the latest path", () => {
    const ensureExpandedForActiveFile = vi.fn(async () => {});
    const input = (
      activeDocumentPath: string | null,
    ): SyncActiveFileTreeExpandEffectInput => ({
      activeDocumentPath,
      isChatHttpActive: false,
      activeWorkspaceRoot: "/repo",
      projectTreeController: {
        ensureExpandedForActiveFile,
      } as unknown as SyncActiveFileTreeExpandEffectInput["projectTreeController"],
    });

    syncActiveFileTreeExpandEffect(input("/repo/src/one.ts"));
    syncActiveFileTreeExpandEffect(input("/repo/src/two.ts"));
    expect(ensureExpandedForActiveFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(75);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledTimes(1);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledWith("/repo", "/repo/src/two.ts");
  });

  it("dedupes when active document path is unchanged", () => {
    const ensureExpandedForActiveFile = vi.fn(async () => {});
    const input: SyncActiveFileTreeExpandEffectInput = {
      activeDocumentPath: "/repo/src/main.ts",
      isChatHttpActive: false,
      activeWorkspaceRoot: "/repo",
      projectTreeController: {
        ensureExpandedForActiveFile,
      } as unknown as SyncActiveFileTreeExpandEffectInput["projectTreeController"],
    };

    syncActiveFileTreeExpandEffect(input);
    vi.advanceTimersByTime(75);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledTimes(1);

    syncActiveFileTreeExpandEffect(input);
    vi.advanceTimersByTime(75);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledTimes(1);
  });
});
