<script lang="ts">
  import { onDestroy, untrack, tick } from "svelte";
  import { subscribeWorkspaceGitSummary, refreshWorkspaceGitSummaries, type WorkspaceGitSummarySnapshot, type WorkspaceGitSummaryDemand } from "../git/workspaceGitSummary";
  import { workspaceGitSummaryPresentation } from "../git/workspaceGitSummaryPresentation";
  import HoverTooltip from "./HoverTooltip.svelte";
  import {
    allTabs,
    DEFAULT_TAB_GROUP_ID,
    isTabGroupId,
    type ContextId,
    type WorkspaceEntry,
  } from "../domain/contracts";
  import { chatSessionCountsByRoot } from "../state/chatStore";
  import {
    createWorkspaceRailDragController,
    type WorkspaceDragState,
  } from "./workspaceRailDragController";
  import {
    DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
    MIN_ACTIVITY_RAIL_WIDTH_PX,
    MAX_ACTIVITY_RAIL_WIDTH_PX,
    isActivityRailExpanded,
    normalizeActivityRailWidthPx,
  } from "../services/panelLayout";
  import { startPointerDrag } from "./pointerDrag";
  import { appState } from "../state/appState";
  import { appActiveSession } from "../state/appStateSelectors";
  import RailTypeIcon from "./icons/RailTypeIcon.svelte";
  import { unifiedRailItems, sortRailItems, railItemMatches, railPlacement, tabGroupRailKey, type RailItem } from "../services/unifiedRail";
  import { openFolderDialog } from "../services/fileSystem";
  import AddIcon from "./icons/AddIcon.svelte";
  import ListIcon from "./icons/ListIcon.svelte";
  import { getProjectCatalog, projectIdentity, subscribeProjectCatalog, updateOpenWorkspaceCatalog, type CatalogMutation } from "../services/workspaceCatalog";
  import { listen } from '@tauri-apps/api/event';
  import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
  import { readLiveWorkspaceWindowOwners, WORKSPACE_PLACEMENT_CHANGED, type WorkspaceWindowOwners } from '../services/workspaceWindowPlacement';
  import { workspaceRailSections, readRailWindowPreferences, writeRailWindowPreferences, type RailProject } from '../services/workspaceRailSections';
  import { clampFixedOverlayPosition } from './clampFixedOverlayPosition';
  import { distinguishingProjectPaths, projectName, projectColor, projectIcon } from "./workspaceRailPresentation";
  import type { RailTabGroup } from "../services/railTabGroups";
  import { removeTabGroupWithConfirm } from "../services/tabGroupCloseFlow";
  import type { GlobalDocument, RailPlacement } from "../domain/projectCatalog";
  import {
    createGlobalDocument,
    deleteGlobalDocument,
    globalDocumentKindLabel,
    openGlobalDocument,
    renameGlobalDocument,
  } from "../services/globalDocuments";
  import { requestConfirm } from "../services/confirmDialogUi";
  import { anchorFromElement, type PromptAnchor } from "../services/promptAnchor";
  import { loadWorkspaceDocument, workspaceDocumentSnapshot, workspaceDocumentsRevision, type WorkspaceDocumentKind } from "../services/workspaceDocuments";
  import { subscribeWorkspacePreferences } from "../services/workspacePreferences";

  interface Props {
    workspaces?: WorkspaceEntry[];
    currentWindowId?: string;
    searchQuery?: string;
    manualOrder?: boolean;
    onError?: (message: string) => void;
    activeContextId?: ContextId;
    /** Whether session counts are included in workspace tooltips. */
    sessionsEnabled?: boolean;
    /** Resizable rail width (compact 48px → expanded rows). */
    panelWidthPx?: number;
    /** The window's tab groups, default group first. */
    tabGroups?: RailTabGroup[];
    /** Hides the Version Control menu entry when Git integration is off. */
    gitIntegrationEnabled?: boolean;
    onSelectContext?: (contextId: ContextId) => void;
    onOpenVersionControl?: (workspaceId: ContextId) => void;
    onOpenSettings?: (workspaceId: ContextId) => void;
    onMoveToWindow?: (workspaceId: ContextId, newWindow: boolean) => void;
    onOpenDocument?: (workspaceId: ContextId, kind: WorkspaceDocumentKind) => void | Promise<void>;
    onCloseWorkspace?: (workspaceId: ContextId) => void;
    onAddWorkspace?: () => void;
    onOpenWorkspaceManager?: () => void;
    onPanelWidthChange?: (width: number) => void;
    onReorderWorkspaces?: (fromIndex: number, toIndex: number) => void;
    /** Switches to a tab group and selects the given tab id. */
    onSelectTabGroupTab?: (groupId: ContextId, tabId: string) => void;
  }

  let {
    workspaces = [],
    currentWindowId = 'main',
    searchQuery = $bindable(''),
    manualOrder = true,
    onError = console.error,
    activeContextId = DEFAULT_TAB_GROUP_ID,
    sessionsEnabled = false,
    panelWidthPx = DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
    tabGroups = [],
    gitIntegrationEnabled = true,
    onSelectContext = () => {},
    onOpenVersionControl = () => {},
    onOpenSettings,
    onMoveToWindow,
    onOpenDocument,
    onCloseWorkspace,
    onAddWorkspace = () => {},
    onOpenWorkspaceManager = () => {},
    onPanelWidthChange = () => {},
    onReorderWorkspaces = () => {},
    onSelectTabGroupTab = () => {},
  }: Props = $props();

  let activityRailEl: HTMLElement | null = null;
  let railWorkspacesEl: HTMLDivElement | null = null;
  let displayWidth = $state(DEFAULT_ACTIVITY_RAIL_WIDTH_PX);
  let isResizing = $state(false);
  let railSearchOpen = $state(false);
  let railSearchInput = $state<HTMLInputElement | null>(null);
  // Keep the local display width in sync with the persisted width unless the
  // user is actively dragging the handle (mirrors the project-panel pattern).
  $effect(() => {
    const synced = panelWidthPx;
    if (!isResizing) {
      displayWidth = normalizeActivityRailWidthPx(synced);
    }
  });

  const expanded = $derived(isActivityRailExpanded(displayWidth));

  /**
   * Workspace rail tooltips use double the default hover delay (the compact
   * rail buttons are hovered constantly while dragging between workspaces, and
   * a longer delay keeps the name tooltip from flickering on every pass).
   */
  const WORKSPACE_TOOLTIP_DELAY_MS = 400;

  let dragState = $state<WorkspaceDragState>({
    pointerId: null,
    pressedWorkspaceId: null,
    dragWorkspaceId: null,
    dragFromIndex: -1,
    dropIndex: -1,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragPointerX: 0,
    dragPointerY: 0,
    dragPointerStartX: 0,
    dragPointerStartY: 0,
    dragWorkspaceRect: null,
    activityRailRect: null,
    workspaceRects: new Map(),
    didDrag: false,
    isFinishingDrag: false,
  });

  let gitCells = $state.raw(new Map<string, WorkspaceGitSummarySnapshot>());
  let visibleGitPaths = $state.raw(new Set<string>());
  let gitRefreshBusy = $state(false);
  const gitConsumerCounts = new Map<string, number>();
  function subscribeRailGit(path: string, demand: WorkspaceGitSummaryDemand) {
    gitConsumerCounts.set(path, (gitConsumerCounts.get(path) ?? 0) + 1);
    const subscription = subscribeWorkspaceGitSummary(path, snapshot => receiveGit(path, snapshot), demand);
    return { ...subscription, unsubscribe() {
      subscription.unsubscribe();
      const remaining = (gitConsumerCounts.get(path) ?? 1) - 1;
      if (remaining > 0) gitConsumerCounts.set(path, remaining);
      else {
        gitConsumerCounts.delete(path);
        const next = new Map(gitCells); next.delete(path); gitCells = next;
      }
    } };
  }
  function receiveGit(path: string, snapshot: WorkspaceGitSummarySnapshot): void {
    gitCells = new Map(gitCells).set(path, snapshot);
  }
  function gitFor(path: string) {
    return workspaceGitSummaryPresentation(gitCells.get(path) ?? { status: 'unknown', refreshing: false, summary: null, checkedAt: null, error: null });
  }
  // The active root remains demanded even when its section is collapsed or hidden.
  const activeGitRoot = $derived(workspaces.find(workspace => workspace.id === activeContextId)?.rootPath);
  $effect(() => {
    const path = activeGitRoot;
    if (!path) return;
    const subscription = untrack(() => subscribeRailGit(path, { priority: 'active' }));
    return () => subscription.unsubscribe();
  });
  function observeGitRow(node: HTMLElement, path: string) {
    let stopped = false;
    const subscription = subscribeRailGit(path, { priority: 'visible', enabled: false });
    const observer = new IntersectionObserver(entries => {
      if (stopped) return;
      const visible = entries.some(entry => entry.target === node && entry.isIntersecting);
      subscription.setDemand({ priority: 'visible', enabled: visible });
      const next = new Set(visibleGitPaths);
      if (visible) next.add(path); else next.delete(path);
      visibleGitPaths = next;
    }, { root: node.closest('.rail-workspaces'), threshold: 0 });
    observer.observe(node);
    return { destroy() {
      stopped = true; observer.disconnect(); subscription.unsubscribe();
      const next = new Set(visibleGitPaths); next.delete(path); visibleGitPaths = next;
    } };
  }
  async function refreshVisibleGit(): Promise<void> {
    gitRefreshBusy = true;
    try { await refreshWorkspaceGitSummaries([...visibleGitPaths]); }
    catch (error) { onError(String(error)); }
    finally { gitRefreshBusy = false; }
  }
  async function openProjectVersionControl(project: RailProject): Promise<void> {
    closeMenu();
    try {
      const id = project.contextId ?? await addWorkspaceToWindow(project.rootPath);
      if (id) onOpenVersionControl(id);
    } catch (error) { onError(String(error)); }
  }
  let catalog = $state.raw(getProjectCatalog());
  $effect(() => untrack(() => subscribeProjectCatalog((next) => { catalog = next; })));
  let owners = $state.raw<WorkspaceWindowOwners>({});
  let collapsed = $state<string[]>([]);
  let restoredWindow = '';
  $effect(() => {
    const id = currentWindowId;
    const preferences = readRailWindowPreferences(id);
    collapsed = preferences.collapsed;
    restoredWindow = id;

  });
  function saveRailPreferences(): void {
    if (restoredWindow === currentWindowId) writeRailWindowPreferences(currentWindowId,
      { collapsed, scrollTop: railWorkspacesEl?.scrollTop ?? 0 });
  }
  $effect(() => {
    let disposed = false;
    let request = 0;
    const refresh = () => { const current = ++request; void readLiveWorkspaceWindowOwners().then(next => { if (!disposed && current === request) owners = next; }).catch(onError); };
    refresh();
    window.addEventListener('focus', refresh);
    const native = '__TAURI_INTERNALS__' in window;
    const releases = native ? Promise.all([listen(WORKSPACE_PLACEMENT_CHANGED, refresh),
      listen('tauri://destroyed', refresh), listen('tauri://created', refresh)]) : Promise.resolve([]);
    return () => { disposed = true; window.removeEventListener('focus', refresh); void releases.then(list => list.forEach(release => release())); };
  });
  const sections = $derived(workspaceRailSections(catalog, workspaces, owners, currentWindowId));
  const railProjects = $derived(sections.flatMap(section => section.projects));
  // A cold catalog read may finish after mount; restore after its rows exist.
  $effect(() => {
    const id = currentWindowId;
    catalog.revision;
    workspaces.length;
    void tick().then(() => { if (railWorkspacesEl && restoredWindow === id) railWorkspacesEl.scrollTop = readRailWindowPreferences(id).scrollTop; });
  });
  const items = $derived(unifiedRailItems(catalog, railProjects, tabGroups, currentWindowId));
  const matchingItems = $derived(items.filter(item => railItemMatches(item, searchQuery)));
  const pinnedItems = $derived(sortRailItems(matchingItems.filter(item => item.pinned), true));
  const rootItems = $derived(sortRailItems(items.filter(item => !item.pinned && !item.folderId &&
    (railItemMatches(item, searchQuery) || (item.kind === 'folder' && matchingItems.some(child => !child.pinned && child.folderId === item.folder.id))))));
  const visibleItems = $derived([...pinnedItems, ...rootItems.flatMap(item => item.kind === 'folder' && !folderCollapsed(item.folder.id)
    ? [item, ...folderChildren(item.folder.id)] : [item])]);
  const workspacesForRender = $derived(visibleItems.map(item => ({ id: item.key, rootPath: item.kind === 'workspace' ? item.project.rootPath : '' })));
  const dragEnabled = $derived(manualOrder && !searchQuery.trim());
  const draggedItem = $derived(items.find(item => item.key === dragState.dragWorkspaceId));
  function folderCollapsed(id: string): boolean { return !searchQuery.trim() && collapsed.includes(`folder:${id}`); }
  function folderChildren(id: string): RailItem[] {
    const folderMatches = items.some(item => item.kind === 'folder' && item.folder.id === id && railItemMatches(item, searchQuery));
    return sortRailItems(items.filter(item => !item.pinned && item.folderId === id && (folderMatches || railItemMatches(item, searchQuery))));
  }
  function revealFolder(id: string | null): void {
    if (!id || !folderCollapsed(id)) return;
    collapsed = collapsed.filter(key => key !== `folder:${id}`); saveRailPreferences();
  }
  function toggleFolder(id: string): void {
    const key = `folder:${id}`;
    collapsed = collapsed.includes(key) ? collapsed.filter(value => value !== key) : [...collapsed, key];
    saveRailPreferences();
  }
  function commit(mutations: CatalogMutation[]) {
    return updateOpenWorkspaceCatalog(workspaces, mutations).catch(error => { onError(String(error)); return null; });
  }
  function selectProject(project: RailProject): void {
    if (project.contextId) onSelectContext(project.contextId);
    else void addWorkspaceToWindow(project.rootPath).catch(error => onError(String(error)));
    closeMenu();
  }
  function selectItem(item: RailItem): void {
    if (item.kind === 'workspace') selectProject(item.project);
    else if (item.kind === 'tabGroup') onSelectContext(item.group.id);
    else if (item.kind === 'folder') toggleFolder(item.folder.id);
    else openGlobalDocument(item.document.id);
  }
  async function placeItem(item: RailItem, patch: Partial<RailPlacement>): Promise<void> {
    const next = await commit([{ type: 'organizeRailItem', id: item.key, placement: { ...railPlacement(item), ...patch },
      ...(item.kind === 'workspace' ? { projectId: item.project.id } : {}) }]);
    if (next) revealFolder(patch.folderId ?? null);
  }
  function toggleItemPin(item: RailItem): void {
    void placeItem(item, { pinned: !item.pinned, ...(item.pinned ? {} : { pinnedOrder: Math.max(-1, ...items.filter(row => row.pinned).map(row => row.pinnedOrder)) + 1 }) });
    closeMenu();
  }
  function moveItem(item: RailItem, folderId: string | null, pinned: boolean, beforeKey: string | null = null): void {
    if (item.kind === 'folder' && (folderId || pinned)) return;
    const siblings = sortRailItems(items.filter(row => row.key !== item.key && (pinned ? row.pinned : !row.pinned && row.folderId === folderId)), pinned);
    const index = beforeKey ? siblings.findIndex(row => row.key === beforeKey) : siblings.length;
    const at = index < 0 ? siblings.length : index;
    siblings.splice(at, 0, item);
    const mutations: CatalogMutation[] = siblings.map((row, index) => ({
      type: 'organizeRailItem', id: row.key,
      placement: { ...railPlacement(row), ...(pinned ? { pinned: true, pinnedOrder: index } : { folderId, pinned: false, order: index }) },
      ...(row.kind === 'workspace' ? { projectId: row.project.id } : {}),
    }));
    void commit(mutations).then(next => {
      if (next && !pinned) revealFolder(folderId);
    });
    closeMenu();
  }
  function reorderItem(item: RailItem, direction: -1 | 1): void {
    const siblings = sortRailItems(items.filter(row => item.pinned ? row.pinned : !row.pinned && row.folderId === item.folderId), item.pinned);
    const index = siblings.findIndex(row => row.key === item.key);
    if (index + direction < 0 || index + direction >= siblings.length) return;
    moveItem(item, item.folderId, item.pinned, direction < 0 ? siblings[index - 1].key : siblings[index + 2]?.key ?? null);
  }
  function dropItem(key: string, x: number, y: number): void {
    if (!dragEnabled) return;
    const item = items.find(row => row.key === key); if (!item) return;
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-rail-item-id], [data-rail-zone]');
    if (!target) return;
    const destination = items.find(row => row.key === target.dataset.railItemId);
    if (destination?.key === key) return;
    if (destination?.kind === 'folder' && item.kind !== 'folder') {
      const rect = target.getBoundingClientRect();
      if (y >= rect.top + rect.height * .25 && y <= rect.bottom - rect.height * .25) {
        moveItem(item, destination.folder.id, false); return;
      }
    }
    const pinned = destination?.pinned ?? target.dataset.railZone === 'pinned';
    const folderId = destination?.folderId ?? (target.dataset.railZone?.startsWith('folder:') ? target.dataset.railZone.slice(7) : null);
    const siblings = sortRailItems(items.filter(row => row.key !== key && (pinned ? row.pinned : !row.pinned && row.folderId === folderId)), pinned);
    let beforeKey = destination?.key ?? null;
    if (destination && y > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2) {
      beforeKey = siblings[siblings.findIndex(row => row.key === destination.key) + 1]?.key ?? null;
    }
    moveItem(item, folderId, pinned, beforeKey);
  }
  function pointerItem(event: PointerEvent, item: RailItem): void {
    if ((event.target as HTMLElement).closest('[role=button]') && event.target !== event.currentTarget) return;
    if (dragEnabled) dragController.pointerDown(event, { id: item.key, rootPath: item.kind === 'workspace' ? item.project.rootPath : '' },
      workspacesForRender.findIndex(row => row.id === item.key));
  }
  function itemKeydown(event: KeyboardEvent, item: RailItem): void {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openItemMenu(event, item);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.altKey) { if (dragEnabled) reorderItem(item, event.key === 'ArrowUp' ? -1 : 1); return; }
      const rows = [...(railWorkspacesEl?.querySelectorAll<HTMLElement>('[data-rail-item-id]') ?? [])];
      rows[rows.indexOf(event.currentTarget as HTMLElement) + (event.key === 'ArrowUp' ? -1 : 1)]?.focus();
    } else if (event.key === 'Escape' && searchQuery) { event.preventDefault(); searchQuery = ''; }
  }
  function openItemMenu(event: MouseEvent | KeyboardEvent, item: RailItem): void {
    openMenu(event, { item, ...(item.kind === 'workspace' ? { project: item.project } : item.kind === 'tabGroup' ? { tabGroup: item.group } : item.kind === 'folder' ? {} : { globalDocument: item.document }) });
  }
  type RailMenuTarget = { item?: RailItem; project?: RailProject; tabGroup?: RailTabGroup; globalDocument?: GlobalDocument };
  let menu = $state<(RailMenuTarget & { x: number; y: number }) | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let menuTrigger: HTMLElement | null = null;
  // Suppress every workspace tooltip while any rail menu is open so the
  // tooltip never overlaps the menu.
  let createOpen = $state(false);
  const workspaceTooltipSuppressed = $derived(menu !== null || createOpen);
  function closeMenu(): void { if (!menu) return; const trigger = menuTrigger; menu = null; void tick().then(() => trigger?.focus()); }
  function openMenu(event: MouseEvent | KeyboardEvent, value: RailMenuTarget): void {
    event.preventDefault();
    menuTrigger = event.currentTarget as HTMLElement;
    const rect = menuTrigger.getBoundingClientRect();
    menu = { ...value, x: event instanceof MouseEvent && event.clientX ? event.clientX : rect.right,
      y: event instanceof MouseEvent && event.clientY ? event.clientY : rect.top };
    void tick().then(() => menuEl?.querySelector<HTMLElement>('button,input')?.focus());
  }
  function windowPointerDown(event: PointerEvent): void { if (menu && !menuEl?.contains(event.target as Node)) menu = null; if (createOpen && !createEl?.contains(event.target as Node) && !createTrigger?.contains(event.target as Node)) closeCreate(); }
  function menuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      const items = [...(menuEl?.querySelectorAll<HTMLElement>('button:not(:disabled),input') ?? [])];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next]?.focus();
    }
  }
  $effect(() => { if (menu && menuEl) {
    const pos = clampFixedOverlayPosition(menu.x, menu.y, menuEl.offsetWidth, menuEl.offsetHeight);
    menuEl.style.left = `${pos.x}px`; menuEl.style.top = `${pos.y}px`;
  } });
  let folderName = $state('');
  let folderEdit = $state<{ id: string | null } | null>(null);
  function editFolder(id: string | null): void { folderName = id ? catalog.folders[id]?.name ?? '' : ''; folderEdit = { id }; menu = null; void tick().then(() => activityRailEl?.querySelector<HTMLInputElement>('.rail-folder-form input')?.focus()); }
  function saveFolder(): void {
    const name = folderName.trim(); if (!folderEdit || !name) return;
    commit(folderEdit.id ? [{ type: 'renameFolder', id: folderEdit.id, name }] :
      [{ type: 'putFolder', folder: { id: crypto.randomUUID(), name, order: 0 } }]); folderEdit = null;
  }
  // Tab groups (this window) and app-wide Tasks/Notes documents share one name form.
  type EntityKind = 'tabGroup' | 'tasks' | 'notes';
  let entityName = $state('');
  let entityEdit = $state<{ kind: EntityKind; id: string | null; folderId: string | null } | null>(null);
  function entityLabel(kind: EntityKind): string { return kind === 'tabGroup' ? 'Tab group' : globalDocumentKindLabel(kind); }
  function editEntity(kind: EntityKind, id: string | null, name = ''): void {
    entityName = name; entityEdit = { kind, id, folderId: createFolderId }; menu = null;
    void tick().then(() => activityRailEl?.querySelector<HTMLInputElement>('.rail-entity-form input')?.focus());
  }
  function nextItemOrder(folderId: string | null): number {
    return Math.max(-1, ...items.filter(item => item.folderId === folderId).map(item => item.order)) + 1;
  }
  async function saveEntity(): Promise<void> {
    const edit = entityEdit; const name = entityName.trim();
    if (!edit || !name) return;
    entityEdit = null;
    try {
      if (edit.kind === 'tabGroup') {
        if (edit.id) appState.renameTabGroup(edit.id as ContextId, name);
        else {
          const id = appState.createTabGroup(name);
          if (await commit([{ type: 'organizeRailItem', id: tabGroupRailKey(currentWindowId, id), placement: { folderId: edit.folderId, pinned: false, order: nextItemOrder(edit.folderId), pinnedOrder: 0 } }])) revealFolder(edit.folderId);
        }
      } else if (edit.id) {
        await renameGlobalDocument(edit.id, name);
      } else {
        const document = await createGlobalDocument(edit.kind, name);
        if (await commit([{ type: 'organizeRailItem', id: `document:${document.id}`, placement: { folderId: edit.folderId, pinned: false, order: nextItemOrder(edit.folderId), pinnedOrder: 0 } }])) revealFolder(edit.folderId);
        openGlobalDocument(document.id);
      }
    } catch (error) { onError(String(error)); }
  }
  function runEntityAction(action: () => unknown): void {
    menu = null;
    void Promise.resolve().then(action).catch(error => onError(String(error)));
  }
  async function confirmDeleteGlobalDocument(document: GlobalDocument, anchor?: PromptAnchor): Promise<void> {
    if (!await requestConfirm({ title: `Delete ${globalDocumentKindLabel(document.kind)}`,
      message: `Delete "${document.name}"? Its file is removed and this cannot be undone.`,
      confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true, anchor })) return;
    await deleteGlobalDocument(document.id);
  }
  const activeGlobalDocumentId = $derived.by(() => {
    if (!isTabGroupId(activeContextId)) return null;
    const layout = $appActiveSession.editorLayout;
    const pane = layout.panes.find(entry => entry.id === layout.activePaneId);
    const tab = pane?.tabs.find(entry => entry.id === pane.selectedTabId);
    return tab?.kind === 'view' ? tab.globalDocumentId ?? null : null;
  });
  // Workspace actions that open a tab, window or dialog elsewhere: close the
  // menu without returning focus to the rail row.
  function runWorkspaceAction(contextId: ContextId, action: ((id: ContextId) => unknown) | undefined): void {
    menu = null;
    void Promise.resolve(action?.(contextId)).catch(error => onError(String(error)));
  }
  async function copyProjectPath(project: RailProject): Promise<void> {
    closeMenu();
    try { await navigator.clipboard.writeText(project.rootPath); }
    catch { /* clipboard is best-effort from the workspace menu */ }
  }
  const DOCUMENT_KINDS = ["tasks", "notes"] as const;
  const menuRoot = $derived(menu?.project?.contextId ? menu.project.rootPath : null);
  let documentPreferenceRevision = $state(0);
  $effect(() => untrack(() => subscribeWorkspacePreferences(() => { documentPreferenceRevision++; })));
  $effect(() => {
    const root = menuRoot; void documentPreferenceRevision;
    if (root) for (const kind of DOCUMENT_KINDS) void loadWorkspaceDocument(root, kind, undefined, true).catch(() => {});
  });
  const menuDocuments = $derived.by(() => { void $workspaceDocumentsRevision; return menuRoot ? DOCUMENT_KINDS.map(kind => workspaceDocumentSnapshot(menuRoot, kind)) : []; });
  const ghostLeft = $derived(
    dragState.activityRailRect && dragState.dragWorkspaceRect
      ? dragState.dragPointerX - dragState.dragOffsetX - dragState.activityRailRect.left
      : 0,
  );
  const ghostTop = $derived(
    dragState.activityRailRect && dragState.dragWorkspaceRect
      ? dragState.dragPointerY - dragState.dragOffsetY - dragState.activityRailRect.top
      : 0,
  );

  let dropHint = $state<{ key: string; position: 'before' | 'after' | 'inside' } | null>(null);
  const dragController = createWorkspaceRailDragController({
    getWorkspaces: () => workspacesForRender,
    getRailWorkspacesEl: () => railWorkspacesEl,
    getActivityRailEl: () => activityRailEl,
    onSelect: (id) => { const item = items.find(item => item.key === id); if (item) selectItem(item); },
    onReorder: (fromIndex, toIndex) => onReorderWorkspaces(fromIndex, toIndex),
    onDrop: dropItem,
    onStateChange: (nextState) => {
      dragState = nextState;
      dropHint = null;
      if (nextState.didDrag) {
        const target = document.elementFromPoint(nextState.dragPointerX, nextState.dragPointerY)?.closest<HTMLElement>('[data-rail-item-id], [data-rail-zone]');
        const key = target?.dataset.railItemId;
        const item = items.find(row => row.key === key);
        if (target && item && key !== nextState.dragWorkspaceId) {
          const rect = target.getBoundingClientRect();
          const inside = item.kind === 'folder' && draggedItem?.kind !== 'folder' && nextState.dragPointerY >= rect.top + rect.height * .25 && nextState.dragPointerY <= rect.bottom - rect.height * .25;
          dropHint = { key: item.key, position: inside ? 'inside' : nextState.dragPointerY < rect.top + rect.height / 2 ? 'before' : 'after' };
        }
      }
    },
  });

  /**
   * Session counts via an explicit store subscription (F70). Reading
   * `$chatSessionCountsByRoot` inside `$derived` re-runs on every chatStore
   * emit — Svelte 5's store_get treats object values as always-changed — so
   * the rail repainted per streamed token. Subscribe only notifies when the
   * derived Map's reference actually changes (counts changed).
   */
  let sessionCountsByRoot = $state.raw<ReadonlyMap<string, number>>(new Map());
  $effect(() => {
    return chatSessionCountsByRoot.subscribe((map) => {
      if (map !== sessionCountsByRoot) {
        sessionCountsByRoot = map;
      }
    });
  });

  /** Tab counts depend only on workspace session snapshots, not chat tokens. */
  const tabCountsByRoot = $derived.by(() => {
    const map = new Map<string, number>();
    for (const workspace of workspaces) {
      map.set(
        workspace.rootPath,
        allTabs(workspace.snapshot.session.editorLayout).length,
      );
    }
    return map;
  });

  function workspaceName(workspace: RailProject): string {
    return catalog.projects[projectIdentity(workspace.rootPath)]?.name ?? projectName(workspace.rootPath);
  }
  function workspaceInitial(workspace: RailProject): string {
    const project = catalog.projects[projectIdentity(workspace.rootPath)];
    return projectIcon(project?.icon) ?? (workspaceName(workspace).trim()[0] ?? "?").toUpperCase();
  }
  function workspaceColor(workspace: RailProject): string | undefined {
    return projectColor(catalog.projects[projectIdentity(workspace.rootPath)]?.color);
  }
  const shortPaths = $derived(distinguishingProjectPaths(railProjects.map((workspace) => ({
    id: workspace.id, rootPath: workspace.rootPath, name: workspaceName(workspace),
  }))));
  function workspaceDetail(workspace: RailProject): string {
    const sessions = sessionsEnabled ? ` · Sessions: ${sessionCountsByRoot.get(workspace.rootPath) ?? 0}` : "";
    return `${workspace.rootPath} · ${gitFor(workspace.rootPath).detail}${sessions} · Tabs: ${tabCountsByRoot.get(workspace.rootPath) ?? 0}`;
  }
  let createEl = $state<HTMLDivElement | null>(null);
  let createTrigger = $state<HTMLButtonElement | null>(null);
  let createFolderId = $state<string | null>(null);
  const createOptions = [
    { kind: 'workspace', name: 'Workspace', detail: 'Open a project folder' },
    { kind: 'tabGroup', name: 'Tab group', detail: 'Collect tabs in this window' },
    { kind: 'tasks', name: 'Tasks', detail: 'Create a task list' },
    { kind: 'notes', name: 'Notes', detail: 'Create a note' },
    { kind: 'folder', name: 'Folder', detail: 'Organize sidebar items' },
  ] as const;
  function showCreate(folderId: string | null = null): void {
    menu = null; createFolderId = folderId; createOpen = true;
    void tick().then(() => createEl?.querySelector<HTMLButtonElement>('button')?.focus());
  }
  function closeCreate(): void { createOpen = false; void tick().then(() => createTrigger?.focus()); }
  async function chooseCreate(kind: typeof createOptions[number]['kind']): Promise<void> {
    createOpen = false;
    if (kind === 'folder') { editFolder(null); return; }
    if (kind !== 'workspace') { editEntity(kind, null); return; }
    if (!createFolderId) { onAddWorkspace(); return; }
    const folderId = createFolderId;
    try {
      const root = await openFolderDialog(); if (!root) return;
      await addWorkspaceToWindow(root);
      const project = getProjectCatalog().projects[projectIdentity(root)];
      if (project && await commit([{ type: 'moveProject', id: project.id, folderId }])) revealFolder(folderId);
    } catch (error) { onError(String(error)); }
  }
  $effect(() => {
    if (!createOpen || !createEl || !createTrigger) return;
    const rect = createTrigger.getBoundingClientRect();
    const pos = clampFixedOverlayPosition(rect.left, rect.top - createEl.offsetHeight - 8, createEl.offsetWidth, createEl.offsetHeight);
    createEl.style.left = `${pos.x}px`; createEl.style.top = `${pos.y}px`;
  });
  function resizeKeydown(event: KeyboardEvent): void {
    const widths: Record<string, number> = { ArrowLeft: displayWidth - 16, ArrowRight: displayWidth + 16,
      Home: MIN_ACTIVITY_RAIL_WIDTH_PX, End: MAX_ACTIVITY_RAIL_WIDTH_PX };
    if (!(event.key in widths)) return;
    event.preventDefault();
    displayWidth = normalizeActivityRailWidthPx(widths[event.key]);
    onPanelWidthChange(displayWidth);
  }

  let activeResizeTeardown: (() => void) | null = null;

  function handleResizeStart(event: PointerEvent): void {
    event.preventDefault();
    activeResizeTeardown?.();
    isResizing = true;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = displayWidth;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const teardown = startPointerDrag({
      pointerId,
      target,
      onMove: (moveEvent) => {
        // Rail is anchored to the left edge, so dragging its right handle to the
        // right grows the width.
        const deltaX = moveEvent.clientX - startX;
        displayWidth = normalizeActivityRailWidthPx(startWidth + deltaX);
      },
      onEnd: () => {
        isResizing = false;
        activeResizeTeardown = null;
        onPanelWidthChange(displayWidth);
      },
    });

    activeResizeTeardown = () => {
      isResizing = false;
      teardown();
    };
  }

  onDestroy(() => {
    activeResizeTeardown?.();
    activeResizeTeardown = null;
    dragController.destroy();
  });
</script>

<svelte:window onpointerdown={windowPointerDown} onkeydown={(event) => { if (event.key === "Escape") { if (menu) closeMenu(); if (createOpen) closeCreate(); } }} />

<aside
  class={`activity-rail${expanded ? " activity-rail-expanded" : ""}${isResizing ? " activity-rail-resizing" : ""}`}
  class:rail-dragging={dragState.didDrag}
  aria-label="Activity rail"
  bind:this={activityRailEl}
  style={`width:${displayWidth}px`}
>
  {#if entityEdit}
    <form class="rail-folder-form rail-entity-form" onsubmit={(event) => { event.preventDefault(); void saveEntity(); }}>
      <input aria-label={`${entityLabel(entityEdit.kind)} name`} placeholder={`${entityLabel(entityEdit.kind)} name`} bind:value={entityName}
        onkeydown={(event) => { if (event.key === 'Escape') entityEdit = null; }} />
      <button type="submit" disabled={!entityName.trim()}>{entityEdit.id ? 'Rename' : 'Create'}</button><button type="button" onclick={() => entityEdit = null}>Cancel</button>
    </form>
  {/if}

  {#if !expanded}<button type="button" class="rail-button" aria-label="Search sidebar" title="Search sidebar" onclick={() => { railSearchOpen = !railSearchOpen; void tick().then(() => railSearchInput?.focus()); }}>⌕</button>{/if}
  {#if expanded || railSearchOpen}
    <input bind:this={railSearchInput} class="rail-search" class:rail-search-compact={!expanded} aria-label="Search sidebar" placeholder="Search name or path…" bind:value={searchQuery}
      onkeydown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchQuery = ''; railSearchOpen = false; }
        if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); railWorkspacesEl?.querySelector<HTMLButtonElement>('[data-rail-item-id]')?.focus(); }
      }} />
  {/if}
  {#if folderEdit}
    <form class="rail-folder-form" onsubmit={(event) => { event.preventDefault(); saveFolder(); }}>
      <input aria-label="Folder name" bind:value={folderName} onkeydown={(event) => { if (event.key === 'Escape') folderEdit = null; }} />
      <button type="submit" disabled={!folderName.trim()}>Save</button><button type="button" onclick={() => folderEdit = null}>Cancel</button>
    </form>
  {/if}
  <div class={`rail-workspaces${expanded ? " rail-workspaces-expanded" : ""}`} bind:this={railWorkspacesEl} onscroll={saveRailPreferences}>
    {#if !visibleItems.length}<p class="rail-empty" role="status">{searchQuery.trim() ? 'No matching items' : 'Add your first item with +'}</p>{/if}
    <div class="rail-zone" data-rail-zone="pinned" aria-label="Pinned items">
      {#each pinnedItems as item (item.key)}{@render itemRow(item)}{/each}
    </div>
    <div class="rail-zone rail-root-zone" data-rail-zone="root">
      {#each rootItems as item (item.key)}
        {#if item.kind === 'folder'}
          <section class="rail-section" data-rail-drop={dropHint?.key === item.key ? dropHint.position : undefined} data-rail-section={item.key} data-rail-zone={item.key} aria-label={`${item.name}, ${folderChildren(item.folder.id).length} items`}>
            <button class="rail-section-toggle" type="button" data-rail-item-id={item.key}
              aria-label={`${item.name}, ${folderChildren(item.folder.id).length} items`} aria-expanded={!folderCollapsed(item.folder.id)} title={item.name}
              onpointerdown={(event) => pointerItem(event, item)}
              onclick={(event) => { if (!dragEnabled || event.detail === 0) toggleFolder(item.folder.id); }}
              oncontextmenu={(event) => openItemMenu(event, item)} onkeydown={(event) => itemKeydown(event, item)}>
              <span aria-hidden="true">{folderCollapsed(item.folder.id) ? '▸' : '▾'}</span><RailTypeIcon kind="folder" />
              {#if expanded}<span class="rail-section-name">{item.name}</span>{/if}<span class="rail-section-count">{folderChildren(item.folder.id).length}</span>
            </button>
            {#if !folderCollapsed(item.folder.id)}
              <div class="rail-folder-children" data-rail-zone={item.key}>
                {#each folderChildren(item.folder.id) as child (child.key)}{@render itemRow(child)}{/each}
                {#if !folderChildren(item.folder.id).length && expanded}<span class="rail-folder-empty">Drop items here</span>{/if}
              </div>
            {/if}
          </section>
        {:else}{@render itemRow(item)}{/if}
      {/each}
    </div>
  </div>
  {#if dragState.didDrag && draggedItem}
    <div class="rail-drag-ghost" aria-hidden="true" style={`left:${ghostLeft}px;top:${ghostTop}px;width:${dragState.dragWorkspaceRect?.width ?? 32}px`}>
      <RailTypeIcon kind={draggedItem.kind} />{#if expanded}<span>{draggedItem.name}</span>{/if}
    </div>
  {/if}

  {#snippet itemRow(item: RailItem)}
    <div class="rail-project-entry" data-rail-drop={dropHint?.key === item.key ? dropHint.position : undefined} class:rail-project-dragging={dragState.didDrag && item.key === dragState.dragWorkspaceId}>
      {#if item.kind === 'workspace'}
        {@const workspace = item.project}
        <div use:observeGitRow={workspace.rootPath}>
        <HoverTooltip
          label={workspaceName(workspace)}
          detail={workspaceDetail(workspace)}
          delayMs={WORKSPACE_TOOLTIP_DELAY_MS}
          suppress={workspaceTooltipSuppressed}
        >
          <button
            class={expanded
              ? `rail-workspace-card rail-workspace-row ${activeContextId === workspace.contextId ? "rail-workspace-card-active" : ""}`
              : `rail-button rail-button-workspace ${activeContextId === workspace.contextId ? "rail-button-active" : ""}`}
            style:--project-color={workspaceColor(workspace) ?? "var(--color-accent)"}
            data-file-drop-context={workspace.contextId}
            data-workspace-id={workspace.id}
            data-rail-item-id={item.key}
            type="button"
            aria-label={`Workspace ${workspaceName(workspace)}, ${workspace.rootPath}, ${gitFor(workspace.rootPath).detail}`}
            aria-current={activeContextId === workspace.contextId ? "true" : undefined}
            oncontextmenu={(event) => {
              event.preventDefault();
              openItemMenu(event, item);
            }}
            onkeydown={(event) => itemKeydown(event, item)}
            onpointerdown={(event) => pointerItem(event, item)}
            onclick={(event) => { if (!dragEnabled || event.detail === 0) selectItem(item); }}
          >
            <span class={expanded ? "rail-workspace-avatar" : "rail-workspace-initial"} aria-hidden="true">{workspaceInitial(workspace)}</span>
            {#if expanded}
              <span class="rail-workspace-info">
                <span class="rail-workspace-heading">
                  <span class="rail-workspace-name">{workspaceName(workspace)}</span>
                  {#if shortPaths.has(workspace.id)}
                    <span class="rail-workspace-distinction" title={workspace.rootPath}>{shortPaths.get(workspace.id)}</span>
                  {/if}
                </span>
                {#if gitFor(workspace.rootPath).text}
                  <span class="rail-workspace-git" class:rail-git-conflict={gitCells.get(workspace.rootPath)?.summary?.hasConflicts} aria-hidden="true">⎇ <span>{gitFor(workspace.rootPath).text}</span></span>
                {/if}
              </span>
            {:else if gitFor(workspace.rootPath).mark}
              <span class="rail-workspace-git-mark" class:rail-git-conflict={gitCells.get(workspace.rootPath)?.summary?.hasConflicts} aria-hidden="true">{gitFor(workspace.rootPath).mark}</span>
            {/if}
          </button>
        </HoverTooltip>
        <button class="rail-git-action" type="button" aria-label={`Version Control for ${workspaceName(workspace)}`}
          title={`Version Control — ${gitFor(workspace.rootPath).detail}`} onclick={() => void openProjectVersionControl(workspace)}>⎇</button>
        </div>
      {:else if item.kind === 'tabGroup'}
        {@const group = item.group}
        {@const active = activeContextId === group.id && !activeGlobalDocumentId}
      {#if expanded}
        <button
          class={`rail-workspace-card rail-workspace-row rail-tab-group-card ${active ? "rail-workspace-card-active" : ""}`}
          data-file-drop-context={group.id}
          data-tab-group-drop={group.id}
          data-tab-group-id={group.id}
            data-rail-item-id={item.key}
          type="button"
          aria-label={`Tab group ${group.name}, ${group.tabCount} tabs`}
          aria-current={active ? "true" : undefined}
          onpointerdown={(event) => pointerItem(event, item)}
          onclick={(event) => { if (!dragEnabled || event.detail === 0) selectItem(item); }}
          oncontextmenu={(event) => openItemMenu(event, item)}
          onkeydown={(event) => itemKeydown(event, item)}
        >
          <span class="rail-workspace-avatar rail-tab-group-avatar" aria-hidden="true">
            <RailTypeIcon kind="tabGroup" />
          </span>
          <span class="rail-workspace-info">
            <span class="rail-workspace-heading"><span class="rail-workspace-name">{group.name}</span></span>
            <span class="rail-workspace-path">Tabs: {group.tabCount}</span>
            {#if group.recentTabs.length > 0}
              <span class="rail-workspace-stats rail-tab-group-tabs">
                {#each group.recentTabs as tab (tab.tabId)}
                  <!-- Nested interactive trigger inside the card button: a span with
                       role=button (nested <button>/<a> are invalid here). -->
                  <span
                    class="rail-tab-group-tab"
                    role="button"
                    tabindex="0"
                    title={tab.label}
                    onclick={(event) => {
                      event.stopPropagation();
                      onSelectTabGroupTab(group.id, tab.tabId);
                    }}
                    onkeydown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectTabGroupTab(group.id, tab.tabId);
                      }
                    }}
                  >
                    {tab.label}
                  </span>
                {/each}
              </span>
            {/if}
          </span>
        </button>
      {:else}
        <HoverTooltip label={group.name} detail={`Tabs: ${group.tabCount}`} suppress={workspaceTooltipSuppressed}>
          <button
            class={`rail-button rail-button-tab-group ${active ? "rail-button-active" : ""}`}
            data-file-drop-context={group.id}
            data-tab-group-drop={group.id}
            data-tab-group-id={group.id}
            data-rail-item-id={item.key}
            type="button"
            aria-label={`Tab group ${group.name}, ${group.tabCount} tabs`}
            aria-current={active ? "true" : undefined}
            onpointerdown={(event) => pointerItem(event, item)}
          onclick={(event) => { if (!dragEnabled || event.detail === 0) selectItem(item); }}
            oncontextmenu={(event) => openItemMenu(event, item)}
          >
            <RailTypeIcon kind="tabGroup" />
          </button>
        </HoverTooltip>
      {/if}

      {:else if item.kind !== 'folder'}
        {@const active = activeGlobalDocumentId === item.document.id}
        <HoverTooltip label={item.name} detail={globalDocumentKindLabel(item.kind)} suppress={workspaceTooltipSuppressed}>
          <button class={expanded ? `rail-workspace-card rail-workspace-row ${active ? 'rail-workspace-card-active' : ''}` : `rail-button ${active ? 'rail-button-active' : ''}`}
            data-rail-item-id={item.key} data-global-document-id={item.document.id} type="button"
            aria-label={`${globalDocumentKindLabel(item.kind)} ${item.name}`} aria-current={active ? 'true' : undefined}
            onpointerdown={(event) => pointerItem(event, item)} onclick={(event) => { if (!dragEnabled || event.detail === 0) selectItem(item); }}
            oncontextmenu={(event) => openItemMenu(event, item)} onkeydown={(event) => itemKeydown(event, item)}>
            <span class={expanded ? 'rail-workspace-avatar' : 'rail-workspace-initial'} aria-hidden="true"><RailTypeIcon kind={item.kind} /></span>
            {#if expanded}<span class="rail-workspace-info"><span class="rail-workspace-name">{item.name}</span></span>{/if}
          </button>
        </HoverTooltip>
      {/if}
      {#if item.kind !== 'folder'}
        <button class="rail-pin-action" class:rail-pin-action-pinned={item.pinned} type="button" aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.name}`}
          aria-pressed={item.pinned} title={item.pinned ? 'Unpin' : 'Pin'} onclick={() => toggleItemPin(item)}>{item.pinned ? '★' : '☆'}</button>
      {/if}
    </div>
  {/snippet}
  <div class="rail-footer-stack">
    <HoverTooltip label="Refresh visible Git summaries"><button class="rail-button" type="button" aria-label="Refresh visible Git summaries"
      disabled={gitRefreshBusy || visibleGitPaths.size === 0} onclick={() => void refreshVisibleGit()}>↻</button></HoverTooltip>
    <HoverTooltip label="Create…"><button bind:this={createTrigger} class="rail-button rail-button-add" type="button" aria-label="Create…" aria-haspopup="dialog" aria-expanded={createOpen}
      onclick={() => { if (createOpen) closeCreate(); else showCreate(); }}><AddIcon size={16} /></button></HoverTooltip>
    <HoverTooltip label="Workspace Manager">
      <button
        class="rail-button rail-button-manager"
        type="button"
        aria-label="Workspace Manager"
        onclick={onOpenWorkspaceManager}
      >
        <span class="rail-manager-icon">
          <ListIcon size={16} />
        </span>
      </button>
    </HoverTooltip>
  </div>

  <div
    class="activity-rail-resize-handle"
    role="slider"
    aria-orientation="horizontal"
    aria-label="Resize sidebar"
    tabindex="0"
    aria-valuemin={MIN_ACTIVITY_RAIL_WIDTH_PX}
    aria-valuemax={MAX_ACTIVITY_RAIL_WIDTH_PX}
    aria-valuenow={displayWidth}
    aria-valuetext={`${displayWidth} pixels`}
    onkeydown={resizeKeydown}
    onpointerdown={handleResizeStart}
  ></div>
</aside>

{#if menu}
  <div class="rail-catalog-menu" role="menu" tabindex="-1" aria-label="Sidebar organization" bind:this={menuEl}
    style={`left:${menu.x}px;top:${menu.y}px`} onkeydown={menuKeydown}>
    {#if menu.project}
      {@const project = menu.project}
      {#if gitIntegrationEnabled}<button type="button" role="menuitem" onclick={() => void openProjectVersionControl(project)}>Version Control</button>{/if}
      {#if project.contextId && onOpenSettings}<button type="button" role="menuitem" onclick={() => runWorkspaceAction(project.contextId!, onOpenSettings)}>Settings</button>{/if}
      <button type="button" role="menuitem" onclick={() => void copyProjectPath(project)}>Copy Path</button>
      <div class="rail-menu-separator" role="separator"></div>
    {/if}
    {#if menu.item && menu.item.kind !== 'folder'}
      {@const item = menu.item}
      <button type="button" role="menuitem" onclick={() => toggleItemPin(item)}>{item.pinned ? 'Unpin' : 'Pin'}</button>
      <button type="button" role="menuitem" disabled={!item.folderId} onclick={() => { void placeItem(item, { folderId: null }); closeMenu(); }}>Move to root</button>
      {#each Object.values(catalog.folders) as folder (folder.id)}
        <button type="button" role="menuitem" disabled={item.folderId === folder.id} onclick={() => { void placeItem(item, { folderId: folder.id }); closeMenu(); }}>Move to {folder.name}</button>
      {/each}
      <button type="button" role="menuitem" disabled={!dragEnabled} onclick={() => { reorderItem(item, -1); closeMenu(); }}>Move Up</button>
      <button type="button" role="menuitem" disabled={!dragEnabled} onclick={() => { reorderItem(item, 1); closeMenu(); }}>Move Down</button>
      <div class="rail-menu-separator" role="separator"></div>
    {/if}
    {#if menu.project}
      {@const project = menu.project}
      {@const contextId = project.contextId}
      {#if !contextId}
        <button type="button" role="menuitem" onclick={() => selectProject(project)}>Open Workspace</button>
      {:else}
        {#if onMoveToWindow}
          <button type="button" role="menuitem" onclick={() => runWorkspaceAction(contextId, id => onMoveToWindow(id, true))}>Open in Separate Window</button>
          <button type="button" role="menuitem" onclick={() => runWorkspaceAction(contextId, id => onMoveToWindow(id, false))}>Move to Window…</button>
        {/if}
        {#if onOpenDocument}
          {#each DOCUMENT_KINDS as kind, index (kind)}
            <button type="button" role="menuitem" onclick={() => runWorkspaceAction(contextId, id => onOpenDocument(id, kind))}>{menuDocuments[index]?.content != null ? "Open" : "Create"} {kind === "tasks" ? "Tasks" : "Notes"}</button>
          {/each}
        {/if}
      {/if}
      <div class="rail-menu-separator" role="separator"></div>
      <button type="button" role="menuitem" onclick={() => { commit([{ type: 'updateProject', id: project.id, patch: { hiddenFromRail: true } }]); closeMenu(); }}>Hide from Sidebar</button>
      {#if contextId && onCloseWorkspace}<button type="button" role="menuitem" onclick={() => runWorkspaceAction(contextId, onCloseWorkspace)}>Close Workspace</button>{/if}
    {:else if menu.tabGroup}
      {@const group = menu.tabGroup}
      <button type="button" role="menuitem" onclick={() => editEntity('tabGroup', group.id, group.name)}>Rename</button>
      <button type="button" role="menuitem" disabled={group.id === DEFAULT_TAB_GROUP_ID}
        title={group.id === DEFAULT_TAB_GROUP_ID ? 'The default tab group cannot be deleted' : undefined}
        onclick={() => runEntityAction(async () => {
          if (await removeTabGroupWithConfirm(group.id, onError)) await commit([{ type: 'removeRailItem', id: tabGroupRailKey(currentWindowId, group.id) }]);
        })}>Delete</button>
    {:else if menu.globalDocument}
      {@const document = menu.globalDocument}
      <button type="button" role="menuitem" onclick={() => runEntityAction(() => openGlobalDocument(document.id))}>Open</button>
      <button type="button" role="menuitem" onclick={() => editEntity(document.kind, document.id, document.name)}>Rename</button>
      <div class="rail-menu-separator" role="separator"></div>
      <button type="button" role="menuitem" onclick={() => { const anchor = anchorFromElement(menuTrigger); runEntityAction(() => confirmDeleteGlobalDocument(document, anchor)); }}>Delete</button>
    {:else if menu.item?.kind === 'folder'}
      {@const folder = menu.item.folder}
      <button type="button" role="menuitem" onclick={() => showCreate(folder.id)}>Create in folder…</button>
      <button type="button" role="menuitem" onclick={() => { toggleFolder(folder.id); closeMenu(); }}>{folderCollapsed(folder.id) ? 'Expand' : 'Collapse'}</button>
      <button type="button" role="menuitem" onclick={() => editFolder(folder.id)}>Rename folder</button>
      <button type="button" role="menuitem" onclick={() => { reorderItem(menu!.item!, -1); closeMenu(); }}>Move Up</button>
      <button type="button" role="menuitem" onclick={() => { reorderItem(menu!.item!, 1); closeMenu(); }}>Move Down</button>
      <button type="button" role="menuitem" onclick={() => { commit([{ type: 'removeFolder', id: folder.id }]); closeMenu(); }}>Delete folder (keep items)</button>
    {/if}
  </div>
{/if}

{#if createOpen}
  <div class="rail-create-popup" role="dialog" aria-label="What would you like to create?" tabindex="-1" bind:this={createEl}
    onkeydown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeCreate(); }
      const buttons = [...(createEl?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2 : 0;
      if (step) { event.preventDefault(); buttons[(index + step + buttons.length) % buttons.length]?.focus(); }
      if (event.key === 'Tab') { event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
    }}>
    <strong>What would you like to create?</strong>
    {#if createFolderId}<p class="rail-create-location">In {catalog.folders[createFolderId]?.name}</p>{/if}
    <div class="rail-create-grid">
      {#each createOptions.filter(option => !createFolderId || option.kind !== 'folder') as option (option.kind)}
        <button type="button" onclick={() => void chooseCreate(option.kind)}><RailTypeIcon kind={option.kind} size={24} /><span>{option.name}</span><small>{option.detail}</small></button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .rail-dragging [data-rail-zone="pinned"] { min-height: 20px; border: 1px dashed var(--color-border-subtle); border-radius: var(--radius-sm); }
  [data-rail-drop="before"] { box-shadow: 0 -2px var(--color-accent); }
  [data-rail-drop="after"] { box-shadow: 0 2px var(--color-accent); }
  [data-rail-drop="inside"] { outline: 1px solid var(--color-accent); outline-offset: -1px; border-radius: var(--radius-sm); background: var(--color-hover); }
  .rail-zone { width: 100%; display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
  .rail-root-zone { flex: 1; min-height: 48px; }
  .rail-folder-children { width: 100%; min-height: 12px; }
  .activity-rail-expanded .rail-folder-children { padding-left: 10px; border-left: 1px solid var(--color-border-subtle); box-sizing: border-box; }
  .rail-folder-empty { padding: 8px; display: block; color: var(--color-text-muted); font-size: 11px; }
  .rail-create-popup { position: fixed; z-index: 100; width: min(360px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow: auto; padding: 16px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-primary); box-shadow: var(--shadow-overlay); box-sizing: border-box; }
  .rail-create-location { margin: 6px 0 0; color: var(--color-text-secondary); font-size: 12px; }
  .rail-create-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .rail-create-grid button { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .rail-create-grid button:hover { background: var(--color-hover); border-color: var(--color-accent); }
  .rail-create-grid button:focus-visible { outline: 2px solid var(--color-focus-ring); }
  .rail-create-grid small { color: var(--color-text-secondary); font-size: 11px; }
  .rail-drag-ghost { position: absolute; z-index: 50; display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--color-surface-2); color: var(--color-text-primary); border: 1px solid var(--color-accent); border-radius: var(--radius-sm); pointer-events: none; opacity: .9; box-sizing: border-box; }

  .rail-project-entry { --project-color: var(--color-accent); position: relative; width: 100%; flex-shrink: 0; }
  .rail-git-action { position: absolute; right: 0; top: 0; padding: 0; width: 16px; height: 16px; font-size: 11px; border: 0; border-radius: 3px; background: var(--color-surface-1); color: var(--color-text-secondary); cursor: pointer; }
  .rail-git-action:focus-visible { outline: 2px solid var(--color-focus-ring); }
  .rail-git-action:hover { background: var(--color-hover); }
  .rail-workspace-git.rail-git-conflict, .rail-workspace-git-mark.rail-git-conflict { color: var(--color-danger, #ee7755); font-weight: bold; }
  .rail-pin-action { position: absolute; left: 0; bottom: 0; padding: 0; width: 16px; height: 16px; font-size: 12px; line-height: 1; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-muted); cursor: pointer; opacity: 0; }
  .activity-rail-expanded .rail-pin-action { left: auto; right: 0; opacity: .6; }
  .rail-project-entry:hover .rail-pin-action, .rail-pin-action:focus-visible, .rail-pin-action-pinned { opacity: 1; }
  .rail-pin-action-pinned { color: var(--color-warning, #e5b454); }
  .rail-pin-action:hover { background: var(--color-hover); }
  .rail-pin-action:focus-visible { outline: 2px solid var(--color-focus-ring); }
  .activity-rail-expanded .rail-project-entry .rail-workspace-info { padding-right: 18px; }

  .rail-search { width: calc(100% - 12px); margin: 6px; min-width: 0; padding: 5px; background: var(--color-surface-1); color: var(--color-text-primary); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); }
  .rail-search-compact { width: 220px; position: absolute; z-index: 20; left: 44px; top: 45px; }
  .rail-empty { padding: 8px; font-size: 12px; color: var(--color-text-secondary); }
  .rail-project-dragging { opacity: 0.35; }
  .rail-section { width: 100%; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .activity-rail-expanded .rail-section { align-items: stretch; }
  .rail-section-toggle { color: var(--color-text-secondary); background: transparent; border: 0; font: inherit; font-size: 10px; cursor: pointer; }
  .rail-section-toggle { box-sizing: border-box; min-width: 0; width: 100%; display: flex; align-items: center; gap: 3px; min-height: 24px; padding: 2px; }
  .rail-section-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; }
  .rail-section-count { opacity: .75; }
  .rail-section-toggle:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: -2px; }
  .rail-catalog-menu { position: fixed; z-index: 2000; display: flex; flex-direction: column; min-width: 190px; max-width: min(360px, 95vw); max-height: 90vh; overflow-y: auto; padding: 4px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-1); box-shadow: var(--shadow-overlay); }
  .rail-catalog-menu button { flex-shrink: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-primary); font: inherit; font-size: 12px; padding: 6px 8px; text-align: left; cursor: pointer; }
  .rail-catalog-menu button:hover, .rail-catalog-menu button:focus-visible { background: var(--color-hover); outline: 2px solid var(--color-focus-ring); outline-offset: -2px; }
  .rail-catalog-menu button:disabled { opacity: .4; cursor: default; }
  .rail-menu-separator { flex-shrink: 0; height: 1px; margin: 4px 2px; background: var(--color-border-subtle); }
  .rail-empty { font-size: 10px; color: var(--color-text-secondary); padding: 4px; }
  .rail-folder-form { position: absolute; top: 40px; left: 8px; z-index: 10; min-width: 220px; max-width: 300px; padding: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); box-shadow: var(--shadow-overlay); display: flex; flex-wrap: wrap; gap: 2px; width: 100%; }
  .rail-folder-form input { min-width: 0; width: 100%; }

  .activity-rail {
    position: relative;
    min-height: 0;
    width: var(--activity-rail-width);
    border-right: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    /* Keep compact items clear of the top border. */
    padding: var(--space-1) var(--space-1);
  }

  .activity-rail-dragging,
  .activity-rail-resizing {
    user-select: none;
  }

  :global([data-file-drop-context].file-drop-context-hover) {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }

  /* Expanded rows share a compact left-aligned column. */
  .activity-rail-expanded {
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
  }

  .rail-workspaces {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .rail-workspaces-expanded {
    align-items: stretch;
    gap: 2px;
  }

  .rail-button {
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard);
  }

  .activity-rail-expanded .rail-button {
    width: 36px;
    height: 36px;
  }

  .rail-button:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .rail-button:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .rail-button-active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-text-primary);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .rail-button-workspace {
    position: relative;
    color: var(--project-color, var(--color-accent));
    font-weight: 600;
  }

  .rail-button-workspace-ghost {
    position: absolute;
    z-index: 2;
    pointer-events: none;
    cursor: grabbing;
    box-shadow: var(--shadow-overlay);
    border-color: var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .rail-workspace-initial {
    font-size: 12px;
    text-transform: uppercase;
  }

  .rail-footer-stack {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .activity-rail-expanded .rail-footer-stack {
    align-items: stretch;
  }

  .rail-button-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .rail-button-manager {
    padding: 0;
  }

  .rail-manager-icon {
    display: block;
  }

  /* ---- Expanded info card ---- */
  .rail-workspace-card {
    width: 100%;
    min-height: 64px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    display: flex;
    align-items: stretch;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-6);
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .rail-workspace-card:hover {
    background: var(--color-hover);
  }

  .rail-workspace-card-active {
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .rail-workspace-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    align-self: flex-start;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  }

  .rail-workspace-info {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rail-workspace-name {
    font-size: var(--font-size-body);
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-workspace-path {
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-workspace-stats {
    margin-top: var(--space-1);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  /* Fixed row height keeps a large catalog easy to scan and scroll. */
  .rail-workspace-row {
    height: 46px;
    min-height: 46px;
    min-width: 0;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
  }
  .rail-workspace-row:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }
  .rail-workspace-row .rail-workspace-avatar {
    width: 26px;
    height: 26px;
    align-self: center;
    color: var(--project-color);
    background: color-mix(in srgb, var(--project-color) 16%, transparent);
  }
  .rail-workspaces :global(.hover-tooltip-anchor) {
    flex-shrink: 0;
    min-width: 0;
    max-width: 100%;
  }
  .rail-workspaces-expanded :global(.hover-tooltip-anchor) { width: 100%; }
  .rail-workspace-heading { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .rail-workspace-heading .rail-workspace-name { min-width: 0; font-size: 12px; }
  .rail-workspace-distinction {
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
    font-size: 10px;
    flex-shrink: 1;
  }
  .rail-workspace-git {
    display: flex;
    gap: 4px;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: 10px;
    line-height: 13px;
  }
  .rail-workspace-git span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rail-workspace-git-mark {
    position: absolute;
    right: 1px;
    bottom: 0;
    font-size: 16px;
    color: var(--color-text-muted);
  }

  /* ---- Expanded tab group card (reuses .rail-workspace-card layout; only the
     avatar and tab-link styling below are tab-group-specific content). ---- */
  .rail-tab-group-avatar {
    /* Group avatars use the same type icon at either sidebar width. */
    text-transform: none;
  }

  /* The min-height that keeps workspace cards uniform is dropped: a tab group
     card grows with the number of listed files instead. */
  .rail-tab-group-card {
    height: auto;
    min-height: 46px;
  }

  /* Open files are a vertical list, not the wrapped stat row the workspace
     cards use: file names are long and wrap badly side by side. */
  .rail-tab-group-tabs {
    margin-top: var(--space-1);
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: 0;
    min-width: 0;
  }

  .rail-tab-group-tab {
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 11px;
    line-height: 1.3;
    text-align: left;
    /* Negative inline margin pulls the hover target's padding back out so the
       file names line up with the "Tabs:" label above them. */
    padding: 1px var(--space-2);
    margin-inline: calc(-1 * var(--space-2));
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard);
  }

  .rail-tab-group-tab:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .rail-tab-group-tab:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .activity-rail-resize-handle:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  .activity-rail-resize-handle {
    padding: 0;
    border: 0;
    background: transparent;
    position: absolute;
    right: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
  }
</style>
