<script lang="ts">
  import "../styles/agents-sidebar.css";
  import type { AgentIndexEntry } from "../domain/contracts";
  import {
    AGENT_DATE_GROUP_LABELS,
    AGENT_DATE_GROUP_ORDER,
    DRAFT_AGENT_TITLE,
    filterAgentsByTitle,
    groupAgentsByLastUsedDate,
    type AgentDateGroup,
  } from "../services/chatAgents";
  import {
    createAgentsSidebarController,
    syncAgentsSidebarDisplayWidth,
  } from "../services/agentsSidebarController";
  import { DEFAULT_PANEL_WIDTH_PX } from "../services/panelLayout";
  import AgentSidebarRow from "./AgentSidebarRow.svelte";

  interface Props {
    agents?: AgentIndexEntry[];
    activeAgentId?: string | null;
    sidebarTitle?: string;
    collapsed?: boolean;
    panelWidthPx?: number;
    onPanelWidthChange?: (width: number) => void;
    onToggleCollapsed?: (next: boolean) => void;
    onSelectAgent?: (agentId: string) => void;
    onNewAgent?: () => void;
    onDeleteAgent?: (agentId: string) => void;
  }

  let {
    agents = [],
    activeAgentId = null,
    sidebarTitle = "Agents",
    collapsed = false,
    panelWidthPx = DEFAULT_PANEL_WIDTH_PX,
    onPanelWidthChange = () => {},
    onToggleCollapsed = () => {},
    onSelectAgent = () => {},
    onNewAgent = () => {},
    onDeleteAgent = () => {},
  }: Props = $props();

  let searchQuery = $state("");
  let displayWidth = $state(DEFAULT_PANEL_WIDTH_PX);
  let isResizing = $state(false);
  let contextMenu = $state<{ agentId: string; x: number; y: number } | null>(null);
  let contextMenuEl = $state<HTMLDivElement | null>(null);

  const sidebarController = createAgentsSidebarController({
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
    onNewAgent: () => onNewAgent(),
    onDeleteAgent: (id) => onDeleteAgent(id),
  });

  $effect(() => {
    const syncedWidth = syncAgentsSidebarDisplayWidth(panelWidthPx, isResizing);
    if (syncedWidth !== null) {
      displayWidth = syncedWidth;
    }
  });

  const filteredAgents = $derived(filterAgentsByTitle(agents, searchQuery));
  const groupedAgents = $derived(groupAgentsByLastUsedDate(filteredAgents));
  const isChatsSidebar = $derived(sidebarTitle.trim().toLowerCase() === "chats");
  const entryPluralLabel = $derived(isChatsSidebar ? "chats" : "agents");
  const entrySingularLabel = $derived(isChatsSidebar ? "chat" : "agent");
  const newEntryLabel = $derived(isChatsSidebar ? "New chat" : DRAFT_AGENT_TITLE);

  function groupsWithAgents(): AgentDateGroup[] {
    return AGENT_DATE_GROUP_ORDER.filter((group) => groupedAgents[group].length > 0);
  }

  function openContextMenu(event: MouseEvent, agentId: string): void {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    contextMenu = { agentId, x: event.clientX, y: event.clientY };
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
    const entry = agents.find((agent) => agent.id === contextMenu?.agentId);
    const title = entry?.title ?? `this ${entrySingularLabel}`;
    sidebarController.confirmDeleteAgent(contextMenu.agentId, title, entrySingularLabel);
    closeContextMenu();
  }
</script>

<aside
  class={`agents-sidebar ${collapsed ? "agents-sidebar-collapsed" : ""} ${isResizing ? "agents-sidebar-resizing" : ""}`}
  aria-label={`${sidebarTitle} sidebar`}
  style={collapsed ? undefined : `width:${displayWidth}px`}
>
  {#if !collapsed}
    <div
      class="agents-sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${entryPluralLabel} sidebar`}
      onpointerdown={sidebarController.handleResizeStart}
    ></div>
  {/if}
  <header class="agents-sidebar-header">
    {#if !collapsed}
      <div class="agents-sidebar-title">{sidebarTitle}</div>
      <button
        class="agents-sidebar-button agents-sidebar-new"
        type="button"
        onpointerdown={sidebarController.handleNewAgentPointerDown}
        onclick={sidebarController.handleNewAgentClick}
      >
        {newEntryLabel}
      </button>
    {/if}
    <button
      class="agents-sidebar-button"
      type="button"
      onpointerup={sidebarController.handleTogglePointerDown}
      onclick={sidebarController.handleToggleButtonClick}
      title={collapsed ? `Expand ${entryPluralLabel} sidebar` : `Collapse ${entryPluralLabel} sidebar`}
    >
      {collapsed ? "⟫" : "⟪"}
    </button>
  </header>

  {#if !collapsed}
    <div class="agents-sidebar-body">
      <label class="agents-search-field">
        <span class="agents-search-label">{`Search ${entryPluralLabel}`}</span>
        <input
          class="agents-search-input"
          type="search"
          placeholder={`Search ${entryPluralLabel}…`}
          bind:value={searchQuery}
        />
      </label>

      <div class="agents-list">
        {#if filteredAgents.length === 0}
          <p class="agents-empty" role="status">
            {searchQuery.trim()
              ? `No ${entryPluralLabel} match your search.`
              : `No ${entryPluralLabel} yet.`}
          </p>
        {:else}
          {#each groupsWithAgents() as group (group)}
            <section class="agents-group" aria-label={AGENT_DATE_GROUP_LABELS[group]}>
              <h3 class="agents-group-label">{AGENT_DATE_GROUP_LABELS[group]}</h3>
              {#each groupedAgents[group] as agent (agent.id)}
                <AgentSidebarRow
                  {agent}
                  selected={agent.id === activeAgentId}
                  onSelect={onSelectAgent}
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
    class="agents-context-menu"
    style={`left:${contextMenu.x}px; top:${contextMenu.y}px;`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    <button
      class="agents-context-item agents-context-item-danger"
      type="button"
      role="menuitem"
      onclick={handleDeleteFromContextMenu}
    >
      Delete {entrySingularLabel}
    </button>
  </div>
{/if}
