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
