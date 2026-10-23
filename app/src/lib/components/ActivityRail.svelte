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
  import NotepadIcon from "./icons/NotepadIcon.svelte";
  import AddIcon from "./icons/AddIcon.svelte";
  import ListIcon from "./icons/ListIcon.svelte";
  import { getProjectCatalog, projectIdentity, subscribeProjectCatalog, updateOpenWorkspaceCatalog, type CatalogMutation } from "../services/workspaceCatalog";
  import { listen } from '@tauri-apps/api/event';
  import { addWorkspaceToWindow } from '../services/addWorkspaceToWindow';
  import { readLiveWorkspaceWindowOwners, WORKSPACE_PLACEMENT_CHANGED, type WorkspaceWindowOwners } from '../services/workspaceWindowPlacement';
  import { workspaceRailSections, readRailWindowPreferences, writeRailWindowPreferences, type RailProject, type RailSection } from '../services/workspaceRailSections';
  import { clampFixedOverlayPosition } from './clampFixedOverlayPosition';
  import { distinguishingProjectPaths, projectName, projectColor, projectIcon } from "./workspaceRailPresentation";
  import type { RailTabGroup } from "../services/railTabGroups";
  import { removeTabGroupWithConfirm } from "../services/tabGroupCloseFlow";
  import type { GlobalDocument } from "../domain/projectCatalog";
  import {
    GLOBAL_DOCUMENT_KINDS,
    createGlobalDocument,
    deleteGlobalDocument,
    globalDocumentKindLabel,
    globalDocumentsOfKind,
    moveGlobalDocument,
    openGlobalDocument,
    renameGlobalDocument,
  } from "../services/globalDocuments";
  import { requestConfirm } from "../services/confirmDialogUi";
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
  const sections = $derived(workspaceRailSections(catalog, workspaces, owners, currentWindowId, searchQuery));
  const railProjects = $derived(sections.flatMap(section => section.projects));
  // A cold catalog read may finish after mount; restore after its rows exist.
  $effect(() => {
    const id = currentWindowId;
    catalog.revision;
    workspaces.length;
    void tick().then(() => { if (railWorkspacesEl && restoredWindow === id) railWorkspacesEl.scrollTop = readRailWindowPreferences(id).scrollTop; });
  });
  function sectionCollapsed(section: RailSection): boolean { return !searchQuery.trim() && collapsed.includes(section.id); }
  const workspacesForRender = $derived(sections.filter(section => !sectionCollapsed(section)).flatMap(section => section.projects));
  const dragEnabled = $derived(manualOrder && !searchQuery.trim());
  const draggedWorkspace = $derived(railProjects.find(project => project.id === dragState.dragWorkspaceId) ?? null);
  function commit(mutations: CatalogMutation[]) {
    return updateOpenWorkspaceCatalog(workspaces, mutations).catch(error => { onError(String(error)); return null; });
  }
  function selectProject(project: RailProject): void {
    if (project.contextId) onSelectContext(project.contextId);
    else void addWorkspaceToWindow(project.rootPath).catch(error => onError(String(error)));
    closeMenu();
  }
  function sectionForProject(id: string): RailSection | undefined { return sections.find(section => section.projects.some(project => project.id === id)); }
  function moveToSection(project: RailProject, section: RailSection, beforeId: string | null = null): void {
    const windowId = currentWindowId;
    const movedToFolder = !!section.folderId && sectionForProject(project.id)?.id !== section.id;
    void commit([{ type: 'moveProject', id: project.id, ...(section.pinned ? { pinned: true } : { folderId: section.folderId, pinned: false }), beforeId }]).then(next => {
      if (!next || !movedToFolder || currentWindowId !== windowId || !collapsed.includes(section.id)) return;
      const destination = workspaceRailSections(next, workspaces, owners, windowId).find(entry => entry.id === section.id);
      if (destination?.projects.length !== 1 || destination.projects[0].id !== project.id) return;
      collapsed = collapsed.filter(id => id !== section.id);
      saveRailPreferences();
    });
  }
  function reorderProject(project: RailProject, direction: -1 | 1): void {
    const section = sectionForProject(project.id); if (!section || !dragEnabled) return;
    const index = section.projects.findIndex(entry => entry.id === project.id);
    if (index + direction < 0 || index + direction >= section.projects.length) return;
    const beforeId = direction < 0 ? section.projects[index - 1].id : section.projects[index + 2]?.id ?? null;
    moveToSection(project, section, beforeId); closeMenu();
  }
  function dropProject(id: string, x: number, y: number): void {
    if (!dragEnabled) return;
    const project = railProjects.find(project => project.id === id); if (!project) return;
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-rail-section]');
    const section = sections.find(section => section.id === target?.dataset.railSection); if (!section) return;
    const nodes = [...target!.querySelectorAll<HTMLElement>('[data-workspace-id]')].filter(node => node.dataset.workspaceId !== id);
    const before = nodes.find(node => { const rect = node.getBoundingClientRect(); return y < rect.top + rect.height / 2; });
    moveToSection(project, section, before?.dataset.workspaceId ?? null);
  }
  function toggleSection(section: RailSection): void {
    collapsed = collapsed.includes(section.id) ? collapsed.filter(id => id !== section.id) : [...collapsed, section.id];
    saveRailPreferences();
  }
  type RailMenuTarget = { project?: RailProject; section?: RailSection; projectsOnly?: boolean; tabGroup?: RailTabGroup; globalDocument?: GlobalDocument };
  let menu = $state<(RailMenuTarget & { x: number; y: number }) | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let menuTrigger: HTMLElement | null = null;
  // Suppress every workspace tooltip while any rail menu is open so the
  // tooltip never overlaps the menu.
  const workspaceTooltipSuppressed = $derived(menu !== null);
  function closeMenu(): void { if (!menu) return; const trigger = menuTrigger; menu = null; void tick().then(() => trigger?.focus()); }
  function openMenu(event: MouseEvent | KeyboardEvent, value: RailMenuTarget): void {
    event.preventDefault();
    menuTrigger = event.currentTarget as HTMLElement;
    const rect = menuTrigger.getBoundingClientRect();
    menu = { ...value, x: event instanceof MouseEvent && event.clientX ? event.clientX : rect.right,
      y: event instanceof MouseEvent && event.clientY ? event.clientY : rect.top };
    void tick().then(() => menuEl?.querySelector<HTMLElement>('button,input')?.focus());
  }
  function windowPointerDown(event: PointerEvent): void { if (menu && !menuEl?.contains(event.target as Node)) menu = null; }
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
  let entityEdit = $state<{ kind: EntityKind; id: string | null } | null>(null);
  function entityLabel(kind: EntityKind): string { return kind === 'tabGroup' ? 'Tab group' : globalDocumentKindLabel(kind); }
  function editEntity(kind: EntityKind, id: string | null, name = ''): void {
    entityName = name; entityEdit = { kind, id }; menu = null;
    void tick().then(() => activityRailEl?.querySelector<HTMLInputElement>('.rail-entity-form input')?.focus());
  }
  async function saveEntity(): Promise<void> {
    const edit = entityEdit; const name = entityName.trim();
    if (!edit || !name) return;
    entityEdit = null;
    try {
      if (edit.kind === 'tabGroup') {
        if (edit.id) appState.renameTabGroup(edit.id as ContextId, name); else appState.createTabGroup(name);
      } else if (edit.id) {
        await renameGlobalDocument(edit.id, name);
      } else {
        const document = await createGlobalDocument(edit.kind, name);
        openGlobalDocument(document.id);
      }
    } catch (error) { onError(String(error)); }
  }
  function runEntityAction(action: () => unknown): void {
    menu = null;
    void Promise.resolve().then(action).catch(error => onError(String(error)));
  }
  async function confirmDeleteGlobalDocument(document: GlobalDocument): Promise<void> {
    if (!await requestConfirm({ title: `Delete ${globalDocumentKindLabel(document.kind)}`,
      message: `Delete "${document.name}"? Its file is removed and this cannot be undone.`,
      confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true })) return;
    await deleteGlobalDocument(document.id);
  }
  const globalDocumentSections = $derived(GLOBAL_DOCUMENT_KINDS.map(kind => ({ kind, documents: globalDocumentsOfKind(catalog, kind) })));
  const activeGlobalDocumentId = $derived.by(() => {
    if (!isTabGroupId(activeContextId)) return null;
    const layout = $appActiveSession.editorLayout;
    const pane = layout.panes.find(entry => entry.id === layout.activePaneId);
    const tab = pane?.tabs.find(entry => entry.id === pane.selectedTabId);
    return tab?.kind === 'view' ? tab.globalDocumentId ?? null : null;
  });
  function togglePinned(project: RailProject): void {
    commit([{ type: 'moveProject', id: project.id, pinned: !project.pinned }]);
  }
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
  let draggedFolder = $state<string | null>(null);
  function dropFolder(event: DragEvent, section: RailSection): void {
    event.preventDefault();
    if (dragEnabled && draggedFolder && section.folderId && draggedFolder !== section.folderId) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const folders = sections.filter(section => section.folderId);
      const index = folders.findIndex(folder => folder.id === section.id);
      const beforeId = event.clientY > rect.top + rect.height / 2 ? folders[index + 1]?.folderId ?? null : section.folderId;
      commit([{ type: 'moveFolder', id: draggedFolder, beforeId }]);
    }
    draggedFolder = null;
  }
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

  const dragController = createWorkspaceRailDragController({
    getWorkspaces: () => workspacesForRender,
    getRailWorkspacesEl: () => railWorkspacesEl,
    getActivityRailEl: () => activityRailEl,
    onSelect: (id) => { const project = railProjects.find(project => project.id === id); if (project) selectProject(project); },
    onReorder: (fromIndex, toIndex) => onReorderWorkspaces(fromIndex, toIndex),
    onDrop: dropProject,
    onStateChange: (nextState) => {
      dragState = nextState;
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
  function workspaceKeydown(event: KeyboardEvent, workspace: RailProject): void {
    if (event.key === 'Escape' && searchQuery) { event.preventDefault(); event.stopPropagation(); searchQuery = ''; return; }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); const rows = [...(railWorkspacesEl?.querySelectorAll<HTMLButtonElement>('[data-workspace-id]') ?? [])];
      const index = rows.indexOf(event.currentTarget as HTMLButtonElement); rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, { project: workspace });
    else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); if (dragEnabled) reorderProject(workspace, event.key === 'ArrowUp' ? -1 : 1);
    }
  }
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

<svelte:window onpointerdown={windowPointerDown} onkeydown={(event) => { if (menu && event.key === "Escape") closeMenu(); }} />

<aside
  class={`activity-rail${expanded ? " activity-rail-expanded" : ""}${isResizing ? " activity-rail-resizing" : ""}`}
  aria-label="Activity rail"
  bind:this={activityRailEl}
  style={`width:${displayWidth}px`}
>
  <section class="rail-section rail-entity-section" aria-label="Tab groups">
    <div class="rail-section-heading rail-entity-heading">
      {#if expanded}<span class="rail-section-name rail-entity-title">Tab groups</span>{/if}
      <button type="button" class="rail-section-more rail-entity-add" aria-label="New tab group" title="New tab group"
        onclick={() => editEntity('tabGroup', null)}>+</button>
    </div>
    {#each tabGroups as group (group.id)}
      {@const active = activeContextId === group.id}
      {#if expanded}
        <button
          class={`rail-workspace-card rail-tab-group-card ${active ? "rail-workspace-card-active" : ""}`}
          data-file-drop-context={group.id}
          data-tab-group-drop={group.id}
          data-tab-group-id={group.id}
          type="button"
          aria-label={`Tab group ${group.name}, ${group.tabCount} tabs`}
          aria-current={active ? "true" : undefined}
          onclick={() => onSelectContext(group.id)}
          oncontextmenu={(event) => openMenu(event, { tabGroup: group })}
          onkeydown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, { tabGroup: group }); }}
        >
          <span class="rail-workspace-avatar rail-tab-group-avatar" aria-hidden="true">
            {#if group.id === DEFAULT_TAB_GROUP_ID}<NotepadIcon size={16} />{:else}{group.name.trim().charAt(0).toUpperCase() || "#"}{/if}
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
            type="button"
            aria-label={`Tab group ${group.name}, ${group.tabCount} tabs`}
            aria-current={active ? "true" : undefined}
            onclick={() => onSelectContext(group.id)}
            oncontextmenu={(event) => openMenu(event, { tabGroup: group })}
          >
            {#if group.id === DEFAULT_TAB_GROUP_ID}<NotepadIcon size={16} />{:else}<span class="rail-workspace-initial">{group.name.trim().charAt(0).toUpperCase() || "#"}</span>{/if}
          </button>
        </HoverTooltip>
      {/if}
    {/each}
  </section>

  {#each globalDocumentSections as section (section.kind)}
    {@const label = globalDocumentKindLabel(section.kind)}
    <section class="rail-section rail-entity-section" aria-label={label}>
      <div class="rail-section-heading rail-entity-heading">
        {#if expanded}<span class="rail-section-name rail-entity-title">{label}</span>{/if}
        <button type="button" class="rail-section-more rail-entity-add" aria-label={`New ${label}`} title={`New ${label}`}
          onclick={() => editEntity(section.kind, null)}>+</button>
      </div>
      {#each section.documents as document (document.id)}
        {@const active = activeGlobalDocumentId === document.id}
        <HoverTooltip label={document.name} suppress={workspaceTooltipSuppressed || expanded}>
          <button type="button"
            class={expanded ? `global-document-link ${active ? "global-document-link-active" : ""}` : `rail-button ${active ? "rail-button-active" : ""}`}
            data-global-document-id={document.id}
            aria-label={`${label} ${document.name}`}
            aria-current={active ? "true" : undefined}
            onclick={() => { openGlobalDocument(document.id); }}
            oncontextmenu={(event) => openMenu(event, { globalDocument: document })}
            onkeydown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, { globalDocument: document }); }}>
            <span aria-hidden="true">{section.kind === "tasks" ? "☑" : "▤"}</span>{#if expanded}<span class="global-document-name">{document.name}</span>{/if}
          </button>
        </HoverTooltip>
      {/each}
    </section>
  {/each}
  {#if entityEdit}
    <form class="rail-folder-form rail-entity-form" onsubmit={(event) => { event.preventDefault(); void saveEntity(); }}>
      <input aria-label={`${entityLabel(entityEdit.kind)} name`} placeholder={`${entityLabel(entityEdit.kind)} name`} bind:value={entityName}
        onkeydown={(event) => { if (event.key === 'Escape') entityEdit = null; }} />
      <button type="submit" disabled={!entityName.trim()}>{entityEdit.id ? 'Rename' : 'Create'}</button><button type="button" onclick={() => entityEdit = null}>Cancel</button>
    </form>
  {/if}

  {#if !expanded}<button type="button" class="rail-button" aria-label="Search workspaces" title="Search workspaces" onclick={() => { railSearchOpen = !railSearchOpen; void tick().then(() => railSearchInput?.focus()); }}>⌕</button>{/if}
  {#if expanded || railSearchOpen}
    <input bind:this={railSearchInput} class="rail-search" class:rail-search-compact={!expanded} aria-label="Search workspaces" placeholder="Search name or path…" bind:value={searchQuery}
      onkeydown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); searchQuery = ''; railSearchOpen = false; }
        if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); railWorkspacesEl?.querySelector<HTMLButtonElement>('[data-workspace-id]')?.focus(); }
      }} />
  {/if}
  {#if folderEdit}
    <form class="rail-folder-form" onsubmit={(event) => { event.preventDefault(); saveFolder(); }}>
      <input aria-label="Folder name" bind:value={folderName} onkeydown={(event) => { if (event.key === 'Escape') folderEdit = null; }} />
      <button type="submit" disabled={!folderName.trim()}>Save</button><button type="button" onclick={() => folderEdit = null}>Cancel</button>
    </form>
  {/if}
  <div class={`rail-workspaces${expanded ? " rail-workspaces-expanded" : ""}`} bind:this={railWorkspacesEl} onscroll={saveRailPreferences}>
    {#if railProjects.length === 0}<p class="rail-empty" role="status">{searchQuery.trim() ? 'No matching projects' : 'No projects in the sidebar'}</p>{/if}
    {#each sections.filter(section => !searchQuery.trim() || section.projects.length > 0) as section (section.id)}
      <section class="rail-section" data-rail-section={section.id} aria-label={`${section.name}, ${section.projects.length} projects`}>
        <div class="rail-section-heading">
          <button class="rail-section-toggle" type="button" aria-label={`${section.name}, ${section.projects.length} projects`}
            aria-expanded={!sectionCollapsed(section)} title={`${section.name} (${section.projects.length})`}
            draggable={dragEnabled && !!section.folderId}
            ondragstart={(event) => { draggedFolder = section.folderId; event.dataTransfer?.setData('text/plain', section.folderId ?? ''); }}
            ondragend={() => draggedFolder = null}
            ondragover={(event) => { if (dragEnabled && draggedFolder && section.folderId) event.preventDefault(); }}
            ondrop={(event) => dropFolder(event, section)}
            oncontextmenu={(event) => openMenu(event, { section })}
            onkeydown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, { section }); }}
            onclick={(event) => { if (!expanded && sectionCollapsed(section)) openMenu(event, { section, projectsOnly: true }); else toggleSection(section); }}>
            <span aria-hidden="true">{sectionCollapsed(section) ? '▸' : '▾'}</span>
            {#if expanded}<span class="rail-section-name">{section.name}</span>{:else}<span aria-hidden="true">{section.pinned ? '★' : section.folderId ? '▣' : '·'}</span>{/if}
            <span class="rail-section-count">{section.projects.length}</span>
          </button>
          {#if expanded}<button type="button" class="rail-section-more" aria-label={`Actions for ${section.name}`} onclick={(event) => openMenu(event, { section })}>…</button>{/if}
        </div>
        {#if !sectionCollapsed(section)}
    {#each section.projects as workspace (workspace.id)}
        <div class="rail-project-entry" class:rail-project-dragging={dragState.didDrag && workspace.id === dragState.dragWorkspaceId} use:observeGitRow={workspace.rootPath}>
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
            type="button"
            aria-label={`Workspace ${workspaceName(workspace)}, ${workspace.rootPath}, ${gitFor(workspace.rootPath).detail}`}
            aria-current={activeContextId === workspace.contextId ? "true" : undefined}
            oncontextmenu={(event) => {
              event.preventDefault();
              openMenu(event, { project: workspace });
            }}
            onkeydown={(event) => workspaceKeydown(event, workspace)}
            onpointerdown={(event) => {
              if (dragEnabled) dragController.pointerDown(event, workspace,
                workspacesForRender.findIndex((entry) => entry.id === workspace.id));
            }}
            onclick={(event) => {
              // Pointer selection is committed by the drag controller; native
              // keyboard and assistive clicks have no pointer sequence.
              if (!dragEnabled || event.detail === 0) selectProject(workspace);
            }}
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
        <button class="rail-pin-action" class:rail-pin-action-pinned={workspace.pinned} type="button"
          aria-label={`${workspace.pinned ? 'Unpin' : 'Pin'} ${workspaceName(workspace)}`} aria-pressed={workspace.pinned}
          title={workspace.pinned ? 'Unpin' : 'Pin'} onclick={() => togglePinned(workspace)}>{workspace.pinned ? '★' : '☆'}</button>
        </div>
    {/each}
        {/if}
      </section>
    {/each}
    {#if railProjects.length === 0}<p class="rail-empty">{searchQuery.trim() ? 'No matching projects' : 'No projects'}</p>{/if}
  </div>

  {#if dragState.didDrag && draggedWorkspace}
    <button
      class="rail-button rail-button-workspace rail-button-workspace-ghost"
      type="button"
      aria-hidden="true"
      tabindex="-1"
      style:--project-color={workspaceColor(draggedWorkspace) ?? "var(--color-accent)"}
      style={`left:${ghostLeft}px; top:${ghostTop}px; width:${dragState.dragWorkspaceRect?.width ?? 32}px; height:${dragState.dragWorkspaceRect?.height ?? 32}px;`}
    >
      <span class="rail-workspace-initial">{workspaceInitial(draggedWorkspace)}</span>
    </button>
  {/if}

  <div class="rail-footer-stack">
    <HoverTooltip label="Refresh visible Git summaries"><button class="rail-button" type="button" aria-label="Refresh visible Git summaries"
      disabled={gitRefreshBusy || visibleGitPaths.size === 0} onclick={() => void refreshVisibleGit()}>↻</button></HoverTooltip>
    <HoverTooltip label="Create folder"><button class="rail-button" type="button" aria-label="Create folder" onclick={() => editFolder(null)}>▣+</button></HoverTooltip>
    <HoverTooltip label="Add Workspace">
      <button
        class="rail-button rail-button-add"
        type="button"
        aria-label="Add Workspace"
        onclick={onAddWorkspace}
      >
        <AddIcon size={16} />
      </button>
    </HoverTooltip>
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
    aria-label="Resize workspaces sidebar"
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
  <div class="rail-catalog-menu" role="menu" tabindex="-1" aria-label="Workspace organization" bind:this={menuEl}
    style={`left:${menu.x}px;top:${menu.y}px`} onkeydown={menuKeydown}>
    {#if menu.project}
      {@const project = menu.project}
      {@const contextId = project.contextId}
      {#if !contextId}
        <button type="button" role="menuitem" onclick={() => selectProject(project)}>Open Workspace</button>
      {:else}
        {#if onOpenSettings}<button type="button" role="menuitem" onclick={() => runWorkspaceAction(contextId, onOpenSettings)}>Settings</button>{/if}
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
      {#if gitIntegrationEnabled}<button type="button" role="menuitem" onclick={() => void openProjectVersionControl(project)}>Version Control</button>{/if}
      <button type="button" role="menuitem" onclick={() => void copyProjectPath(project)}>Copy Path</button>
      <div class="rail-menu-separator" role="separator"></div>
      <button type="button" role="menuitem" onclick={() => { commit([{ type: 'updateProject', id: project.id, patch: { hiddenFromRail: true } }]); closeMenu(); }}>Hide from Sidebar</button>
      {#if contextId && onCloseWorkspace}<button type="button" role="menuitem" onclick={() => runWorkspaceAction(contextId, onCloseWorkspace)}>Close Workspace</button>{/if}
    {:else if menu.tabGroup}
      {@const group = menu.tabGroup}
      <button type="button" role="menuitem" onclick={() => editEntity('tabGroup', group.id, group.name)}>Rename</button>
      <button type="button" role="menuitem" disabled={group.id === DEFAULT_TAB_GROUP_ID}
        title={group.id === DEFAULT_TAB_GROUP_ID ? 'The default tab group cannot be deleted' : undefined}
        onclick={() => runEntityAction(() => removeTabGroupWithConfirm(group.id, onError))}>Delete</button>
    {:else if menu.globalDocument}
      {@const document = menu.globalDocument}
      {@const siblings = globalDocumentsOfKind(catalog, document.kind)}
      {@const index = siblings.findIndex(entry => entry.id === document.id)}
      <button type="button" role="menuitem" onclick={() => runEntityAction(() => openGlobalDocument(document.id))}>Open</button>
      <button type="button" role="menuitem" onclick={() => editEntity(document.kind, document.id, document.name)}>Rename</button>
      <button type="button" role="menuitem" disabled={index <= 0} onclick={() => runEntityAction(() => moveGlobalDocument(document.id, -1))}>Move Up</button>
      <button type="button" role="menuitem" disabled={index < 0 || index >= siblings.length - 1} onclick={() => runEntityAction(() => moveGlobalDocument(document.id, 1))}>Move Down</button>
      <div class="rail-menu-separator" role="separator"></div>
      <button type="button" role="menuitem" onclick={() => runEntityAction(() => confirmDeleteGlobalDocument(document))}>Delete</button>
    {:else if menu.section}
      {@const section = menu.section}
      {#if menu.projectsOnly}
        {#each section.projects as project (project.id)}<button type="button" role="menuitem" title={project.rootPath} onclick={() => selectProject(project)}>{project.name}</button>{/each}
      {/if}
      <button type="button" role="menuitem" onclick={() => { toggleSection(section); closeMenu(); }}>{sectionCollapsed(section) ? 'Expand' : 'Collapse'}</button>
      {#if section.folderId}
        <button type="button" role="menuitem" onclick={() => editFolder(section.folderId)}>Rename folder</button>
        <button type="button" role="menuitem" onclick={() => { commit([{ type: 'removeFolder', id: section.folderId! }]); closeMenu(); }}>Delete folder (keep projects)</button>
      {/if}
      <button type="button" role="menuitem" onclick={() => editFolder(null)}>Create folder</button>
    {/if}
  </div>
{/if}

<style>
  .global-document-link { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; color: var(--color-text-primary); background: transparent; border: 0; border-radius: 5px; cursor: pointer; text-align: left; font: inherit; }
  .global-document-link:hover { background: var(--color-hover); }
  .global-document-link-active { background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
  .global-document-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rail-entity-section { gap: 2px; }
  .rail-entity-heading { justify-content: center; min-height: 22px; }
  .activity-rail-expanded .rail-entity-heading { justify-content: space-between; padding: 0 2px 0 6px; }
  .rail-entity-title { font-size: 10px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: .04em; }
  .rail-entity-add { font-size: 14px; line-height: 1; padding: 2px 6px; border-radius: var(--radius-sm); }
  .rail-entity-add:hover { background: var(--color-hover); color: var(--color-text-primary); }
  .rail-project-entry { position: relative; width: 100%; flex-shrink: 0; }
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
  .rail-section-heading { display: flex; width: 100%; align-items: center; min-width: 0; }
  .rail-section-toggle, .rail-section-more { color: var(--color-text-secondary); background: transparent; border: 0; font: inherit; font-size: 10px; cursor: pointer; }
  .rail-section-toggle { min-width: 0; width: 100%; display: flex; align-items: center; gap: 3px; min-height: 24px; padding: 2px; }
  .rail-section-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; }
  .rail-section-count { opacity: .75; }
  .rail-section-toggle:focus-visible, .rail-section-more:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: -2px; }
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
    /* Collapsed mode: a small 2px top offset keeps the first tab group button off the
       top border; a tight gap keeps its divider near the editor tab-bar bottom
       line (~var(--tab-header-height) down the rail). Expanded mode overrides
       these below. */
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

  /* Expanded rail behaves like a column panel: left-aligned content, room for
     the wider info cards. Top padding + gap are kept tight so the tab group
     region stays compact. */
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
    /* The default group's avatar holds an icon, not initials — keep it centered. */
    text-transform: none;
  }

  /* The min-height that keeps workspace cards uniform is dropped: a tab group
     card grows with the number of listed files instead. */
  .rail-tab-group-card {
    min-height: 0;
    padding-top: var(--space-1);
    padding-bottom: var(--space-2);
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
