import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueGitCommandForRepo,
  resetGitCommandQueueForTests,
} from "./gitCommandQueue";

describe("enqueueGitCommandForRepo", () => {
  beforeEach(() => {
    resetGitCommandQueueForTests();
  });

  afterEach(() => {
    resetGitCommandQueueForTests();
  });

  it("serializes commands for the same repository root", async () => {
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };

    await Promise.all([
      enqueueGitCommandForRepo("/tmp/repo", run),
      enqueueGitCommandForRepo("/tmp/repo", run),
      enqueueGitCommandForRepo("/tmp/repo", run),
    ]);

    expect(maxActive).toBe(1);
  });

  it("allows concurrent commands for different repository roots", async () => {
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
    };

    await Promise.all([
      enqueueGitCommandForRepo("/tmp/a", run),
      enqueueGitCommandForRepo("/tmp/b", run),
    ]);

    expect(maxActive).toBe(2);
  });

  it("treats normalized repo paths as the same queue key", async () => {
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
    };

    await Promise.all([
      enqueueGitCommandForRepo("/tmp/repo", run),
      enqueueGitCommandForRepo("/tmp/repo/", run),
    ]);

    expect(maxActive).toBe(1);
  });

  it("propagates errors without breaking the queue chain", async () => {
    await expect(
      enqueueGitCommandForRepo("/tmp/repo", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(
      enqueueGitCommandForRepo("/tmp/repo", async () => "ok"),
    ).resolves.toBe("ok");
  });
});
