import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectTreeController } from "./projectTreeController";
import type { ProjectTreeNode } from "./projectTree";

const controllers: ReturnType<typeof createProjectTreeController>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.clearFilesystemChangeDebounce();
  vi.useRealTimers();
});
const node = (name: string): ProjectTreeNode => ({ name, path: `/repo/${name}`, kind: "file" });
async function setup(initial = [node("old")]) {
  let files = initial;
  const load = vi.fn(async () => [...files]);
  const publish = vi.fn();
  const controller = createProjectTreeController(publish, { loadDirectoryChildrenFn: load });
  controllers.push(controller);
  await controller.loadProjectTreeRoot({ workspaceRoot: "/repo", isSessionTabActive: false });
  return { controller, load, publish, setFiles: (next: ProjectTreeNode[]) => { files = next; } };
}

it("updates within one second of continuous filesystem events", async () => {
  const { controller, setFiles, load } = await setup();
  setFiles([node("old"), node("new")]);
  for (let i = 0; i < 4; i++) {
    controller.handleFilesystemChange("/repo", "/repo/new");
    await vi.advanceTimersByTimeAsync(250);
  }
  expect(load).toHaveBeenCalledTimes(2);
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["old", "new"]);
});

it("does not discard a distinct event immediately after a reload", async () => {
  const { controller, setFiles } = await setup();
  await controller.reloadDirectories("/repo", ["/repo"]);
  setFiles([node("old"), node("new")]);
  await vi.advanceTimersByTimeAsync(20);
  controller.handleFilesystemChange("/repo", "/repo/new");
  await vi.advanceTimersByTimeAsync(400);
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["old", "new"]);
});

it("keeps events arriving during a directory read for a followup pass", async () => {
  const { controller, setFiles, load } = await setup();
  let resolve!: (nodes: ProjectTreeNode[]) => void;
  load.mockImplementationOnce(() => new Promise<ProjectTreeNode[]>(done => { resolve = done; }));
  controller.handleFilesystemChange("/repo", "/repo/first");
  await vi.advanceTimersByTimeAsync(400);
  setFiles([node("old"), node("new")]);
  controller.handleFilesystemChange("/repo", "/repo/new");
  await vi.advanceTimersByTimeAsync(1500);
  expect(load).toHaveBeenCalledTimes(2);
  resolve([node("old")]);
  await vi.advanceTimersByTimeAsync(400);
  expect(load).toHaveBeenCalledTimes(3);
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["old", "new"]);
});

it("coalesces throttled focus checks into one trailing check", async () => {
  const { controller, setFiles, load } = await setup();
  setFiles([node("old"), node("new")]);
  await vi.advanceTimersByTimeAsync(1000);
  await controller.revalidateProjectTree("/repo");
  await controller.revalidateProjectTree("/repo");
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(2);
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["old", "new"]);
});

it.each([false, true])("revalidates an initially empty tree (force=%s)", async force => {
  const { controller, setFiles } = await setup([]);
  setFiles([node("new")]);
  await vi.advanceTimersByTimeAsync(3000);
  await controller.revalidateProjectTree("/repo", { force });
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["new"]);
});

it("cancels a deferred focus check when switching workspaces", async () => {
  const { controller, load } = await setup();
  await controller.revalidateProjectTree("/repo");
  await controller.loadProjectTreeRoot({ workspaceRoot: "/other", isSessionTabActive: false });
  load.mockClear();
  await vi.advanceTimersByTimeAsync(3000);
  expect(load).not.toHaveBeenCalled();
});

it("does not apply an older focus result over a newer watcher read", async () => {
  const { controller, setFiles, load } = await setup();
  let resolve!: (nodes: ProjectTreeNode[]) => void;
  load.mockImplementationOnce(() => new Promise<ProjectTreeNode[]>(done => { resolve = done; }));
  const check = controller.revalidateProjectTree("/repo", { force: true });
  setFiles([node("new")]);
  controller.handleFilesystemChange("/repo", "/repo/new");
  await vi.advanceTimersByTimeAsync(400);
  resolve([node("old")]);
  await check;
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["new"]);
});

it("retries a temporary read failure without requiring another event", async () => {
  const { controller, setFiles, load } = await setup();
  load.mockRejectedValueOnce(new Error("temporarily unavailable"));
  setFiles([node("new")]);
  controller.handleFilesystemChange("/repo", "/repo/new");
  await vi.advanceTimersByTimeAsync(400);
  expect(controller.getDiagnostics().lastError).toContain("temporarily unavailable");
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["new"]);
  expect(controller.getDiagnostics().lastError).toBeNull();
});

it("runs a trailing focus check after an in-flight check finishes", async () => {
  const { controller, setFiles, load } = await setup();
  let resolve!: (nodes: ProjectTreeNode[]) => void;
  load.mockImplementationOnce(() => new Promise<ProjectTreeNode[]>(done => { resolve = done; }));
  const check = controller.revalidateProjectTree("/repo", { force: true });
  await controller.revalidateProjectTree("/repo");
  setFiles([node("new")]);
  resolve([node("old")]);
  await check;
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(3);
  expect(controller.getState().rootNodes.map(n => n.name)).toEqual(["new"]);
});

it("does not let an old workspace read block reconciliation in the new workspace", async () => {
  const { controller, load } = await setup();
  let resolve!: (nodes: ProjectTreeNode[]) => void;
  load.mockImplementationOnce(() => new Promise<ProjectTreeNode[]>(done => { resolve = done; }));
  const oldCheck = controller.revalidateProjectTree("/repo", { force: true });
  await controller.loadProjectTreeRoot({ workspaceRoot: "/other", isSessionTabActive: false });
  load.mockClear();
  await vi.advanceTimersByTimeAsync(2000);
  await controller.revalidateProjectTree("/other");
  expect(load).toHaveBeenCalledTimes(1);
  resolve([node("stale")]);
  await oldCheck;
});

it("does not retry a deleted expanded folder after its parent listing removes it", async () => {
  const folder: ProjectTreeNode = { name: "src", path: "/repo/src", kind: "directory" };
  const { controller, setFiles, load } = await setup([folder]);
  load.mockImplementationOnce(async () => [node("inside")]);
  await controller.handleToggleProjectTreeDirectory("/repo", "/repo/src");
  setFiles([]);
  load.mockImplementation(async (_root?: string, path?: string) => {
    if (path === "/repo/src") throw new Error("no longer exists");
    return [];
  });
  controller.handleFilesystemChange("/repo", "/repo/src");
  await vi.advanceTimersByTimeAsync(400);
  expect(controller.getState().rootNodes).toEqual([]);
  const calls = load.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(calls);
  expect(controller.getDiagnostics().pendingDirectoryCount).toBe(0);
});

it("drops delayed reads and timers when the last workspace closes", async () => {
  const { controller, load } = await setup();
  let resolve!: (nodes: ProjectTreeNode[]) => void;
  load.mockImplementationOnce(() => new Promise<ProjectTreeNode[]>(done => { resolve = done; }));
  controller.handleFilesystemChange("/repo", "/repo/new");
  await vi.advanceTimersByTimeAsync(400);
  controller.handleFilesystemChange("/repo", "/repo/later");
  controller.retainRoots([]);
  resolve([node("late")]);
  await vi.advanceTimersByTimeAsync(10000);
  expect(controller.getState().rootNodes).toEqual([]);
  expect(controller.getDiagnostics().pendingDirectoryCount).toBe(0);
  expect(load).toHaveBeenCalledTimes(2);
});

it("clears a pending child spinner when a newer revalidation supersedes its read", async () => {
  const folder: ProjectTreeNode = { name: "src", path: "/repo/src", kind: "directory" };
  const { controller, load } = await setup([folder]);
  let resolve!: (nodes: ProjectTreeNode[]) => void;
  load.mockImplementationOnce(() => new Promise<ProjectTreeNode[]>(done => { resolve = done; }));
  const expansion = controller.handleToggleProjectTreeDirectory("/repo", "/repo/src");
  expect(controller.getState().loadingPaths.has("/repo/src")).toBe(true);
  await controller.revalidateProjectTree("/repo", { force: true });
  resolve([node("old")]);
  await expansion;
  expect(controller.getState().loadingPaths.has("/repo/src")).toBe(false);
  expect(controller.getState().childrenByPath.get("/repo/src")).toEqual([folder]);
});
