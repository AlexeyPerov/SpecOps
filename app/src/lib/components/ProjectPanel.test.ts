import { flushSync, tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
const favorites = vi.hoisted(() => ({ entries: [] as { name: string; path: string; kind: "file" | "directory" }[], changed: () => {} }));
vi.mock("../services/projectFavorites", () => ({
  loadProjectFavorites: async () => favorites.entries,
  listenProjectFavorites: async (_root: string, changed: () => void) => { favorites.changed = changed; return () => {}; },
  setProjectFavorite: async (_root: string, node: { path: string }, _favorite: boolean) => {
    favorites.entries = favorites.entries.filter((entry) => entry.path !== node.path);
    favorites.changed();
  },
}));
import ProjectPanel from "./ProjectPanel.svelte";
import { mountComponent } from "./_testComponentMount";

const dir = (path: string) => ({ name: path.split("/").pop()!, path, kind: "directory" as const });
describe("project panel navigation", () => {
  it("expands only the first closed level and delegates collapse all", () => {
    favorites.entries = [];
    const toggle = vi.fn(); const collapse = vi.fn();
    const { host } = mountComponent(ProjectPanel, {
      workspaceRoot: "/repo", rootNodes: [dir("/repo/docs"), dir("/repo/src")],
      expandedPaths: new Set(["/repo/docs"]),
      childrenByPath: new Map([["/repo/docs", [dir("/repo/docs/sub")]], ["/repo/docs/sub", [dir("/repo/docs/sub/deep")]]]),
      onToggleDirectory: toggle, onCollapseAll: collapse,
    });
    flushSync();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((button) => button.textContent?.trim() === "Expand one level")!.click();
    expect(toggle.mock.calls.map(([path]) => path)).toEqual(["/repo/docs/sub", "/repo/src"]);
    buttons.find((button) => button.textContent?.trim() === "Collapse all")!.click();
    expect(collapse).toHaveBeenCalledOnce();
  });
  it("renders synced favorites above the tree, opens files and allows removal", async () => {
    favorites.entries = [{ name: "a.md", path: "/repo/a.md", kind: "file" }];
    const open = vi.fn();
    const { host } = mountComponent(ProjectPanel, { workspaceRoot: "/repo", onOpenFile: open });
    flushSync(); await tick(); await tick(); flushSync();
    expect(host.querySelector(".project-favorites")).not.toBeNull();
    host.querySelector<HTMLButtonElement>(".favorite-link")!.click();
    expect(open).toHaveBeenCalledWith("/repo/a.md");
    host.querySelector<HTMLButtonElement>(".favorite-remove")!.click();
    await tick(); await tick(); flushSync();
    expect(host.querySelector(".project-favorites")).toBeNull();
  });
});

it("selects a range without activating files and copies all relative paths in tree order", async () => {
  favorites.entries = [];
  const open = vi.fn();
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  const nodes = ["a", "b", "c"].map((name) => ({ name, path: `/repo/${name}`, kind: "file" as const }));
  const { host } = mountComponent(ProjectPanel, { workspaceRoot: "/repo", rootNodes: nodes, onOpenFile: open });
  flushSync();
  host.querySelector<HTMLButtonElement>('[data-path="/repo/a"]')!.click(); flushSync();
  host.querySelector<HTMLButtonElement>('[data-path="/repo/c"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); flushSync();
  expect(open.mock.calls).toEqual([["/repo/a"]]);
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(3);
  host.querySelector<HTMLButtonElement>('[data-path="/repo/b"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); flushSync();
  [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.trim() === "Copy Relative Path List")!.click();
  await tick();
  expect(clipboard).toHaveBeenCalledWith("- a\n- b\n- c");
});

it.each([
  ["New File…", "New file name", "onNewFile", "draft.txt"],
  ["New Folder…", "New folder name", "onNewFolder", "Draft Folder"],
] as const)("creates an entry through %s in the root context menu", async (menuLabel, inputLabel, handler, name) => {
  favorites.entries = [];
  const create = vi.fn().mockResolvedValue(true);
  const { host } = mountComponent(ProjectPanel, {
    workspaceRoot: "/users/alexeyperov/documents/notes",
    [handler]: create,
  });
  flushSync();
  host.querySelector(".project-panel-body")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  flushSync();
  [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((button) => button.textContent?.trim() === menuLabel)!.click();
  flushSync();
  await tick();
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${inputLabel}"]`);
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(host.querySelector('[role="menu"]')).toBeNull();
  input!.value = name;
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await tick(); await tick(); flushSync();
  expect(create).toHaveBeenCalledWith("/users/alexeyperov/documents/notes", name);
  expect(host.querySelector(`input[aria-label="${inputLabel}"]`)).toBeNull();
});

it("selects without opening files, copies a path list and exits with Escape", async () => {
  favorites.entries = [];
  const open = vi.fn(), keep = vi.fn(), toggle = vi.fn();
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  const nodes = [dir("/repo/docs"), ...["a", "b"].map((name) => ({ name, path: `/repo/${name}`, kind: "file" as const }))];
  const { host } = mountComponent(ProjectPanel, { workspaceRoot: "/repo", rootNodes: nodes, onOpenFile: open, onKeepFile: keep, onToggleDirectory: toggle });
  flushSync();
  const action = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label)!;
  const row = (path: string) => host.querySelector<HTMLButtonElement>(`[data-path="${path}"]`)!;
  action("Select multiple items").click(); flushSync();
  row("/repo/a").click(); row("/repo/b").click(); flushSync();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("2 selected");
  row("/repo/b").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  expect(open).not.toHaveBeenCalled(); expect(keep).not.toHaveBeenCalled();
  row("/repo/docs").querySelector(".tree-chevron path")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); flushSync();
  expect(toggle).toHaveBeenCalledWith("/repo/docs");
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(2);
  row("/repo/a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); flushSync();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); flushSync();
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("2 selected");
  row("/repo/a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); flushSync();
  action("Copy Path List").click(); await tick(); flushSync();
  expect(clipboard).toHaveBeenCalledWith("- /repo/a\n- /repo/b");
  row("/repo/a").click(); flushSync();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("1 selected");
  row("/repo/b").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); flushSync();
  expect(host.querySelector(".project-selection-bar")).toBeNull();
  expect(host.querySelector(".project-tree-selection-check")).toBeNull();
  row("/repo/b").click(); flushSync();
  expect(open).toHaveBeenCalledWith("/repo/b");
  action("Select multiple items").click(); flushSync();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); flushSync();
  expect(host.querySelector(".project-selection-bar")).toBeNull();
});

it("shows an icon with a tooltip and pressed state for hidden files", () => {
  favorites.entries = [];
  const toggle = vi.fn();
  const { host } = mountComponent(ProjectPanel, { workspaceRoot: "/repo", showHidden: true, onToggleHidden: toggle });
  flushSync();
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Hide hidden files"]')!;
  expect(button.title).toBe("Hide hidden files");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.textContent?.trim()).toBe("");
  expect(button.querySelector("svg")).not.toBeNull();
  button.click(); expect(toggle).toHaveBeenCalledWith(false);
});
