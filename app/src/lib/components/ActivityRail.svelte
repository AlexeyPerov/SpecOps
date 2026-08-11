<script lang="ts">
  import { onDestroy } from "svelte";
  import HoverTooltip from "./HoverTooltip.svelte";
  import {
    allTabs,
    type ContextId,
    type WorkspaceEntry,
  } from "../domain/contracts";
  import { chatSessionCountsByRoot } from "../state/chatStore";
  import {
    createWorkspaceRailDragController,
    previewWorkspaces,
    type WorkspaceDragState,
  } from "./workspaceRailDragController";
  import {
    DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
    isActivityRailExpanded,
    normalizeActivityRailWidthPx,
  } from "../services/panelLayout";
  import { startPointerDrag } from "./pointerDrag";
  import NotepadIcon from "./icons/NotepadIcon.svelte";
  import AddIcon from "./icons/AddIcon.svelte";
  import ListIcon from "./icons/ListIcon.svelte";

  /** A notepad tab shown in the expanded notepad card's "last opened" list. */
  export interface NotepadRailTab {
    tabId: string;
    label: string;
  }

  interface Props {
    workspaces?: WorkspaceEntry[];
    activeContextId?: ContextId;
    /**
     * Whether the OpenCode workspace-sessions beta is enabled. When false the
     * per-workspace "Sessions" count is hidden from expanded rail cards (the
     * sessions backend is inactive).
     */
    opencodeEnabled?: boolean;
    /** Resizable rail width (compact 48px → expanded cards). */
    panelWidthPx?: number;
    /** Number of currently-open tabs in the notepad context. */
    notepadOpenTabCount?: number;
    /** Last opened notepad tabs (append order), already formatted. */
    notepadRecentTabs?: NotepadRailTab[];
    /**
     * When non-null a workspace context menu is open for that workspace id.
     * Workspace tooltips are suppressed while any menu is open so the tooltip
     * never overlaps the menu, and a longer delay (2× default) keeps the
     * workspace tooltips from flickering up on quick hover.
     */
    contextMenuWorkspaceId?: ContextId | null;
    onSelectContext?: (contextId: ContextId) => void;
    onAddWorkspace?: () => void;
    onOpenWorkspaceManager?: () => void;
    onPanelWidthChange?: (width: number) => void;
    onRequestCloseWorkspace?: (workspaceId: ContextId, x: number, y: number) => void;
    onReorderWorkspaces?: (fromIndex: number, toIndex: number) => void;
    /** Switches to notepad and selects the given tab id. */
    onSelectNotepadTab?: (tabId: string) => void;
  }

  let {
    workspaces = [],
    activeContextId = "notepad",
    opencodeEnabled = false,
    panelWidthPx = DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
    notepadOpenTabCount = 0,
    notepadRecentTabs = [],
    contextMenuWorkspaceId = null,
    onSelectContext = () => {},
    onAddWorkspace = () => {},
    onOpenWorkspaceManager = () => {},
    onPanelWidthChange = () => {},
    onRequestCloseWorkspace = () => {},
    onReorderWorkspaces = () => {},
    onSelectNotepadTab = () => {},
  }: Props = $props();

  let activityRailEl: HTMLElement | null = null;
  let railWorkspacesEl: HTMLDivElement | null = null;
  let displayWidth = $state(DEFAULT_ACTIVITY_RAIL_WIDTH_PX);
  let isResizing = $state(false);
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

  // Suppress every workspace tooltip while any workspace context menu is open
  // so the tooltip never overlaps the menu.
  const workspaceTooltipSuppressed = $derived(contextMenuWorkspaceId !== null);

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

  const dragEnabled = $derived(workspaces.length > 1);
  const workspacesForRender = $derived(
    previewWorkspaces(
      workspaces,
      dragState.didDrag,
      dragState.dragFromIndex,
      dragState.dropIndex,
    ),
  );
  const draggedWorkspace = $derived(
    dragState.dragWorkspaceId
      ? (workspaces.find((workspace) => workspace.id === dragState.dragWorkspaceId) ?? null)
      : null,
  );
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
    getWorkspaces: () => workspaces,
    getRailWorkspacesEl: () => railWorkspacesEl,
    getActivityRailEl: () => activityRailEl,
    onSelect: (workspaceId) => onSelectContext(workspaceId),
    onReorder: (fromIndex, toIndex) => onReorderWorkspaces(fromIndex, toIndex),
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

  function workspaceName(workspace: WorkspaceEntry): string {
    const normalized = workspace.rootPath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || workspace.rootPath;
  }

  function workspaceInitial(workspace: WorkspaceEntry): string {
    const name = workspaceName(workspace).trim();
    return (name[0] ?? "?").toUpperCase();
  }

  function workspacePath(workspace: WorkspaceEntry): string {
    return workspace.rootPath;
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

<aside
  class={`activity-rail${expanded ? " activity-rail-expanded" : ""}${isResizing ? " activity-rail-resizing" : ""}`}
  aria-label="Activity rail"
  bind:this={activityRailEl}
  style={`width:${displayWidth}px`}
>
  {#if expanded}
    <button
      class={`rail-workspace-card ${activeContextId === "notepad" ? "rail-workspace-card-active" : ""}`}
      type="button"
      aria-label="Notepad"
      onclick={() => onSelectContext("notepad")}
    >
      <span class="rail-workspace-avatar rail-notepad-avatar"><NotepadIcon size={16} /></span>
      <span class="rail-workspace-info">
        <span class="rail-workspace-name">Notepad</span>
        <span class="rail-workspace-path">Tabs: {notepadOpenTabCount}</span>
        {#if notepadRecentTabs.length > 0}
          <span class="rail-workspace-stats">
            {#each notepadRecentTabs as tab (tab.tabId)}
              <!-- Nested interactive trigger inside the card button: a span with
                   role=button (nested <button>/<a> are invalid here). -->
              <span
                class="rail-notepad-tab"
                role="button"
                tabindex="0"
                title={tab.label}
                onclick={(event) => {
                  event.stopPropagation();
                  onSelectNotepadTab(tab.tabId);
                }}
                onkeydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectNotepadTab(tab.tabId);
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
    <HoverTooltip label="Notepad">
      <button
        class={`rail-button rail-button-notepad ${activeContextId === "notepad" ? "rail-button-active" : ""}`}
        type="button"
        aria-label="Notepad"
        onclick={() => onSelectContext("notepad")}
      >
        <NotepadIcon size={16} />
      </button>
    </HoverTooltip>
  {/if}

  <div class={`rail-workspaces${expanded ? " rail-workspaces-expanded" : ""}`} bind:this={railWorkspacesEl}>
    {#each workspacesForRender as workspace (workspace.id)}
      {@const counts = {
        sessions: sessionCountsByRoot.get(workspace.rootPath) ?? 0,
        tabs: tabCountsByRoot.get(workspace.rootPath) ?? 0,
      }}
      {#if dragState.didDrag && workspace.id === dragState.dragWorkspaceId}
        <span
          class="rail-workspace-placeholder"
          style={`width:${dragState.dragWorkspaceRect?.width ?? 32}px; height:${dragState.dragWorkspaceRect?.height ?? 32}px;`}
        ></span>
      {:else if expanded}
        <HoverTooltip
          label={workspaceName(workspace)}
          detail={workspace.rootPath}
          delayMs={WORKSPACE_TOOLTIP_DELAY_MS}
          suppress={workspaceTooltipSuppressed}
        >
          <button
            class={`rail-workspace-card ${activeContextId === workspace.id ? "rail-workspace-card-active" : ""}`}
            data-workspace-id={workspace.id}
            type="button"
            aria-label={`Workspace ${workspaceName(workspace)}`}
            oncontextmenu={(event) => {
              event.preventDefault();
              onRequestCloseWorkspace(workspace.id, event.clientX, event.clientY);
            }}
            onpointerdown={(event) => {
              if (!dragEnabled) {
                return;
              }
              dragController.pointerDown(
                event,
                workspace,
                workspaces.findIndex((entry) => entry.id === workspace.id),
              );
            }}
            onclick={() => {
              if (!dragEnabled) {
                onSelectContext(workspace.id);
              }
            }}
          >
            <span class="rail-workspace-avatar">{workspaceInitial(workspace)}</span>
            <span class="rail-workspace-info">
              <span class="rail-workspace-name" title={workspacePath(workspace)}>{workspaceName(workspace)}</span>
              <span class="rail-workspace-path" title={workspacePath(workspace)}>{workspacePath(workspace)}</span>
              <span class="rail-workspace-stats">
                {#if opencodeEnabled}
                  <span class="rail-workspace-stat">Sessions: {counts.sessions}</span>
                {/if}
                <span class="rail-workspace-stat">Tabs: {counts.tabs}</span>
              </span>
            </span>
          </button>
        </HoverTooltip>
      {:else}
        <HoverTooltip
          label={workspaceName(workspace)}
          detail={workspace.rootPath}
          delayMs={WORKSPACE_TOOLTIP_DELAY_MS}
          suppress={workspaceTooltipSuppressed}
        >
          <button
            class={`rail-button rail-button-workspace ${activeContextId === workspace.id ? "rail-button-active" : ""}`}
            data-workspace-id={workspace.id}
            type="button"
            aria-label={`Workspace ${workspaceName(workspace)}`}
            oncontextmenu={(event) => {
              event.preventDefault();
              onRequestCloseWorkspace(workspace.id, event.clientX, event.clientY);
            }}
            onpointerdown={(event) => {
              if (!dragEnabled) {
                return;
              }
              dragController.pointerDown(
                event,
                workspace,
                workspaces.findIndex((entry) => entry.id === workspace.id),
              );
            }}
            onclick={() => {
              if (!dragEnabled) {
                onSelectContext(workspace.id);
              }
            }}
          >
            <span class="rail-workspace-initial">{workspaceInitial(workspace)}</span>
          </button>
        </HoverTooltip>
      {/if}
    {/each}
  </div>

  {#if dragState.didDrag && draggedWorkspace}
    <button
      class="rail-button rail-button-workspace rail-button-workspace-ghost"
      type="button"
      aria-hidden="true"
      tabindex="-1"
      style={`left:${ghostLeft}px; top:${ghostTop}px; width:${dragState.dragWorkspaceRect?.width ?? 32}px; height:${dragState.dragWorkspaceRect?.height ?? 32}px;`}
    >
      <span class="rail-workspace-initial">{workspaceInitial(draggedWorkspace)}</span>
    </button>
  {/if}

  <div class="rail-footer-stack">
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
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize workspaces sidebar"
    onpointerdown={handleResizeStart}
  ></div>
</aside>

<style>
  .activity-rail {
    position: relative;
    width: var(--activity-rail-width);
    border-right: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    /* Collapsed mode: a small 2px top offset keeps the Notepad button off the
       top border; a tight gap keeps its divider near the editor tab-bar bottom
       line (~var(--tab-header-height) down the rail). Expanded mode overrides
       these below. */
    padding: var(--space-1) var(--space-1);
  }

  .activity-rail-dragging,
  .activity-rail-resizing {
    user-select: none;
  }

  /* Expanded rail behaves like a column panel: left-aligned content, room for
     the wider info cards. Top padding + gap are kept tight so the notepad card
     region stays compact and its divider lands near the editor tab-bar bottom
     line (~var(--tab-header-height)). */
  .activity-rail-expanded {
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-6);
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
    gap: var(--space-2);
  }

  .rail-workspace-placeholder {
    flex-shrink: 0;
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

  .rail-button-chat {
    padding: 0;
  }

  .rail-chat-icon {
    display: block;
  }

  .rail-button-workspace {
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

  .rail-workspace-stat {
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-text-secondary);
  }

  /* ---- Expanded notepad card (reuses .rail-workspace-card layout; only the
     avatar icon and tab-link styling below are notepad-specific content). ---- */
  .rail-notepad-avatar {
    /* The notepad avatar holds an icon, not initials — keep it centered. */
    text-transform: none;
  }

  .rail-notepad-tab {
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 11px;
    line-height: 1.3;
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard);
  }

  .rail-notepad-tab:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .rail-notepad-tab:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .activity-rail-resize-handle {
    position: absolute;
    right: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
  }
</style>
