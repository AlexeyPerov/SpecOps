import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import ActivityRail from './ActivityRail.svelte';
import { mountComponent } from './_testComponentMount';
import { appState } from '../state/appState';
import { createSinglePaneLayout, type WorkspaceEntry } from '../domain/contracts';
import type { ProjectCatalog } from '../domain/projectCatalog';
import { _resetProjectCatalogForTests, catalogProjectForRoot, getProjectCatalog, loadProjectCatalog, type CatalogMutation } from '../services/workspaceCatalog';
import { readLiveWorkspaceWindowOwners } from '../services/workspaceWindowPlacement';
import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
import { openFolderDialog } from '../services/fileSystem';
import { tabGroupRailKey } from '../services/unifiedRail';
vi.mock('../state/chatStore', () => ({ chatSessionCountsByRoot: writable(new Map()) }));
vi.mock('../services/workspaceWindowPlacement', () => ({ readLiveWorkspaceWindowOwners: vi.fn(async () => ({})), WORKSPACE_PLACEMENT_CHANGED: 'test:placement' }));
vi.mock('../services/addWorkspaceToWindow', () => ({ addWorkspaceToWindow: vi.fn(async () => null) }));
vi.mock('../services/fileSystem', () => ({ openFolderDialog: vi.fn(async () => null) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../git/workspaceGitSummary', () => ({
  subscribeWorkspaceGitSummary: vi.fn((_path, listener) => {
    listener({ status: 'unknown', refreshing: false, summary: null, checkedAt: null, error: null });
    return { setDemand: vi.fn(), unsubscribe: vi.fn(), refresh: vi.fn() };
  }), refreshWorkspaceGitSummaries: vi.fn(async () => {}),
}));
class Observer { observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', Observer);
const workspace = (id: number, rootPath: string): WorkspaceEntry => ({ id: `ws-${id}`, rootPath, snapshot: { documents: [], session: {
  editorLayout: createSinglePaneLayout([], null), lastActiveWindowId: 'main', windowBounds: null,
} } });
const groups = [
  { id: 'tabs-default' as const, name: 'Tabs', tabCount: 2, recentTabs: [{ tabId: 'file-1', label: 'notes/a.md' }] },
  { id: 'tabs-2' as const, name: 'Drafts', tabCount: 1, recentTabs: [] },
];
let source: ProjectCatalog;
beforeEach(() => {
  _resetProjectCatalogForTests(); localStorage.clear(); vi.clearAllMocks();
  vi.mocked(readLiveWorkspaceWindowOwners).mockResolvedValue({});
  source = { version: 1, revision: 0, projects: {}, folders: {}, savedContexts: {}, documents: {}, railItems: {} };
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const next = structuredClone(source);
    for (const mutation of (args as { mutations: CatalogMutation[] }).mutations) {
      if (mutation.type === 'register') next.projects[mutation.project.id] ??= mutation.project;
      if (mutation.type === 'putDocument') next.documents[mutation.document.id] = mutation.document;
      if (mutation.type === 'renameDocument') next.documents[mutation.id].name = mutation.name;
      if (mutation.type === 'putFolder') next.folders[mutation.folder.id] = mutation.folder;
      if (mutation.type === 'renameFolder') next.folders[mutation.id].name = mutation.name;
      if (mutation.type === 'moveProject') Object.assign(next.projects[mutation.id], { ...(mutation.folderId !== undefined ? { folderId: mutation.folderId } : {}), ...(mutation.pinned !== undefined ? { pinned: mutation.pinned } : {}) });
      if (mutation.type === 'organizeRailItem') {
        next.railItems![mutation.id] = mutation.placement;
        if (mutation.projectId) Object.assign(next.projects[mutation.projectId], mutation.placement);
      }
    }
    next.revision++; source = structuredClone(next); return next;
  });
});
async function seed(): Promise<void> {
  source.projects = { '/app': { ...catalogProjectForRoot('/app'), order: 0 } };
  source.folders = { team: { id: 'team', name: 'Team', order: 0 } };
  source.documents = { plan: { id: 'plan', kind: 'tasks', name: 'Plan', order: 0 }, ideas: { id: 'ideas', kind: 'notes', name: 'Ideas', order: 0 } };
  await loadProjectCatalog();
}
const button = (label: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
async function context(row: Element): Promise<void> {
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 })); await tick();
}
async function search(host: HTMLElement, query: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('.rail-search')!;
  input.value = query; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
}
async function submitName(host: HTMLElement, selector: string, name: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  input.value = name; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
}
function rect(top: number, height = 40, width = 240): DOMRect {
  return { left: 0, right: width, top, bottom: top + height, width, height, x: 0, y: top, toJSON: () => ({}) };
}
function pointer(type: string, y: number): MouseEvent {
  const event = new MouseEvent(type, { clientX: 20, clientY: y, button: 0, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 1 }); return event;
}
function prepareDrag(host: HTMLElement, row: HTMLElement): void {
  host.querySelector<HTMLElement>('.rail-workspaces')!.getBoundingClientRect = () => rect(0, 400);
  host.querySelector<HTMLElement>('.activity-rail')!.getBoundingClientRect = () => rect(0, 400);
  row.getBoundingClientRect = () => rect(0);
  row.setPointerCapture = vi.fn(); row.hasPointerCapture = () => false;
}
describe('unified activity rail', () => {
  it.each([48, 240])('renders all types in one list with no category headings at width %s', async width => {
    await seed();
    const { host } = mountComponent(ActivityRail, { panelWidthPx: width, tabGroups: groups }); await tick();
    expect(host.querySelectorAll('[data-rail-item-id]')).toHaveLength(6);
    expect(host.querySelector('.rail-entity-heading')).toBeNull();
    expect(host.querySelector('[data-rail-section="pinned"]')).toBeNull();
    expect(host.querySelector('[data-rail-section="unfiled"]')).toBeNull();
    expect(host.querySelectorAll('[data-global-document-id]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-tab-group-drop]')).toHaveLength(2);
    expect(host.querySelectorAll('.rail-button-add')).toHaveLength(1);
  });
  it.each(['workspace', 'tabGroup', 'tasks', 'notes'] as const)('moves %s into a folder, pins once, restores its place on unpin and reload', async kind => {
    await seed();
    const { host, unmount } = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups }); await tick();
    const selector = kind === 'workspace' ? '[data-workspace-id="/app"]' : kind === 'tabGroup' ? '[data-tab-group-id="tabs-2"]' : `[data-global-document-id="${kind === 'tasks' ? 'plan' : 'ideas'}"]`;
    await context(host.querySelector(selector)!); button('Move to Team').click(); await tick(); await tick();
    expect(host.querySelector('[data-rail-section="folder:team"]')!.contains(host.querySelector(selector))).toBe(true);
    const row = host.querySelector<HTMLElement>(selector)!; const key = row.dataset.railItemId!;
    const initial = kind === 'workspace' ? getProjectCatalog().projects['/app'].order : getProjectCatalog().railItems![key].order;
    await context(row); button('Pin').click(); await tick(); await tick();
    expect(host.querySelectorAll(selector)).toHaveLength(1);
    expect(host.querySelector('[data-rail-zone="pinned"]')!.contains(host.querySelector(selector))).toBe(true);
    await context(host.querySelector(selector)!); button('Unpin').click(); await tick(); await tick();
    const placement = kind === 'workspace' ? getProjectCatalog().projects['/app'] : getProjectCatalog().railItems![key];
    expect(placement).toMatchObject({ folderId: 'team', pinned: false, order: initial });
    unmount(); const reloaded = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups }); await tick();
    expect(reloaded.host.querySelector('[data-rail-section="folder:team"]')!.contains(reloaded.host.querySelector(selector))).toBe(true);
  });
  it('searches every type and paths, reveals collapsed matches, then restores collapse without writes', async () => {
    await seed();
    source.railItems!['document:plan'] = { folderId: 'team', pinned: false, order: 1, pinnedOrder: 0 };
    await loadProjectCatalog();
    localStorage.setItem('spec-ops:workspace-rail:main', JSON.stringify({ collapsed: ['folder:team'], scrollTop: 0 }));
    const { host } = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups }); await tick();
    expect(host.querySelector('[data-global-document-id="plan"]')).toBeNull(); vi.mocked(invoke).mockClear();
    await search(host, 'plan'); expect(host.querySelector('[data-global-document-id="plan"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-tab-group-id]')).toHaveLength(0);
    await search(host, 'draft'); expect(host.querySelector('[data-tab-group-id="tabs-2"]')).not.toBeNull();
    host.querySelector('.rail-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(host.querySelector('[data-tab-group-id="tabs-2"]'));
    await search(host, 'ideas'); expect(host.querySelector('[data-global-document-id="ideas"]')).not.toBeNull();
    await search(host, '/app'); expect(host.querySelector('[data-workspace-id="/app"]')).not.toBeNull();
    await search(host, 'missing'); expect(host.querySelector('[role=status]')?.textContent).toBe('No matching items');
    host.querySelector('.rail-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
    expect(host.querySelector('[data-global-document-id="plan"]')).toBeNull(); expect(invoke).not.toHaveBeenCalled();
  });
  it('reorders mixed types with keyboard and retains the order after remount', async () => {
    await seed();
    const { host, unmount } = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups.slice(0, 1) }); await tick();
    host.querySelector('[data-global-document-id="plan"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })); await tick(); await tick();
    const keys = () => [...host.querySelectorAll<HTMLElement>('[data-rail-item-id]')].map(row => row.dataset.railItemId);
    expect(keys().slice(0, 2)).toEqual(['document:plan', tabGroupRailKey('main', 'tabs-default')]);
    unmount(); const next = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups.slice(0, 1) }); await tick();
    expect(next.host.querySelector<HTMLElement>('[data-rail-item-id]')!.dataset.railItemId).toBe('document:plan');
  });
  it.each([48, 240])('drags a document into an empty collapsed folder and back into the root at width %s', async width => {
    await seed(); localStorage.setItem('spec-ops:workspace-rail:main', JSON.stringify({ collapsed: ['folder:team'], scrollTop: 0 }));
    const { host } = mountComponent(ActivityRail, { panelWidthPx: width, tabGroups: groups }); await tick();
    const row = host.querySelector<HTMLElement>('[data-global-document-id="plan"]')!; prepareDrag(host, row);
    const folder = host.querySelector<HTMLElement>('[data-rail-section="folder:team"]')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => folder });
    row.dispatchEvent(pointer('pointerdown', 20)); window.dispatchEvent(pointer('pointermove', 130)); await tick();
    expect(host.querySelector('[data-global-document-id="plan"]')).toBe(row);
    window.dispatchEvent(pointer('pointerup', 130)); await tick(); await tick();
    expect(getProjectCatalog().railItems!['document:plan']).toMatchObject({ folderId: 'team', pinned: false });
    await vi.waitFor(() => expect(folder.querySelector('.rail-section-toggle')?.getAttribute('aria-expanded')).toBe('true'));
    const moved = host.querySelector<HTMLElement>('[data-global-document-id="plan"]')!; prepareDrag(host, moved);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => host.querySelector('[data-rail-zone="root"]') });
    moved.dispatchEvent(pointer('pointerdown', 20)); window.dispatchEvent(pointer('pointermove', 200)); window.dispatchEvent(pointer('pointerup', 200)); await tick(); await tick();
    expect(getProjectCatalog().railItems!['document:plan'].folderId).toBeNull();
  });
  it('selects a workspace once on pointer click and navigates between different types with arrow keys', async () => {
    await seed(); const select = vi.fn();
    const { host } = mountComponent(ActivityRail, { workspaces: [workspace(1, '/app')], panelWidthPx: 240, tabGroups: groups, onSelectContext: select }); await tick();
    const row = host.querySelector<HTMLElement>('[data-workspace-id]')!; prepareDrag(host, row);
    row.dispatchEvent(pointer('pointerdown', 20)); window.dispatchEvent(pointer('pointerup', 20)); row.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    expect(select).toHaveBeenCalledExactlyOnceWith('ws-1');
    const first = host.querySelector<HTMLElement>('[data-tab-group-id]')!; first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(host.querySelector('[data-tab-group-id="tabs-2"]'));
  });
  it('opens documents in the target group, preserves recent-tab actions and protects the default group', async () => {
    await seed();
    const target = vi.spyOn(appState, 'getTargetTabGroupId').mockReturnValue('tabs-default');
    const switchContext = vi.spyOn(appState, 'switchContext').mockReturnValue(true);
    const open = vi.spyOn(appState, 'openOrFocusViewTab').mockImplementation(() => {}); const selectTab = vi.fn();
    try {
      const { host } = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups, onSelectTabGroupTab: selectTab }); await tick();
      host.querySelector<HTMLButtonElement>('[data-global-document-id="plan"]')!.click();
      expect(open).toHaveBeenLastCalledWith('workspace-tasks', undefined, 'plan');
      host.querySelector<HTMLButtonElement>('[data-global-document-id="ideas"]')!.click();
      expect(open).toHaveBeenLastCalledWith('workspace-notes', undefined, 'ideas');
      host.querySelector<HTMLElement>('.rail-tab-group-tab')!.click(); expect(selectTab).toHaveBeenCalledWith('tabs-default', 'file-1');
      await context(host.querySelector('[data-tab-group-id]')!); expect(button('Delete').disabled).toBe(true);
    } finally { target.mockRestore(); switchContext.mockRestore(); open.mockRestore(); }
  });
  it('opens the creation grid, traps focus, dismisses with Escape, and delegates workspace creation', async () => {
    const add = vi.fn(); const { host } = mountComponent(ActivityRail, { panelWidthPx: 240, onAddWorkspace: add }); await tick();
    const plus = host.querySelector<HTMLButtonElement>('[aria-label="Create…"]')!; plus.click(); await tick(); await tick();
    const popup = document.querySelector<HTMLElement>('[role=dialog]')!;
    const options = [...popup.querySelectorAll<HTMLButtonElement>('button')]; expect(options).toHaveLength(5);
    expect(document.activeElement).toBe(options[0]);
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); expect(document.activeElement).toBe(options[4]);
    popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(); await tick();
    expect(document.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(plus);
    plus.click(); await tick(); document.querySelector<HTMLButtonElement>('.rail-create-grid button')!.click(); expect(add).toHaveBeenCalledOnce();
  });
  it('creates and renames a tab group through the grid and name form', async () => {
    const create = vi.spyOn(appState, 'createTabGroup').mockReturnValue('tabs-3');
    const rename = vi.spyOn(appState, 'renameTabGroup').mockReturnValue(true);
    try {
      const { host } = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups }); await tick();
      host.querySelector<HTMLButtonElement>('[aria-label="Create…"]')!.click(); await tick();
      [...document.querySelectorAll<HTMLButtonElement>('.rail-create-grid button')].find(row => row.textContent?.includes('Tab group'))!.click(); await tick();
      await submitName(host, '.rail-entity-form input', 'Review'); expect(create).toHaveBeenCalledWith('Review');
      await context(host.querySelector('[data-tab-group-id="tabs-2"]')!); button('Rename').click(); await tick();
      await submitName(host, '.rail-entity-form input', 'Archive'); expect(rename).toHaveBeenCalledWith('tabs-2', 'Archive');
    } finally { create.mockRestore(); rename.mockRestore(); }
  });
  it('creates a document inside a folder and offers no nested-folder option', async () => {
    await seed(); localStorage.setItem('spec-ops:workspace-rail:main', JSON.stringify({ collapsed: ['folder:team'], scrollTop: 0 }));
    const { host } = mountComponent(ActivityRail, { panelWidthPx: 240 }); await tick();
    await context(host.querySelector('.rail-section-toggle')!); button('Create in folder…').click(); await tick();
    const options = [...document.querySelectorAll<HTMLButtonElement>('.rail-create-grid button')]; expect(options).toHaveLength(4);
    options.find(row => row.textContent?.startsWith('Notes'))!.click(); await tick();
    await submitName(host, '.rail-entity-form input', 'Research');
    await vi.waitFor(() => expect(Object.values(getProjectCatalog().documents).some(document => document.name === 'Research')).toBe(true)); await tick();
    const created = Object.values(getProjectCatalog().documents).find(document => document.name === 'Research')!;
    await vi.waitFor(() => expect(getProjectCatalog().railItems![`document:${created.id}`]?.folderId).toBe('team'));
    await vi.waitFor(() => expect(host.querySelector('.rail-section-toggle')?.getAttribute('aria-expanded')).toBe('true'));
  });
  it('creates a workspace inside the selected folder through the directory picker', async () => {
    await seed(); vi.mocked(openFolderDialog).mockResolvedValueOnce('/app');
    const { host } = mountComponent(ActivityRail, { panelWidthPx: 240 }); await tick();
    await context(host.querySelector('.rail-section-toggle')!); button('Create in folder…').click(); await tick();
    document.querySelector<HTMLButtonElement>('.rail-create-grid button')!.click();
    await vi.waitFor(() => expect(getProjectCatalog().projects['/app'].folderId).toBe('team'));
    expect(addWorkspaceToWindow).toHaveBeenCalledWith('/app');
  });
  it('highlights the active global document without also highlighting its containing tab group', async () => {
    await seed(); const { host } = mountComponent(ActivityRail, { panelWidthPx: 240, tabGroups: groups, activeContextId: 'tabs-default' as const }); await tick();
    try {
      host.querySelector<HTMLButtonElement>('[data-global-document-id="plan"]')!.click(); await tick();
      expect(host.querySelector('[data-global-document-id="plan"]')?.getAttribute('aria-current')).toBe('true');
      expect(host.querySelector('[data-tab-group-id="tabs-default"]')?.hasAttribute('aria-current')).toBe(false);
    } finally { appState.closeGlobalDocumentTabs('plan'); }
  });
  it('offers folder rename and deletion that keeps items', async () => {
    await seed(); const { host } = mountComponent(ActivityRail, { panelWidthPx: 240 }); await tick();
    await context(host.querySelector('.rail-section-toggle')!); button('Rename folder').click(); await tick();
    await submitName(host, '[aria-label="Folder name"]', 'Research'); expect(getProjectCatalog().folders.team.name).toBe('Research');
    await context(host.querySelector('.rail-section-toggle')!); button('Delete folder (keep items)').click();
    expect(invoke).toHaveBeenLastCalledWith('project_catalog_transaction', { mutations: [{ type: 'removeFolder', id: 'team' }] });
  });
  it('reports failed moves without changing the list or opening the destination folder', async () => {
    await seed(); localStorage.setItem('spec-ops:workspace-rail:main', JSON.stringify({ collapsed: ['folder:team'], scrollTop: 0 }));
    const onError = vi.fn(); const { host } = mountComponent(ActivityRail, { panelWidthPx: 240, onError }); await tick();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Disk full'));
    await context(host.querySelector('[data-global-document-id="plan"]')!); button('Move to Team').click(); await tick(); await tick();
    expect(onError).toHaveBeenCalledWith('Error: Disk full'); expect(host.querySelector('[data-rail-zone="root"]')!.contains(host.querySelector('[data-global-document-id="plan"]'))).toBe(true);
    expect(host.querySelector('.rail-section-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });
  it('excludes hidden and other-window workspaces, and opens a closed project', async () => {
    await seed(); source.projects['/hidden'] = { ...catalogProjectForRoot('/hidden'), hiddenFromRail: true };
    source.projects['/other'] = catalogProjectForRoot('/other'); await loadProjectCatalog();
    vi.mocked(readLiveWorkspaceWindowOwners).mockResolvedValue({ '/other': 'other' });
    const { host } = mountComponent(ActivityRail, { panelWidthPx: 240 }); await tick(); await tick();
    expect(host.querySelectorAll('[data-workspace-id]')).toHaveLength(1);
    const row = host.querySelector<HTMLButtonElement>('[data-workspace-id]')!; expect(row.hasAttribute('data-file-drop-context')).toBe(false);
    row.click(); expect(addWorkspaceToWindow).toHaveBeenCalledWith('/app');
  });
  it('keeps compact accessible labels and keyboard resizing', async () => {
    const onPanelWidthChange = vi.fn(); const { host } = mountComponent(ActivityRail, { workspaces: [workspace(1, '/app')], panelWidthPx: 48, onPanelWidthChange }); await tick();
    expect(host.querySelector('[data-workspace-id]')!.getAttribute('aria-label')).toContain('Workspace app, /app');
    host.querySelector('[role=slider]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await tick();
    expect(onPanelWidthChange).toHaveBeenCalledWith(520); expect(host.querySelector('.rail-workspace-row')).not.toBeNull();
  });
});
