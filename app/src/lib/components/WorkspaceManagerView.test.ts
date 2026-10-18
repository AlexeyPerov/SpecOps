import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, unmount, tick } from "svelte";
import WorkspaceManagerView from "./WorkspaceManagerView.svelte";
import type { ContextId, WorkspaceEntry } from "../domain/contracts";
import { refreshWorkspaceGitSummaries, subscribeWorkspaceGitSummary } from "../git/workspaceGitSummary";

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

  it('explicit refresh uses only the filtered roots in the shared queue without selecting a project', async () => {
    vi.mocked(invoke).mockResolvedValue({version:1,revision:2,projects:{
      '/alpha':catalogProjectForRoot('/alpha'),'/beta':catalogProjectForRoot('/beta'),
    },folders:{},savedContexts:{}});
    const host=document.createElement('div');document.body.appendChild(host);const onSelectWorkspace=vi.fn();
    const instance=mount(WorkspaceManagerView,{target:host,props:{onSelectWorkspace}});
    await vi.waitFor(()=>expect(host.querySelectorAll('tbody tr')).toHaveLength(2));
    const search=host.querySelector<HTMLInputElement>('.wm-search')!;search.value='alpha';search.dispatchEvent(new Event('input',{bubbles:true}));await tick();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Refresh git')!.click();await tick();
    expect(refreshWorkspaceGitSummaries).toHaveBeenLastCalledWith(['/alpha']);expect(onSelectWorkspace).not.toHaveBeenCalled();
    await unmount(instance);host.remove();
  });

  it('checkbox and modifier selection do not activate projects and batch actions are semantic', async () => {
    vi.mocked(invoke).mockClear(); vi.mocked(addWorkspaceToWindow).mockClear();
    vi.mocked(invoke).mockResolvedValue({version:1,revision:3,projects:{'/alpha':catalogProjectForRoot('/alpha'),'/beta':catalogProjectForRoot('/beta')},folders:{},savedContexts:{}});
    const host=document.createElement('div'); document.body.appendChild(host); const onSelectWorkspace=vi.fn();
    const instance=mount(WorkspaceManagerView,{target:host,props:{onSelectWorkspace}});
    await vi.waitFor(()=>expect(host.querySelectorAll('tbody tr')).toHaveLength(2));
    host.querySelector<HTMLInputElement>('input[aria-label="Select alpha"]')!.click(); await tick();
    host.querySelectorAll('tbody tr')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})); await tick();
    expect(host.textContent).toContain('2 selected');
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Hide from sidebar')!.click();
    await vi.waitFor(()=>expect(host.textContent).toContain('2 project(s) updated; 0 failed.'));
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction',{mutations:[{type:'updateProject',id:'/alpha',patch:{hiddenFromRail:true}},{type:'updateProject',id:'/beta',patch:{hiddenFromRail:true}}]});
    expect(addWorkspaceToWindow).not.toHaveBeenCalled(); expect(onSelectWorkspace).not.toHaveBeenCalled();
    await unmount(instance);host.remove();
  });
  it('filters closed and local contexts independently of hidden catalog entries', async () => {
    vi.mocked(invoke).mockResolvedValue({version:1,revision:4,projects:{'/alpha':catalogProjectForRoot('/alpha'),'/beta':{...catalogProjectForRoot('/beta'),hiddenFromRail:true}},folders:{},savedContexts:{}});
    const host=document.createElement('div');document.body.appendChild(host);
    const instance=mount(WorkspaceManagerView,{target:host,props:{workspaces:[makeWorkspace('ws-1','/alpha')]}});
    await vi.waitFor(()=>expect(host.querySelectorAll('tbody tr')).toHaveLength(2));
    const scope=host.querySelector<HTMLSelectElement>('select[aria-label="Project scope"]')!;
    scope.value='closed';scope.dispatchEvent(new Event('change',{bubbles:true}));await tick();
    expect(host.querySelector('tbody')?.textContent).toContain('beta');expect(host.querySelector('tbody')?.textContent).not.toContain('alpha');
    scope.value='here';scope.dispatchEvent(new Event('change',{bubbles:true}));await tick();
    expect(host.querySelector('tbody')?.textContent).toContain('alpha');expect(host.querySelector('tbody')?.textContent).not.toContain('beta');
    await unmount(instance);host.remove();
  });

});
