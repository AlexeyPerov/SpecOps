import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import WorkspaceManagerView from "./WorkspaceManagerView.svelte";
import type { WorkspaceEntry } from "../domain/contracts";

// Mock the git column loader so the test never hits Tauri IPC. The view's mount
// `$effect` calls `loadGitCellsForWorkspaces`, which reads/writes `gitCellsByPath`;
// if those reads are tracked, the effect loops (effect_update_depth_exceeded).
vi.mock("../git/gitIntegrationGating", () => ({
  shouldLoadWorkspaceManagerGitColumn: vi.fn(() => true),
}));

vi.mock("../git/workspaceManagerGitColumn", () => ({
  loadWorkspaceGitColumnCell: vi.fn(async () => ({ status: "neutral", text: "—" })),
  refreshWorkspaceGitColumnCells: vi.fn(async () => new Map()),
  subscribeWorkspaceGitColumnAutoRefresh: vi.fn(() => () => {}),
}));

function makeWorkspace(id: string, rootPath: string): WorkspaceEntry {
  return { id, rootPath, label: id } as WorkspaceEntry;
}

describe("WorkspaceManagerView", () => {
  it("mounts without an infinite effect loop and renders rows + header buttons", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const workspaces = [
      makeWorkspace("ws-notes", "/users/alexeyperov/documents/notes"),
      makeWorkspace("ws-unity", "/users/alexeyperov/projects/unity-ai-hub"),
    ];

    let instance: Record<string, unknown> | undefined;
    expect(() => {
      instance = mount(WorkspaceManagerView, {
        target: host,
        props: {
          workspaces,
          activeContextId: "ws-notes",
          hiddenRootPaths: new Set<string>(),
          onAddWorkspace: () => {},
          onAddMultiple: () => {},
          onSelectWorkspace: () => {},
          onOpenWorkspaceSettings: () => {},
          onOpenVersionControl: () => {},
        },
      }) as unknown as Record<string, unknown>;
    }).not.toThrow();

    // Header buttons should be present and clickable.
    const buttons = host.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);

    const addBtn = Array.from(buttons).find((b) => b.textContent?.includes("Add workspace"));
    expect(addBtn).toBeTruthy();

    if (instance) {
      unmount(instance as never);
    }
    host.remove();
  });

  it("settings button click fires onOpenWorkspaceSettings", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const workspaces = [makeWorkspace("ws-notes", "/users/alexeyperov/documents/notes")];
    const onOpenWorkspaceSettings = vi.fn();

    const instance = mount(WorkspaceManagerView, {
      target: host,
      props: {
        workspaces,
        activeContextId: "ws-notes",
        hiddenRootPaths: new Set<string>(),
        onAddWorkspace: () => {},
        onAddMultiple: () => {},
        onSelectWorkspace: () => {},
        onOpenWorkspaceSettings,
        onOpenVersionControl: () => {},
      },
    }) as unknown as Record<string, unknown>;

    // Let the git-cell load effect flush.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const settingsBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Settings"),
    );
    expect(settingsBtn).toBeTruthy();
    settingsBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onOpenWorkspaceSettings).toHaveBeenCalledWith("ws-notes");

    unmount(instance as never);
    host.remove();
  });

  it("version control button click fires onOpenVersionControl", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const workspaces = [makeWorkspace("ws-notes", "/users/alexeyperov/documents/notes")];
    const onOpenVersionControl = vi.fn();

    const instance = mount(WorkspaceManagerView, {
      target: host,
      props: {
        workspaces,
        activeContextId: "ws-notes",
        hiddenRootPaths: new Set<string>(),
        onAddWorkspace: () => {},
        onAddMultiple: () => {},
        onSelectWorkspace: () => {},
        onOpenWorkspaceSettings: () => {},
        onOpenVersionControl,
      },
    }) as unknown as Record<string, unknown>;

    await new Promise((resolve) => setTimeout(resolve, 10));

    const versionControlBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Version Control"),
    );
    expect(versionControlBtn).toBeTruthy();
    versionControlBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onOpenVersionControl).toHaveBeenCalledWith("ws-notes");

    unmount(instance as never);
    host.remove();
  });
});
