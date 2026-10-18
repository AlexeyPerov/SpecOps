import { beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";
import { appState } from "../state/appState";
import type { ContextId } from "../domain/contracts";
import ActivityRail from "./ActivityRail.svelte";
import { mountComponent } from "./_testComponentMount";
import { createSinglePaneLayout, type WorkspaceEntry } from "../domain/contracts";
import { _resetProjectCatalogForTests, catalogProjectForRoot, loadProjectCatalog, updateCatalogProject } from "../services/workspaceCatalog";
import { addWorkspaceToWindow } from "../services/addWorkspaceToWindow";
import { readLiveWorkspaceWindowOwners } from "../services/workspaceWindowPlacement";
import { invoke } from "@tauri-apps/api/core";
vi.mock("../state/chatStore", () => ({ chatSessionCountsByRoot: writable(new Map()) }));
vi.mock("../services/workspaceWindowPlacement", () => ({ readLiveWorkspaceWindowOwners: vi.fn().mockResolvedValue({}), WORKSPACE_PLACEMENT_CHANGED:"fixture:placement" }));
vi.mock("../services/addWorkspaceToWindow", () => ({ addWorkspaceToWindow: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../git/workspaceGitSummary", () => ({
  subscribeWorkspaceGitSummary: vi.fn((_path, listener) => {
    listener({ status: "unknown", refreshing: false, summary: null, checkedAt: null, error: null });
    return { setDemand: vi.fn(), unsubscribe: vi.fn(), refresh: vi.fn() };
  }),
  refreshWorkspaceGitSummaries: vi.fn(async () => {}),
}));
class TestIntersectionObserver { observe() {} disconnect() {} }
vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
function workspace(index: number, rootPath: string): WorkspaceEntry {
  return { id: `ws-${index}`, rootPath, snapshot: { documents: [], session: {
    editorLayout: createSinglePaneLayout([], null), lastActiveWindowId: "main", windowBounds: null, lastActiveSessionId: null,
  } } };
}
beforeEach(() => { _resetProjectCatalogForTests(); vi.mocked(invoke).mockReset(); localStorage.clear(); vi.mocked(readLiveWorkspaceWindowOwners).mockResolvedValue({}); vi.mocked(addWorkspaceToWindow).mockClear(); vi.mocked(invoke).mockResolvedValue({version:1, revision:1, projects:{}, folders:{}, savedContexts:{}}); });
describe("ActivityRail", () => {
  it.each([48, 240])('opens global document tabs from either rail width (%s)', async (width) => {
    const snapshot = appState.getSnapshot();
    let active: ContextId = 'ws-9';
    const read = vi.spyOn(appState, 'getSnapshot').mockImplementation(() => ({ ...snapshot, contexts: { ...snapshot.contexts, activeContextId: active } }));
    const open = vi.spyOn(appState, 'openOrFocusViewTab').mockImplementation(() => {});
    const select = vi.fn((id: ContextId) => { active = id; });
    try {
      const { host } = mountComponent(ActivityRail, { panelWidthPx: width, onSelectContext: select }); await tick();
      host.querySelector<HTMLButtonElement>('[aria-label="Global Tasks"]')!.click();
      expect(select).toHaveBeenCalledWith('notepad'); expect(open).toHaveBeenLastCalledWith('workspace-tasks');
      host.querySelector<HTMLButtonElement>('[aria-label="Global Notes"]')!.click();
      expect(open).toHaveBeenLastCalledWith('workspace-notes');
    } finally { read.mockRestore(); open.mockRestore(); }
  });
  it('does not open a document in the wrong scope if context switching is blocked', async () => {
    const snapshot = appState.getSnapshot();
    const read = vi.spyOn(appState, 'getSnapshot').mockReturnValue({ ...snapshot, contexts: { ...snapshot.contexts, activeContextId: 'ws-9' } });
    const open = vi.spyOn(appState, 'openOrFocusViewTab').mockImplementation(() => {});
    try {
      const { host } = mountComponent(ActivityRail, { onSelectContext: () => {} }); await tick();
      host.querySelector<HTMLButtonElement>('[aria-label="Global Tasks"]')!.click();
      expect(open).not.toHaveBeenCalled();
    } finally { read.mockRestore(); open.mockRestore(); }
  });
  it('temporarily reveals collapsed matches and restores collapse on Escape without Git or catalog writes', async () => {
    const project = { ...catalogProjectForRoot('/team/hidden-app'), folderId: 'team' };
    vi.mocked(invoke).mockResolvedValue({ version:1, revision:1, projects:{[project.id]:project}, folders:{team:{id:'team',name:'Team',order:0}}, savedContexts:{} });
    await loadProjectCatalog();
    localStorage.setItem('spec-ops:workspace-rail:main', JSON.stringify({ collapsed:['folder:team'], scrollTop:0 }));
    const { host } = mountComponent(ActivityRail, { panelWidthPx: 240 }); await tick();
    expect(host.querySelector('[data-workspace-id]')).toBeNull();
    vi.mocked(invoke).mockClear();
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search workspaces"]')!;
    input.value = 'hidden'; input.dispatchEvent(new Event('input', { bubbles:true })); await tick();
    expect(host.querySelector('[data-workspace-id]')).not.toBeNull();
    expect(host.querySelector('.rail-section-toggle')?.getAttribute('draggable')).toBe('false');
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await tick();
    expect(host.querySelector('[data-workspace-id]')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
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
    await tick();
    expect(document.querySelector('[role=menu]')?.textContent).toContain('Pin');
    [...document.querySelectorAll<HTMLButtonElement>('[role=menu] button')].find(button => button.textContent === 'Workspace actions…')!.click();
    expect(onRequestCloseWorkspace).toHaveBeenCalledWith("ws-1", 0, 0);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    expect(invoke).toHaveBeenCalledWith('project_catalog_transaction', { mutations: [{ type:'moveProject', id:'/one', folderId:null, pinned:false, beforeId:null }] });
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
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => rows[2] });
    rows[0].dispatchEvent(pointer("pointerdown", 20)); window.dispatchEvent(pointer("pointermove", 150));
    window.dispatchEvent(pointer("pointerup", 150));
    expect(invoke).toHaveBeenCalledWith('project_catalog_transaction', { mutations: [{ type:'moveProject', id:'/one', folderId:null, pinned:false, beforeId:null }] });
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
      "/one/app": { ...catalogProjectForRoot("/one/app"), color: "#65a3ff", icon: "★" },
    } });
    await updateCatalogProject("/one/app", { color: "#65a3ff", icon: "★" }); await tick();
    const row = host.querySelector<HTMLButtonElement>("[data-workspace-id]")!;
    expect(row.querySelector(".rail-workspace-avatar")?.textContent).toBe("★");
    expect(row.style.getPropertyValue("--project-color")).toBe("#65a3ff");
    expect(row.getAttribute("aria-label")).toContain("Workspace app");
  });
  async function groupedCatalog() {
    const projects = {
      '/pinned':{...catalogProjectForRoot('/pinned'),folderId:'one',pinned:true},
      '/normal':{...catalogProjectForRoot('/normal'),folderId:'one',order:1},
      '/hidden':{...catalogProjectForRoot('/hidden'),folderId:'one',pinned:true,hiddenFromRail:true},
      '/closed':catalogProjectForRoot('/closed'), '/other':catalogProjectForRoot('/other'),
    };
    const source={version:1,revision:1,folders:{one:{id:'one',name:'First folder',order:0},two:{id:'two',name:'Second folder',order:1}},projects,savedContexts:{}};
    vi.mocked(invoke).mockResolvedValue(source); await loadProjectCatalog(); return source;
  }
  it('renders pinned once, excludes hidden/other-window entries and opens closed projects without drop context', async () => {
    await groupedCatalog(); vi.mocked(readLiveWorkspaceWindowOwners).mockResolvedValue({'/other':'other'});
    const {host}=mountComponent(ActivityRail,{panelWidthPx:240,currentWindowId:'main'}); await tick(); await tick();
    const rows=[...host.querySelectorAll<HTMLButtonElement>('[data-workspace-id]')];
    expect(rows.map(row=>row.dataset.workspaceId)).toEqual(['/pinned','/normal','/closed']);
    expect(host.querySelector('[data-rail-section="pinned"]')?.getAttribute('aria-label')).toBe('Pinned, 1 projects');
    expect(host.querySelector('[data-rail-section="folder:one"]')?.getAttribute('aria-label')).toBe('First folder, 1 projects');
    const closed=rows.find(row=>row.dataset.workspaceId==='/closed')!;
    expect(closed.hasAttribute('data-file-drop-context')).toBe(false); closed.click();
    expect(addWorkspaceToWindow).toHaveBeenCalledWith('/closed');
  });
  it('restores collapse and scrolling for this window after remount while filtering reveals saved collapsed groups', async () => {
    await groupedCatalog();
    const first=mountComponent(ActivityRail,{panelWidthPx:240,currentWindowId:'main'}); await tick(); await tick();
    first.host.querySelector<HTMLButtonElement>('[data-rail-section="folder:one"] .rail-section-toggle')!.click(); await tick();
    expect(first.host.querySelector('[data-workspace-id="/normal"]')).toBeNull();
    const scroller=first.host.querySelector<HTMLElement>('.rail-workspaces')!; scroller.scrollTop=123; scroller.dispatchEvent(new Event('scroll')); first.unmount();
    const second=mountComponent(ActivityRail,{panelWidthPx:240,currentWindowId:'main'}); await tick(); await tick();
    expect(second.host.querySelector('[data-workspace-id="/normal"]')).toBeNull();
    expect(second.host.querySelector<HTMLElement>('.rail-workspaces')!.scrollTop).toBe(123); second.unmount();
    const filtered=mountComponent(ActivityRail,{panelWidthPx:240,currentWindowId:'main',searchQuery:'normal'}); await tick();
    expect(filtered.host.querySelector('[data-workspace-id="/normal"]')).not.toBeNull();
    expect(filtered.host.querySelector('[data-workspace-id="/pinned"]')).toBeNull(); filtered.unmount();
    const cleared=mountComponent(ActivityRail,{panelWidthPx:240,currentWindowId:'main'}); await tick();
    expect(cleared.host.querySelector('[data-workspace-id="/normal"]')).toBeNull();
  });
  it('exposes collapsed narrow projects through a keyboard menu and keeps folder assignment independent of pinning', async () => {
    await groupedCatalog(); localStorage.setItem('spec-ops:workspace-rail:main',JSON.stringify({collapsed:['folder:one'],scrollTop:0}));
    const {host}=mountComponent(ActivityRail,{panelWidthPx:48}); await tick();
    host.querySelector<HTMLButtonElement>('[data-rail-section="folder:one"] .rail-section-toggle')!.click(); await tick();
    const projectButton=[...document.querySelectorAll<HTMLButtonElement>('[role=menu] button')].find(button=>button.textContent==='normal')!;
    expect(projectButton).toBeTruthy();
    projectButton.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await tick();
    const row=host.querySelector<HTMLButtonElement>('[data-workspace-id="/pinned"]')!;
    row.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true})); await tick();
    [...document.querySelectorAll<HTMLButtonElement>('[role=menu] button')].find(button=>button.textContent==='Second folder')!.click();
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction',{mutations:[{type:'moveProject',id:'/pinned',folderId:'two'}]});
  });
  it('offers keyboard folder rename/delete/order and disables ambiguous ordering during search', async () => {
    await groupedCatalog();
    const {host}=mountComponent(ActivityRail,{panelWidthPx:240,searchQuery:'normal'}); await tick();
    const toggle=host.querySelector<HTMLButtonElement>('[data-rail-section="folder:one"] .rail-section-toggle')!;
    expect(toggle.draggable).toBe(false);
    toggle.dispatchEvent(new KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true})); await tick();
    const buttons=[...document.querySelectorAll<HTMLButtonElement>('[role=menu] button')];
    expect(buttons.find(button=>button.textContent==='Move folder down')!.disabled).toBe(true);
    buttons.find(button=>button.textContent==='Rename folder')!.click(); await tick();
    const input=host.querySelector<HTMLInputElement>('[aria-label="Folder name"]')!;
    input.value='Renamed'; input.dispatchEvent(new Event('input',{bubbles:true}));
    host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction',{mutations:[{type:'renameFolder',id:'one',name:'Renamed'}]});
    await tick(); toggle.dispatchEvent(new KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true})); await tick();
    [...document.querySelectorAll<HTMLButtonElement>('[role=menu] button')].find(button=>button.textContent==='Delete folder (keep projects)')!.click();
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction',{mutations:[{type:'removeFolder',id:'one'}]});
  });

  it('drops projects into pinned/empty folders and reorders folder headers with native drag', async () => {
    await groupedCatalog();
    const {host}=mountComponent(ActivityRail,{panelWidthPx:240}); await tick();
    const rect=(top:number,height=46)=>({left:0,right:240,top,bottom:top+height,width:240,height,x:0,y:top,toJSON:()=>({})});
    host.querySelector<HTMLElement>('.rail-workspaces')!.getBoundingClientRect=()=>rect(0,400);
    host.querySelector<HTMLElement>('.activity-rail')!.getBoundingClientRect=()=>rect(0,400);
    const pointer=(type:string,y:number)=>{const event=new MouseEvent(type,{clientX:20,clientY:y,button:0,bubbles:true});Object.defineProperty(event,'pointerId',{value:1});return event;};
    const drag=(source:string,target:string)=>{
      for (const row of host.querySelectorAll<HTMLElement>('[data-workspace-id]')) row.hasPointerCapture=()=>false;
      const row=host.querySelector<HTMLButtonElement>(`[data-workspace-id="${source}"]`)!;
      row.getBoundingClientRect=()=>rect(0); row.setPointerCapture=vi.fn(); row.hasPointerCapture=()=>false;
      const section=host.querySelector<HTMLElement>(`[data-rail-section="${target}"]`)!;
      Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>section});
      row.dispatchEvent(pointer('pointerdown',20));window.dispatchEvent(pointer('pointermove',130));window.dispatchEvent(pointer('pointerup',130));
    };
    drag('/normal','pinned');
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction',{mutations:[{type:'moveProject',id:'/normal',pinned:true,beforeId:null}]});
    await tick(); drag('/pinned','folder:two');
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction',{mutations:[{type:'moveProject',id:'/pinned',folderId:'two',pinned:false,beforeId:null}]});
    await tick();
    const first=host.querySelector<HTMLButtonElement>('[data-rail-section="folder:one"] .rail-section-toggle')!;
    const second=host.querySelector<HTMLButtonElement>('[data-rail-section="folder:two"] .rail-section-toggle')!;
    second.dispatchEvent(new MouseEvent('dragstart',{bubbles:true}));
    first.dispatchEvent(new MouseEvent('drop',{bubbles:true,clientY:0}));
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction',{mutations:[{type:'moveFolder',id:'two',beforeId:'one'}]});
  });

});
