import { beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";
import ActivityRail from "./ActivityRail.svelte";
import { mountComponent } from "./_testComponentMount";
import { createSinglePaneLayout, type WorkspaceEntry } from "../domain/contracts";
import { _resetProjectCatalogForTests, updateCatalogProject } from "../services/workspaceCatalog";
import { invoke } from "@tauri-apps/api/core";
vi.mock("../state/chatStore", () => ({ chatSessionCountsByRoot: writable(new Map()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
function workspace(index: number, rootPath: string): WorkspaceEntry {
  return { id: `ws-${index}`, rootPath, snapshot: { documents: [], session: {
    editorLayout: createSinglePaneLayout([], null), lastActiveWindowId: "main", windowBounds: null, lastActiveSessionId: null,
  } } };
}
beforeEach(() => { _resetProjectCatalogForTests(); vi.mocked(invoke).mockReset(); });
describe("ActivityRail", () => {
  it("renders 30 expanded rows with distinct names, drop targets and no Git reads", async () => {
    const workspaces = Array.from({ length: 30 }, (_, i) => workspace(i, `/projects/group-${i}/app`));
    const { host } = mountComponent(ActivityRail, { workspaces, panelWidthPx: 240, sessionsEnabled: true });
    await tick();
    const rows = host.querySelectorAll<HTMLButtonElement>("[data-workspace-id]");
    expect(rows).toHaveLength(30);
    expect(host.querySelectorAll(".rail-workspace-distinction")).toHaveLength(30);
    expect(rows[0].textContent).toContain("group-0");
    expect(rows[0].textContent).toContain("Git not checked");
    expect(rows[0].textContent).not.toMatch(/Sessions:|Tabs:/);
    expect(rows[0].dataset.fileDropContext).toBe("ws-0");
    expect(rows[0].getAttribute("aria-label")).toContain("/projects/group-0/app");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("supports native keyboard activation, keyboard context menu and reorder with several projects", async () => {
    const onSelectContext = vi.fn(), onRequestCloseWorkspace = vi.fn(), onReorderWorkspaces = vi.fn();
    const { host } = mountComponent(ActivityRail, { workspaces: [workspace(1, "/one"), workspace(2, "/two")], panelWidthPx: 240,
      onSelectContext, onRequestCloseWorkspace, onReorderWorkspaces, activeContextId: "ws-1" as const });
    await tick();
    const row = host.querySelector<HTMLButtonElement>("[data-workspace-id]")!;
    row.focus(); row.click();
    expect(document.activeElement).toBe(row);
    expect(onSelectContext).toHaveBeenCalledExactlyOnceWith("ws-1");
    expect(row.getAttribute("aria-current")).toBe("true");
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
    expect(onRequestCloseWorkspace).toHaveBeenCalledWith("ws-1", 0, 0);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    expect(onReorderWorkspaces).toHaveBeenCalledWith(0, 1);
  });
  it("keeps pointer selection and drag reorder without a duplicate click activation", async () => {
    const onSelectContext = vi.fn(), onReorderWorkspaces = vi.fn();
    const { host } = mountComponent(ActivityRail, { workspaces: [workspace(1, "/one"), workspace(2, "/two"), workspace(3, "/three")],
      panelWidthPx: 240, onSelectContext, onReorderWorkspaces });
    await tick();
    const rows = [...host.querySelectorAll<HTMLButtonElement>("[data-workspace-id]")];
    const rect = (top: number, height = 46) => ({ left: 0, right: 240, top, bottom: top + height, width: 240, height, x: 0, y: top, toJSON: () => ({}) });
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => rect(i * 48);
      row.setPointerCapture = vi.fn(); row.hasPointerCapture = () => false;
    });
    host.querySelector<HTMLElement>(".rail-workspaces")!.getBoundingClientRect = () => rect(0, 200);
    host.querySelector<HTMLElement>(".activity-rail")!.getBoundingClientRect = () => rect(0, 200);
    const pointer = (type: string, y: number) => {
      const event = new MouseEvent(type, { clientX: 20, clientY: y, button: 0, bubbles: true });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    rows[0].dispatchEvent(pointer("pointerdown", 20)); window.dispatchEvent(pointer("pointerup", 20));
    rows[0].dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    expect(onSelectContext).toHaveBeenCalledExactlyOnceWith("ws-1");
    rows[0].dispatchEvent(pointer("pointerdown", 20)); window.dispatchEvent(pointer("pointermove", 130));
    window.dispatchEvent(pointer("pointerup", 130));
    expect(onReorderWorkspaces).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(onSelectContext).toHaveBeenCalledTimes(1);
  });
  it("keeps compact textual accessible names and keyboard resizing", async () => {
    const onPanelWidthChange = vi.fn();
    const { host } = mountComponent(ActivityRail, { workspaces: [workspace(1, "/one/app")], panelWidthPx: 48, onPanelWidthChange });
    await tick();
    const row = host.querySelector<HTMLButtonElement>("[data-workspace-id]")!;
    expect(row.classList.contains("rail-button-workspace")).toBe(true);
    expect(row.getAttribute("aria-label")).toContain("Workspace app, /one/app");
    const separator = host.querySelector<HTMLElement>("[role=slider]")!;
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await tick();
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(520);
    expect(separator.getAttribute("aria-valuenow")).toBe("520");
    expect(host.querySelector(".rail-workspace-row")).not.toBeNull();
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await tick();
    expect(onPanelWidthChange).toHaveBeenLastCalledWith(48);
  });
  it("updates catalog appearance while preserving textual project identity", async () => {
    const { host } = mountComponent(ActivityRail, { workspaces: [workspace(1, "/one/app")], panelWidthPx: 240 });
    await tick();
    vi.mocked(invoke).mockResolvedValue({ version: 1, revision: 1, folders: {}, savedContexts: {}, projects: {
      "/one/app": { id: "/one/app", rootPath: "/one/app", name: "app", color: "#65a3ff", icon: "★" },
    } });
    await updateCatalogProject("/one/app", { color: "#65a3ff", icon: "★" }); await tick();
    const row = host.querySelector<HTMLButtonElement>("[data-workspace-id]")!;
    expect(row.querySelector(".rail-workspace-avatar")?.textContent).toBe("★");
    expect(row.style.getPropertyValue("--project-color")).toBe("#65a3ff");
    expect(row.getAttribute("aria-label")).toContain("Workspace app");
  });
});
