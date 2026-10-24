import { flushSync, tick } from "svelte";
import { expect, it, vi } from "vitest";
import { mountComponent } from "./_testComponentMount";
import ProjectPanel from "./ProjectPanel.svelte";
import type { FolderSizeProgress } from "../services/projectSizes";
const native = vi.hoisted(() => ({
  files: vi.fn(async (_root: string, paths: string[]) => paths.map((path) => ({ path, bytes: 2048 }))),
  start: vi.fn(async (_root: string, _path: string, progress: (value: FolderSizeProgress) => void) => {
    native.progress = progress; return 1;
  }),
  cancel: vi.fn(async () => {}),
  progress: (_value: FolderSizeProgress) => {},
}));
vi.mock("../services/projectFavorites", () => ({ loadProjectFavorites: async () => [], listenProjectFavorites: async () => () => {} }));
vi.mock("../services/projectSizes", async (load) => {
  const actual = await load<typeof import("../services/projectSizes")>();
  return { ...actual, createProjectSizes: (deps: Parameters<typeof actual.createProjectSizes>[0]) => actual.createProjectSizes({ ...deps, files: native.files, start: native.start, cancel: native.cancel }) };
});
const node = (name: string, kind: "file" | "directory" = "file") => ({ name, path: `/repo/${name}`, kind });
async function select(host: HTMLElement, label: string, value: string) {
  if (label === "Filter project files") {
    host.querySelector<HTMLButtonElement>('button[aria-label="Filter project files"]')!.click(); flushSync();
    const labels = { images: "Images and textures", markdown: "Markdown", all: "All files" };
    [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) => button.textContent?.trim().endsWith(labels[value as keyof typeof labels]))!.click();
    flushSync(); await tick(); flushSync(); return;
  }
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync(); await tick(); flushSync();
}
it("filters texture branches and keeps Markdown as a separate mode", async () => {
  const readProjectDirectory = vi.fn(async (path: string) => path === "/repo" ? [
    { name: "textures", isDirectory: true, isFile: false },
    { name: "code", isDirectory: true, isFile: false },
  ] : [{ name: path.endsWith("textures") ? "a.DDS" : "a.ts", isDirectory: false, isFile: true }]);
  const { host } = mountComponent(ProjectPanel, { workspaceRoot: "/repo", readProjectDirectory,
    rootNodes: [node("textures", "directory"), node("code", "directory"), node("readme.md"), node("a.png")],
  }); flushSync();
  expect(readProjectDirectory).not.toHaveBeenCalled();
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Filter project files"]')!;
  expect(host.querySelector('select[aria-label="Filter project files"]')).toBeNull();
  trigger.click(); flushSync();
  expect(host.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toContain("All files");
  host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); flushSync();
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await select(host, "Filter project files", "images");
  await vi.waitFor(() => { flushSync(); expect(host.querySelector('[data-path="/repo/code"]')).toBeNull(); });
  expect(host.querySelector('[data-path="/repo/textures"]')).not.toBeNull();
  expect(host.querySelector('[data-path="/repo/a.png"]')).not.toBeNull();
  expect(host.querySelector('[data-path="/repo/readme.md"]')).toBeNull();
  expect(trigger.classList.contains("project-filter-active")).toBe(true);
  await select(host, "Filter project files", "markdown");
  expect(host.querySelector('[data-path="/repo/a.png"]')).toBeNull();
  expect(host.querySelector('[data-path="/repo/readme.md"]')).not.toBeNull();
});
it("shows file sizes only when enabled and calculates/cancels folders through the menu", async () => {
  native.files.mockClear(); native.start.mockClear(); native.cancel.mockClear();
  const { host } = mountComponent(ProjectPanel, { workspaceRoot: "/repo", rootNodes: [node("a.dds"), node("assets", "directory")] }); flushSync();
  expect(host.querySelector(".project-tree-size")).toBeNull(); expect(native.files).not.toHaveBeenCalled();
  await select(host, "Project file sizes", "files");
  await vi.waitFor(() => { flushSync(); expect(host.querySelector(".project-tree-size")?.textContent).toBe("2.0 KiB"); });
  expect(native.start).not.toHaveBeenCalled();
  host.querySelector('[data-path="/repo/assets"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); flushSync();
  [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.trim() === "Calculate folder size")!.click();
  flushSync(); await tick();
  expect(native.start).toHaveBeenCalledWith("/repo", "/repo/assets", expect.any(Function));
  native.progress({ bytes: 4096, files: 2, entries: 3, errors: 0, done: false, reason: null, calculatedAt: 0 }); flushSync();
  expect(host.querySelector('[data-path="/repo/assets"] .project-tree-size')?.textContent).toBe("4.0 KiB …");
  host.querySelector('[data-path="/repo/assets"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); flushSync();
  [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.trim() === "Cancel size calculation")!.click();
  expect(native.cancel).toHaveBeenCalledWith(1);
  native.progress({ bytes: 4096, files: 2, entries: 3, errors: 0, done: true, reason: "cancelled", calculatedAt: Date.now() }); flushSync();
  expect(host.querySelector('[data-path="/repo/assets"] .project-tree-size')?.textContent).toBe("≥ 4.0 KiB");
});
