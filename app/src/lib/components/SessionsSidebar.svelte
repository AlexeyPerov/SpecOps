<script lang="ts">
  import "../styles/sessions-sidebar.css";
  import type { SessionIndexEntry } from "../domain/contracts";
  import {
    SESSION_DATE_GROUP_LABELS,
    SESSION_DATE_GROUP_ORDER,
    DRAFT_SESSION_TITLE,
    filterSessionsByTitle,
    groupSessionsByLastUsedDate,
    type SessionDateGroup,
  } from "../services/chatSessions";
  import {
    createSessionsSidebarController,
    syncSessionsSidebarDisplayWidth,
  } from "../services/sessionsSidebarController";
  import { DEFAULT_PANEL_WIDTH_PX } from "../services/panelLayout";
  import SessionSidebarRow from "./SessionSidebarRow.svelte";

  interface Props {
    sessions?: SessionIndexEntry[];
    activeSessionId?: string | null;
    sidebarTitle?: string;
    collapsed?: boolean;
    panelWidthPx?: number;
    onPanelWidthChange?: (width: number) => void;
    onToggleCollapsed?: (next: boolean) => void;
    onSelectSession?: (sessionId: string) => void;
    onNewSession?: () => void;
    onDeleteSession?: (sessionId: string) => void;
    /** M2-T1: rename the session tab + linked session. */
    onRenameSession?: (sessionId: string) => void | Promise<void>;
    /** M2-T5: copy a public share URL for the linked session. */
    onShareSession?: (sessionId: string) => void | Promise<void>;
    /** M2-T7: export the transcript to a Markdown file. */
    onExportSession?: (sessionId: string) => void | Promise<void>;
    /** M2-T2: open the unified per-workspace session list panel. */
    onOpenSessions?: () => void | Promise<void>;
  }

  let {
    sessions = [],
    activeSessionId = null,
    sidebarTitle = "Sessions",
    collapsed = false,
    panelWidthPx = DEFAULT_PANEL_WIDTH_PX,
    onPanelWidthChange = () => {},
    onToggleCollapsed = () => {},
    onSelectSession = () => {},
    onNewSession = () => {},
    onDeleteSession = () => {},
    onRenameSession = () => {},
    onShareSession = () => {},
    onExportSession = () => {},
    onOpenSessions = () => {},
  }: Props = $props();

  let searchQuery = $state("");
  let displayWidth = $state(DEFAULT_PANEL_WIDTH_PX);
  let isResizing = $state(false);
  let contextMenu = $state<{ sessionId: string; x: number; y: number } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | null>(null);

  const sidebarController = createSessionsSidebarController({
    getCollapsed: () => collapsed,
    getDisplayWidth: () => displayWidth,
    setDisplayWidth: (width) => {
      displayWidth = width;
    },
    setIsResizing: (value) => {
      isResizing = value;
    },
    onPanelWidthChange: (width) => onPanelWidthChange(width),
    onToggleCollapsed: (next) => onToggleCollapsed(next),
    onNewSession: () => onNewSession(),
    onDeleteSession: (id) => onDeleteSession(id),
    onRenameSession: (id) => onRenameSession(id),
    onShareSession: (id) => onShareSession(id),
    onExportSession: (id) => onExportSession(id),
  });

  $effect(() => {
    const syncedWidth = syncSessionsSidebarDisplayWidth(panelWidthPx, isResizing);
    if (syncedWidth !== null) {
      displayWidth = syncedWidth;
    }
  });

  const filteredSessions = $derived(filterSessionsByTitle(sessions, searchQuery));
  const groupedSessions = $derived(groupSessionsByLastUsedDate(filteredSessions));
  const isChatsSidebar = $derived(sidebarTitle.trim().toLowerCase() === "chats");
  const entryPluralLabel = $derived(isChatsSidebar ? "chats" : "sessions");
  const entrySingularLabel = $derived(isChatsSidebar ? "chat" : "session");
  const newEntryLabel = $derived(isChatsSidebar ? "New chat" : DRAFT_SESSION_TITLE);

  function groupsWithSessions(): SessionDateGroup[] {
    return SESSION_DATE_GROUP_ORDER.filter((group) => groupedSessions[group].length > 0);
  }

  function openContextMenu(event: MouseEvent, sessionId: string): void {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    contextMenu = { sessionId, x: event.clientX, y: event.clientY };
    window.addEventListener("pointerdown", onWindowPointerDown);
    window.addEventListener("keydown", onWindowKeydown);
  }

  function closeContextMenu(): void {
    if (!contextMenu) {
      return;
    }
    contextMenu = null;
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("keydown", onWindowKeydown);
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (contextMenuEl?.contains(event.target as Node)) {
      return;
    }
    closeContextMenu();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      closeContextMenu();
    }
  }

  function handleDeleteFromContextMenu(): void {
    if (!contextMenu) {
      return;
    }
    const entry = sessions.find((session) => session.id === contextMenu?.sessionId);
    const title = entry?.title ?? `this ${entrySingularLabel}`;
    sidebarController.confirmDeleteSession(contextMenu.sessionId, title, entrySingularLabel);
    closeContextMenu();
  }

  function handleRenameFromContextMenu(): void {
    if (!contextMenu) {
      return;
    }
    const sessionId = contextMenu.sessionId;
    closeContextMenu();
    void sidebarController.renameSession(sessionId);
  }

  function handleShareFromContextMenu(): void {
    if (!contextMenu) {
      return;
    }
    const sessionId = contextMenu.sessionId;
    closeContextMenu();
    void sidebarController.shareSession(sessionId);
  }

  function handleExportFromContextMenu(): void {
    if (!contextMenu) {
      return;
    }
    const sessionId = contextMenu.sessionId;
    closeContextMenu();
    void sidebarController.exportSession(sessionId);
  }

  /**
   * Whether the context-menu target has a linked OpenCode session. Actions
   * that require a server-side session (share / export) are hidden for draft
   * sessions and chat-http chats that have no link yet. Rename is always shown.
   */
  let contextMenuHasSessionLink = $derived.by(() => {
    if (!contextMenu) {
      return false;
    }
    return Boolean(
      sessions.find((session) => session.id === contextMenu?.sessionId)?.opencodeSessionId,
    );
  });
</script>

<aside
  class={`sessions-sidebar ${collapsed ? "sessions-sidebar-collapsed" : ""} ${isResizing ? "sessions-sidebar-resizing" : ""}`}
  aria-label={`${sidebarTitle} sidebar`}
  style={collapsed ? undefined : `width:${displayWidth}px`}
>
  {#if !collapsed}
    <div
      class="sessions-sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${entryPluralLabel} sidebar`}
      onpointerdown={sidebarController.handleResizeStart}
    ></div>
  {/if}
  <header class="sessions-sidebar-header">
    {#if !collapsed}
      <div class="sessions-sidebar-title">{sidebarTitle}</div>
      <button
        class="sessions-sidebar-button sessions-sidebar-toggle"
        type="button"
        onpointerup={sidebarController.handleTogglePointerDown}
        onclick={sidebarController.handleToggleButtonClick}
        title={`Collapse ${entryPluralLabel} sidebar`}
      >
        ⟪
      </button>
      <button
        class="sessions-sidebar-button sessions-sidebar-new"
        type="button"
        onpointerdown={sidebarController.handleNewSessionPointerDown}
        onclick={sidebarController.handleNewSessionClick}
      >
        {newEntryLabel}
      </button>
      {#if onOpenSessions}
        <button
          class="sessions-sidebar-button sessions-sidebar-sessions"
          type="button"
          onclick={() => onOpenSessions()}
          title="Browse all OpenCode sessions for this workspace, including ones not opened here yet"
        >
          All sessions…
        </button>
      {/if}
    {:else}
      <button
        class="sessions-sidebar-button sessions-sidebar-toggle"
        type="button"
        onpointerup={sidebarController.handleTogglePointerDown}
        onclick={sidebarController.handleToggleButtonClick}
        title={`Expand ${entryPluralLabel} sidebar`}
      >
        ⟫
      </button>
    {/if}
  </header>

  {#if !collapsed}
    <div class="sessions-sidebar-body">
      <label class="sessions-search-field">
        <span class="sessions-search-label">{`Search ${entryPluralLabel}`}</span>
        <input
          class="sessions-search-input"
          type="search"
          placeholder={`Search ${entryPluralLabel}…`}
          bind:value={searchQuery}
        />
      </label>

      <div class="sessions-list">
        {#if filteredSessions.length === 0}
          <p class="sessions-empty" role="status">
            {searchQuery.trim()
              ? `No ${entryPluralLabel} match your search.`
              : `No ${entryPluralLabel} yet.`}
          </p>
        {:else}
          {#each groupsWithSessions() as group (group)}
            <section class="sessions-group" aria-label={SESSION_DATE_GROUP_LABELS[group]}>
              <h3 class="sessions-group-label">{SESSION_DATE_GROUP_LABELS[group]}</h3>
              {#each groupedSessions[group] as session (session.id)}
                <SessionSidebarRow
                  {session}
                  selected={session.id === activeSessionId}
                  onSelect={onSelectSession}
                  onContextMenu={openContextMenu}
                />
              {/each}
            </section>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</aside>

{#if contextMenu}
  <div
    bind:this={contextMenuEl}
    class="sessions-context-menu"
    style={`left:${contextMenu.x}px; top:${contextMenu.y}px;`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    <button
      class="sessions-context-item"
      type="button"
      role="menuitem"
      onclick={handleRenameFromContextMenu}
    >
      Rename {entrySingularLabel}
    </button>
    {#if contextMenuHasSessionLink}
      <button
        class="sessions-context-item"
        type="button"
        role="menuitem"
        onclick={handleShareFromContextMenu}
      >
        Copy share link
      </button>
      <button
        class="sessions-context-item"
        type="button"
        role="menuitem"
        onclick={handleExportFromContextMenu}
      >
        Export transcript…
      </button>
    {/if}
    <button
      class="sessions-context-item sessions-context-item-danger"
      type="button"
      role="menuitem"
      onclick={handleDeleteFromContextMenu}
    >
      Delete {entrySingularLabel}
    </button>
  </div>
{/if}
