import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectSizes, projectSizeLabel, type FolderSizeProgress, type ProjectSizeEntry } from "./projectSizes";

const complete = (bytes: number): FolderSizeProgress => ({ bytes, files: 2, entries: 3, errors: 0, done: true, reason: null, calculatedAt: 1000 });
afterEach(() => { vi.useRealTimers(); });
function harness(overrides: Partial<Parameters<typeof createProjectSizes>[0]> = {}) {
  let snapshot: ReadonlyMap<string, ProjectSizeEntry> = new Map();
  const files = vi.fn(async (_root: string, paths: string[]) => paths.map((path) => ({ path, bytes: 12 })));
  const cancel = vi.fn(async () => {});
  const controller = createProjectSizes({ files, cancel, ...overrides, publish: (entries) => { snapshot = entries; } });
  return { controller, files, cancel, snapshot: () => snapshot };
}

describe("project sizes", () => {
  it("does no work while off, batches visible files, reuses cache and refreshes content-only changes", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.controller.configure("/repo", "off"); h.controller.visibleFiles(["/repo/a"]);
    await vi.advanceTimersByTimeAsync(1000); expect(h.files).not.toHaveBeenCalled();
    h.controller.configure("/repo", "files");
    await vi.advanceTimersByTimeAsync(100); expect(h.files).toHaveBeenCalledExactlyOnceWith("/repo", ["/repo/a"]);
    h.controller.visibleFiles(["/repo/a"]);
    await vi.advanceTimersByTimeAsync(100); expect(h.files).toHaveBeenCalledTimes(1);
    h.controller.changed("/repo/a");
    await vi.advanceTimersByTimeAsync(500); expect(h.files).toHaveBeenCalledTimes(2);
    expect(h.snapshot().get("/repo/a")?.bytes).toBe(12);
    h.controller.dispose();
  });
  it("drops queued rows on scrolling, caps batches and ignores another workspace's late response", async () => {
    vi.useFakeTimers();
    let finish!: (value: { path: string; bytes: number }[]) => void;
    const files = vi.fn(() => new Promise<{ path: string; bytes: number }[]>((resolve) => { finish = resolve; }));
    const h = harness({ files }); h.controller.configure("/repo", "files");
    h.controller.visibleFiles(Array.from({ length: 1000 }, (_, n) => `/repo/${n}`));
    h.controller.visibleFiles(["/repo/new"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(files).toHaveBeenCalledExactlyOnceWith("/repo", ["/repo/new"]);
    h.controller.configure("/other", "files");
    finish([{ path: "/repo/new", bytes: 12 }]); await vi.advanceTimersByTimeAsync(100);
    expect(h.snapshot().size).toBe(0); h.controller.dispose();
  });
  it("does not restore stale metadata when a write arrives during a batch", async () => {
    vi.useFakeTimers();
    let finish!: (value: { path: string; bytes: number }[]) => void;
    const files = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue([{ path: "/repo/a", bytes: 99 }]);
    const h = harness({ files }); h.controller.configure("/repo", "files"); h.controller.visibleFiles(["/repo/a"]);
    await vi.advanceTimersByTimeAsync(100); h.controller.changed("/repo/a");
    finish([{ path: "/repo/a", bytes: 1 }]); await vi.advanceTimersByTimeAsync(500);
    expect(h.snapshot().get("/repo/a")?.bytes).toBe(99); h.controller.dispose();
  });
  it("keeps folder calculations explicit, prevents overlapping walks, marks ancestors stale", async () => {
    vi.useFakeTimers();
    let progress!: (value: FolderSizeProgress) => void;
    const start = vi.fn(async (_root: string, _path: string, callback: typeof progress) => { progress = callback; return 1; });
    const h = harness({ start }); h.controller.configure("/repo", "folders");
    await vi.advanceTimersByTimeAsync(1000); expect(start).not.toHaveBeenCalled();
    await h.controller.calculate("/repo/assets");
    await h.controller.calculate("/repo/assets/nested"); expect(start).toHaveBeenCalledTimes(1);
    h.controller.changed("/repo/assets/a.dds"); progress(complete(2048));
    expect(h.snapshot().get("/repo/assets")?.stale).toBe(true);
    expect(projectSizeLabel(h.snapshot().get("/repo/assets"))).toBe("2.0 KiB *");
    h.controller.dispose();
  });
  it("cancels a start that finishes registering after the pane was disabled", async () => {
    let finish!: (id: number) => void;
    const h = harness({ start: () => new Promise((resolve) => { finish = resolve; }) });
    h.controller.configure("/repo", "folders");
    const pending = h.controller.calculate("/repo/assets");
    h.controller.configure("/repo", "off"); finish(17); await pending;
    expect(h.cancel).toHaveBeenCalledWith(17);
    expect(h.snapshot().get("/repo/assets")?.loading).toBe(false);
    h.controller.dispose();
  });
  it("bounds the file metadata cache and individual batches", async () => {
    vi.useFakeTimers();
    const h = harness(); h.controller.configure("/repo", "files");
    for (let batch = 0; batch < 20; batch++) {
      h.controller.visibleFiles(Array.from({ length: 256 }, (_, n) => `/repo/${batch * 256 + n}`));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(h.files.mock.calls.every(([, paths]) => paths.length <= 128)).toBe(true);
    expect(h.snapshot().size).toBeLessThanOrEqual(2048);
    h.controller.dispose();
  });
});
