import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectTreeWatcherSync } from "./projectTreeWatcherSync";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("retries the same roots after registration failure with bounded backoff", async () => {
  const sync = vi.fn().mockRejectedValueOnce(new Error("missing root")).mockResolvedValue(undefined);
  const onError = vi.fn();
  const afterSync = vi.fn();
  const controller = createProjectTreeWatcherSync({ sync, onError });
  controller.request(["/repo"], afterSync);
  await vi.advanceTimersByTimeAsync(0);
  expect(afterSync).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(sync).toHaveBeenNthCalledWith(2, ["/repo"]);
  expect(afterSync).toHaveBeenCalledTimes(1);
  controller.dispose();
});

it("serializes registrations and coalesces rapid changes to the latest roots", async () => {
  let resolve!: () => void;
  const sync = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { resolve = done; })).mockResolvedValue(undefined);
  const controller = createProjectTreeWatcherSync({ sync, onError: vi.fn() });
  controller.request(["/first"]);
  controller.request(["/intermediate"]);
  controller.request(["/last"]);
  expect(sync).toHaveBeenCalledTimes(1);
  resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenLastCalledWith(["/last"]);
  controller.dispose();
});

it("recovers the same roots after a native error", async () => {
  const sync = vi.fn().mockResolvedValue(undefined);
  const controller = createProjectTreeWatcherSync({ sync, onError: vi.fn() });
  controller.request(["/repo"]);
  await vi.advanceTimersByTimeAsync(0);
  controller.recover();
  await vi.advanceTimersByTimeAsync(0);
  expect(sync).toHaveBeenCalledTimes(2);
  controller.dispose();
});

it("cancels retries and ignores late errors after disposal", async () => {
  let reject!: (error: Error) => void;
  const sync = vi.fn(() => new Promise<void>((_, done) => { reject = done; }));
  const onError = vi.fn();
  const controller = createProjectTreeWatcherSync({ sync, onError });
  controller.request(["/repo"]);
  controller.dispose();
  reject(new Error("late"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

it("leaving workspaces cancels a pending retry and clears the native roots", async () => {
  const sync = vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValue(undefined);
  const controller = createProjectTreeWatcherSync({ sync, onError: vi.fn() });
  controller.request(["/repo"]);
  await vi.advanceTimersByTimeAsync(0);
  controller.request([]);
  await vi.advanceTimersByTimeAsync(60000);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenLastCalledWith([]);
  controller.dispose();
});
