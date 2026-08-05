import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueGitCommandForRepo,
  resetGitCommandQueueForTests,
  type GitCommandLane,
} from "./gitCommandQueue";

describe("enqueueGitCommandForRepo — mutation lane (serialized)", () => {
  beforeEach(() => {
    resetGitCommandQueueForTests();
  });

  afterEach(() => {
    resetGitCommandQueueForTests();
  });

  it("serializes mutation commands for the same repository root", async () => {
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };

    await Promise.all([
      enqueueGitCommandForRepo("/tmp/repo", run, { lane: "mutation" }),
      enqueueGitCommandForRepo("/tmp/repo", run, { lane: "mutation" }),
      enqueueGitCommandForRepo("/tmp/repo", run, { lane: "mutation" }),
    ]);

    expect(maxActive).toBe(1);
  });

  it("allows concurrent mutation commands for different repository roots", async () => {
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
    };

    await Promise.all([
      enqueueGitCommandForRepo("/tmp/a", run, { lane: "mutation" }),
      enqueueGitCommandForRepo("/tmp/b", run, { lane: "mutation" }),
    ]);

    expect(maxActive).toBe(2);
  });

  it("treats normalized repo paths as the same mutation queue key", async () => {
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
    };

    await Promise.all([
      enqueueGitCommandForRepo("/tmp/repo", run, { lane: "mutation" }),
      enqueueGitCommandForRepo("/tmp/repo/", run, { lane: "mutation" }),
    ]);

    expect(maxActive).toBe(1);
  });

  it("treats Windows drive-letter casing as the same mutation queue key", async () => {
    vi.stubGlobal("navigator", { platform: "Win32" });

    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
    };

    await Promise.all([
      enqueueGitCommandForRepo("C:/tmp/repo", run, { lane: "mutation" }),
      enqueueGitCommandForRepo("c:/tmp/repo/", run, { lane: "mutation" }),
    ]);

    expect(maxActive).toBe(1);
    vi.unstubAllGlobals();
  });

  it("propagates errors without breaking the mutation queue chain", async () => {
    await expect(
      enqueueGitCommandForRepo(
        "/tmp/repo",
        async () => {
          throw new Error("boom");
        },
        { lane: "mutation" },
      ),
    ).rejects.toThrow("boom");

    await expect(
      enqueueGitCommandForRepo("/tmp/repo", async () => "ok", { lane: "mutation" }),
    ).resolves.toBe("ok");
  });

  it("does not evict the lane while a successor mutation is still queued (P03-08-08 race)", async () => {
    // Regression guard for the eviction race: when M1's eviction callback was
    // scheduled, it used to check only `activeReads === 0 && readWaiters.length
    // === 0`. A mutation M2 that chained onto the tail in the same microtask
    // window could be evicted out from under a not-yet-run M2, so a later M3
    // created a fresh lane and ran concurrently with M2 — breaking FIFO
    // serialization (and `.git/index.lock` safety). This test rapidly enqueues
    // several mutations whose fns resolve on a shared barrier; they must all
    // remain serialized (never overlapping) regardless of eviction timing.
    let active = 0;
    let maxActive = 0;
    const startOrder: number[] = [];

    const runMutation = (id: number): Promise<void> =>
      enqueueGitCommandForRepo(
        "/tmp/race",
        async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          startOrder.push(id);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        },
        { lane: "mutation" },
      );

    // Enqueue a burst — all in the same tick, so eviction callbacks for the
    // early settle and successor chaining interleave.
    const burst = [runMutation(1), runMutation(2), runMutation(3), runMutation(4)];
    await Promise.all(burst);

    // Every mutation ran on its own (max overlap 1) and in enqueue order.
    expect(maxActive).toBe(1);
    expect(startOrder).toEqual([1, 2, 3, 4]);

    // After everything settles, the lane entry is evicted (no leak).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("enqueueGitCommandForRepo — read lane (bounded concurrent, P03-08-08)", () => {
  beforeEach(() => {
    resetGitCommandQueueForTests();
  });

  afterEach(() => {
    resetGitCommandQueueForTests();
  });

  it("runs read commands concurrently up to the cap", async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    let started = 0;
    const startOrder: number[] = [];

    const runRead = (): Promise<void> =>
      enqueueGitCommandForRepo(
        "/repo",
        () =>
          new Promise<void>((resolve) => {
            activeReads += 1;
            started += 1;
            startOrder.push(started);
            maxActiveReads = Math.max(maxActiveReads, activeReads);
            // Resolve on a timer so the overlap is observable.
            setTimeout(() => {
              activeReads -= 1;
              resolve();
            }, 20);
          }),
        { lane: "read" },
      );

    await Promise.all(Array.from({ length: 8 }, () => runRead()));
    // Cap is 4: concurrency never exceeded it, and all 8 ran.
    expect(maxActiveReads).toBeLessThanOrEqual(4);
    expect(maxActiveReads).toBeGreaterThan(1);
    expect(startOrder).toHaveLength(8);
  });

  it("does not block a read behind a long mutation on the same repo", async () => {
    let mutationResolved = false;
    const mutationGate = { release: () => {} };
    const mutationPromise = enqueueGitCommandForRepo(
      "/repo",
      () =>
        new Promise<void>((resolve) => {
          mutationGate.release = () => {
            mutationResolved = true;
            resolve();
          };
        }),
      { lane: "mutation" },
    );

    let readRan = false;
    const readPromise = enqueueGitCommandForRepo(
      "/repo",
      () => {
        readRan = true;
        return Promise.resolve();
      },
      { lane: "read" },
    );

    await readPromise;
    expect(readRan).toBe(true);
    // The mutation is still blocked — read did not wait for it.
    expect(mutationResolved).toBe(false);

    mutationGate.release();
    await mutationPromise;
    expect(mutationResolved).toBe(true);
  });

  it("rejects a queued command whose signal already aborted without running it", async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(
      enqueueGitCommandForRepo(
        "/repo",
        () => {
          ran = true;
          return Promise.resolve("x");
        },
        { lane: "read", signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(DOMException);
    expect(ran).toBe(false);
  });
});
