import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const fsMock = {
  mkdir: vi.fn(),
  stat: vi.fn(),
  remove: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
};

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (...args: unknown[]) => fsMock.mkdir(...args),
  stat: (...args: unknown[]) => fsMock.stat(...args),
  remove: (...args: unknown[]) => fsMock.remove(...args),
  writeFile: (...args: unknown[]) => fsMock.writeFile(...args),
  readFile: (...args: unknown[]) => fsMock.readFile(...args),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

import {
  awaitSessionWriteLock,
  resetSessionWriteLockForTests,
  withOpenFileRegistryLock,
  withSessionWriteLock,
  WRITE_CHAIN_WATCHDOG_MS,
} from "./sessionWriteLock";

function mockAcquirableLock(): void {
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.writeFile.mockResolvedValue(undefined);
  fsMock.readFile.mockRejectedValue(new Error("no such file"));
  fsMock.stat.mockRejectedValue(new Error("no such file"));
  fsMock.remove.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionWriteLockForTests();
  for (const fn of Object.values(fsMock)) {
    fn.mockReset();
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stale-lock recovery (P03-08-01)", () => {
  it("gives up within the acquire deadline when a stale lock cannot be removed", async () => {
    // Lock is held by another window (mkdir always fails), looks ancient
    // (epoch mtime), and cannot be broken (remove fails). The old loop spun
    // here forever without ever consulting the deadline.
    fsMock.mkdir.mockRejectedValue(new Error("File exists"));
    fsMock.stat.mockResolvedValue({ mtime: new Date(0) });
    fsMock.remove.mockRejectedValue(new Error("EBUSY"));
    fsMock.readFile.mockRejectedValue(new Error("no such file"));
    fsMock.writeFile.mockResolvedValue(undefined);

    let ran = false;
    const pending = withSessionWriteLock(async () => {
      ran = true;
      return "done";
    });

    // Step past the 5 s acquire deadline in retry-delay increments.
    for (let step = 0; step < 150 && !ran; step += 1) {
      await vi.advanceTimersByTimeAsync(50);
    }

    await expect(pending).resolves.toBe("done");
    expect(ran).toBe(true);
    // Bounded retries: the loop slept between attempts instead of busy-spinning.
    expect(fsMock.mkdir.mock.calls.length).toBeLessThan(500);
  });
});

describe("write-chain watchdog (P03-08-03)", () => {
  it("abandons a wedged entry and lets later writes proceed", async () => {
    mockAcquirableLock();

    const wedged = withSessionWriteLock(() => new Promise<never>(() => {}));
    const wedgedError = wedged.catch((error: unknown) => error);
    const follower = withSessionWriteLock(async () => "second");

    await vi.advanceTimersByTimeAsync(WRITE_CHAIN_WATCHDOG_MS + 1_000);

    expect(String(await wedgedError)).toContain("timed out");
    await expect(follower).resolves.toBe("second");
  });

  it("does not watchdog an entry that merely waited behind a slow predecessor", async () => {
    mockAcquirableLock();

    // Predecessor legitimately takes 80% of the watchdog budget.
    const slow = withSessionWriteLock(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("slow"), WRITE_CHAIN_WATCHDOG_MS * 0.8);
        }),
    );
    const follower = withSessionWriteLock(async () => "follower");

    // Total elapsed exceeds one watchdog window, but each entry individually
    // stays within budget — neither may be abandoned.
    await vi.advanceTimersByTimeAsync(WRITE_CHAIN_WATCHDOG_MS * 0.9);
    await expect(slow).resolves.toBe("slow");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(follower).resolves.toBe("follower");
  });
});

describe("independent chains (P03-08-03)", () => {
  it("registry writes do not queue behind a wedged session write", async () => {
    mockAcquirableLock();

    const wedged = withSessionWriteLock(() => new Promise<never>(() => {}));
    void wedged.catch(() => {});

    let registryRan = false;
    const registry = withOpenFileRegistryLock(async () => {
      registryRan = true;
      return "registry";
    });

    // No watchdog window needed: the registry chain is independent.
    await vi.advanceTimersByTimeAsync(100);
    await expect(registry).resolves.toBe("registry");
    expect(registryRan).toBe(true);
  });
});

describe("heartbeat ownership (P03-08-05)", () => {
  it("stops heartbeating and does not delete the lock after a takeover", async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.stat.mockRejectedValue(new Error("no such file"));
    fsMock.remove.mockResolvedValue(undefined);
    // Another window broke our lock and reacquired it: the owner record on
    // disk is theirs.
    const foreignOwner = JSON.stringify({
      windowId: "other-window",
      acquireId: "other-acquire",
      acquiredAt: Date.now(),
    });
    fsMock.readFile.mockResolvedValue(new TextEncoder().encode(foreignOwner));

    let releaseGate: (() => void) | null = null;
    const held = withSessionWriteLock(
      () =>
        new Promise<string>((resolve) => {
          releaseGate = () => resolve("held");
        }),
    );

    await vi.advanceTimersByTimeAsync(10);
    const ownerWritesBeforeBeat = fsMock.writeFile.mock.calls.length;

    // Two heartbeat intervals: the beat must read the foreign owner, stop
    // itself, and never overwrite the new holder's record.
    await vi.advanceTimersByTimeAsync(6_100);
    expect(fsMock.writeFile.mock.calls.length).toBe(ownerWritesBeforeBeat);

    releaseGate!();
    await vi.advanceTimersByTimeAsync(10);
    await expect(held).resolves.toBe("held");
    // Release must not remove the other window's live lock.
    expect(fsMock.remove).not.toHaveBeenCalled();

    await awaitSessionWriteLock();
  });

  it("removes the lock on release while still owned", async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.stat.mockRejectedValue(new Error("no such file"));
    fsMock.remove.mockResolvedValue(undefined);
    // Echo back whatever owner record we wrote, as a real filesystem would.
    let ownerBytes: Uint8Array | null = null;
    fsMock.writeFile.mockImplementation(async (_path: unknown, bytes: unknown) => {
      ownerBytes = bytes as Uint8Array;
    });
    fsMock.readFile.mockImplementation(async () => {
      if (!ownerBytes) {
        throw new Error("no such file");
      }
      return ownerBytes;
    });

    await withSessionWriteLock(async () => "ok");
    expect(fsMock.remove).toHaveBeenCalledWith(
      "/data/spec-ops/session.json.lock",
      { recursive: true },
    );
  });
});
