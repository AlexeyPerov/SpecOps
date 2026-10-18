import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import WorkspaceManagerView from "./WorkspaceManagerView.svelte";
import type { ContextId, WorkspaceEntry } from "../domain/contracts";
import { subscribeWorkspaceGitSummary } from "../git/workspaceGitSummary";

vi.mock("../git/gitIntegrationGating", () => ({ shouldLoadWorkspaceManagerGitColumn: vi.fn(() => true) }));
vi.mock("../git/workspaceGitSummary", () => ({
  subscribeWorkspaceGitSummary: vi.fn((_path, listener) => {
    listener({status:"notGit",refreshing:false,summary:null,checkedAt:null,error:null});
    return {setDemand:vi.fn(),unsubscribe:vi.fn(),refresh:vi.fn()};
  }),
  refreshWorkspaceGitSummaries:vi.fn(async()=>{}),
}));
class TestIntersectionObserver {
  observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
}
vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../services/addWorkspaceToWindow', () => ({ addWorkspaceToWindow: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
import { _resetProjectCatalogForTests, catalogProjectForRoot } from '../services/workspaceCatalog';
beforeEach(() => {
  _resetProjectCatalogForTests();
  vi.mocked(invoke).mockResolvedValue({ version: 1, revision: 1, projects: {}, folders: {}, savedContexts: {} });
});

function makeWorkspace(id: ContextId, rootPath: string): WorkspaceEntry {
  return { id, rootPath, label: id } as unknown as WorkspaceEntry;
}

describe("WorkspaceManagerView", () => {
  it("mounts without an infinite effect loop and renders rows + header buttons", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const workspaces = [
      makeWorkspace("ws-1", "/users/alexeyperov/documents/notes"),
      makeWorkspace("ws-2", "/users/alexeyperov/projects/unity-ai-hub"),
    ];

    let instance: Record<string, unknown> | undefined;
    expect(() => {
      instance = mount(WorkspaceManagerView, {
        target: host,
        props: {
          workspaces,
          activeContextId: "ws-1",
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

    const workspaces = [makeWorkspace("ws-1", "/users/alexeyperov/documents/notes")];
    const onOpenWorkspaceSettings = vi.fn();

    const instance = mount(WorkspaceManagerView, {
      target: host,
      props: {
        workspaces,
        activeContextId: "ws-1",
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
    expect(onOpenWorkspaceSettings).toHaveBeenCalledWith("ws-1");

    unmount(instance as never);
    host.remove();
  });

  it("version control button click fires onOpenVersionControl", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const workspaces = [makeWorkspace("ws-1", "/users/alexeyperov/documents/notes")];
    const onOpenVersionControl = vi.fn();

    const instance = mount(WorkspaceManagerView, {
      target: host,
      props: {
        workspaces,
        activeContextId: "ws-1",
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
    expect(onOpenVersionControl).toHaveBeenCalledWith("ws-1");

    unmount(instance as never);
    host.remove();
  });

  it("writes Git error cells when a git-column load rejects", async () => {
    vi.mocked(subscribeWorkspaceGitSummary).mockImplementationOnce((_path, listener) => {
      listener({status:"error",refreshing:false,summary:null,checkedAt:null,error:"boom"});
      return {setDemand:vi.fn(),unsubscribe:vi.fn(),refresh:vi.fn()};
    });

    const host = document.createElement("div");
    document.body.appendChild(host);

    const workspaces = [makeWorkspace("ws-1", "/tmp/repo-a")];
    const instance = mount(WorkspaceManagerView, {
      target: host,
      props: {
        workspaces,
        activeContextId: "ws-1",
        hiddenRootPaths: new Set<string>(),
        onAddWorkspace: () => {},
        onAddMultiple: () => {},
        onSelectWorkspace: () => {},
        onOpenWorkspaceSettings: () => {},
        onOpenVersionControl: () => {},
      },
    }) as unknown as Record<string, unknown>;

    await new Promise((resolve) => setTimeout(resolve, 30));

    const gitCell = host.querySelector(".wm-git-text");
    expect(gitCell?.textContent?.trim()).toBe("Git error");
    expect(gitCell?.getAttribute("title")).toContain("boom");

    unmount(instance as never);
    host.remove();
  });
  it('keeps closed and unavailable catalog projects visible and opens them by root', async () => {
    const project = { ...catalogProjectForRoot('/tmp/closed'), openError: 'Directory missing' };
    vi.mocked(invoke).mockResolvedValue({ version: 1, revision: 2,
      projects: { [project.id]: project }, folders: {}, savedContexts: {} });
    vi.mocked(addWorkspaceToWindow).mockRejectedValueOnce(new Error('Directory missing'));
    const host = document.createElement('div'); document.body.appendChild(host);
    const onSelectWorkspace = vi.fn();
    const instance = mount(WorkspaceManagerView, { target: host, props: { onSelectWorkspace } });
    await vi.waitFor(() => expect(host.textContent).toContain('/tmp/closed'));
    expect(host.textContent).toContain('Directory missing');
    host.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Directory missing'));
    expect(addWorkspaceToWindow).toHaveBeenCalledWith('/tmp/closed');
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    await unmount(instance); host.remove();
  });

});
