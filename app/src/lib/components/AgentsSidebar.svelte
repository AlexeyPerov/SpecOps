<script lang="ts">
  import type { AgentIndexEntry } from "../domain/contracts";
  import {
    AGENT_DATE_GROUP_LABELS,
    AGENT_DATE_GROUP_ORDER,
    filterAgentsByTitle,
    groupAgentsByLastUsedDate,
    type AgentDateGroup,
  } from "../services/chatAgents";
  import {
    DEFAULT_PANEL_WIDTH_PX,
    MAX_PANEL_WIDTH_PX,
    MIN_PANEL_WIDTH_PX,
    normalizePanelWidthPx,
  } from "../services/panelLayout";

  interface Props {
    agents?: AgentIndexEntry[];
    activeAgentId?: string | null;
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

  $effect(() => {
    if (!isResizing) {
      displayWidth = normalizePanelWidthPx(panelWidthPx);
    }
  });

  const filteredAgents = $derived(filterAgentsByTitle(agents, searchQuery));
  const groupedAgents = $derived(groupAgentsByLastUsedDate(filteredAgents));

  function groupsWithAgents(): AgentDateGroup[] {
    return AGENT_DATE_GROUP_ORDER.filter((group) => groupedAgents[group].length > 0);
  }

  function clampPanelWidth(next: number): number {
    return Math.max(MIN_PANEL_WIDTH_PX, Math.min(MAX_PANEL_WIDTH_PX, next));
  }

  function handleResizeStart(event: PointerEvent): void {
    if (collapsed) {
      return;
    }
    event.preventDefault();
    isResizing = true;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = displayWidth;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = startX - moveEvent.clientX;
      displayWidth = clampPanelWidth(startWidth + deltaX);
    };

    const onPointerEnd = (): void => {
      isResizing = false;
      target?.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      onPanelWidthChange(displayWidth);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
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

  function confirmDeleteAgent(agentId: string): void {
    const entry = agents.find((agent) => agent.id === agentId);
    const title = entry?.title ?? "this agent";
    const confirmed = window.confirm(`Delete agent "${title}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    onDeleteAgent(agentId);
    closeContextMenu();
  }
</script>

<aside
  class={`agents-sidebar ${collapsed ? "agents-sidebar-collapsed" : ""} ${isResizing ? "agents-sidebar-resizing" : ""}`}
  aria-label="Agents sidebar"
  style={collapsed ? undefined : `width:${displayWidth}px`}
>
  {#if !collapsed}
    <div
      class="agents-sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize agents sidebar"
      onpointerdown={handleResizeStart}
    ></div>
  {/if}
  <header class="agents-sidebar-header">
    {#if !collapsed}
      <div class="agents-sidebar-title">Agents</div>
      <button class="agents-sidebar-button agents-sidebar-new" type="button" onclick={onNewAgent}>
        New agent
      </button>
    {/if}
    <button
      class="agents-sidebar-button"
      type="button"
      onclick={() => onToggleCollapsed(!collapsed)}
      title={collapsed ? "Expand agents sidebar" : "Collapse agents sidebar"}
    >
      {collapsed ? "⟪" : "⟫"}
    </button>
  </header>

  {#if !collapsed}
    <div class="agents-sidebar-body">
      <label class="agents-search-field">
        <span class="agents-search-label">Search agents</span>
        <input
          class="agents-search-input"
          type="search"
          placeholder="Search agents…"
          bind:value={searchQuery}
        />
      </label>

      <div class="agents-list">
        {#if filteredAgents.length === 0}
          <p class="agents-empty" role="status">
            {searchQuery.trim() ? "No agents match your search." : "No agents yet."}
          </p>
        {:else}
          {#each groupsWithAgents() as group (group)}
            <section class="agents-group" aria-label={AGENT_DATE_GROUP_LABELS[group]}>
              <h3 class="agents-group-label">{AGENT_DATE_GROUP_LABELS[group]}</h3>
              {#each groupedAgents[group] as agent (agent.id)}
                <button
                  class={`agents-row ${agent.id === activeAgentId ? "agents-row-selected" : ""}`}
                  type="button"
                  title={agent.title}
                  onclick={() => onSelectAgent(agent.id)}
                  oncontextmenu={(event) => openContextMenu(event, agent.id)}
                >
                  <span class="agents-row-title">{agent.title}</span>
                </button>
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
      onclick={() => {
        if (contextMenu) {
          confirmDeleteAgent(contextMenu.agentId);
        }
      }}
    >
      Delete agent
    </button>
  </div>
{/if}

<style>
  .agents-sidebar {
    position: relative;
    border-left: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .agents-sidebar-collapsed {
    width: 36px;
    grid-template-rows: auto;
  }

  .agents-sidebar-resizing {
    user-select: none;
  }

  .agents-sidebar-resize-handle {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
  }

  .agents-sidebar-header {
    height: var(--tab-header-height);
    border-bottom: 1px solid var(--color-border-subtle);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-6);
    min-width: 0;
  }

  .agents-sidebar-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .agents-sidebar-button {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    height: 22px;
    padding: 0 var(--space-6);
    white-space: nowrap;
  }

  .agents-sidebar-button:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .agents-sidebar-new {
    flex-shrink: 0;
  }

  .agents-sidebar-body {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6);
  }

  .agents-search-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .agents-search-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .agents-search-input {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
    font: inherit;
    height: 28px;
    padding: 0 var(--space-6);
  }

  .agents-search-input:focus {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .agents-list {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .agents-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .agents-group-label {
    margin: 0;
    padding: 0 var(--space-4);
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .agents-row {
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    padding: var(--space-4) var(--space-6);
    min-width: 0;
  }

  .agents-row:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .agents-row-selected {
    background: var(--color-selection);
    border-color: var(--color-border-subtle);
  }

  .agents-row-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agents-empty {
    margin: 0;
    padding: var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
  }

  .agents-context-menu {
    position: fixed;
    z-index: 40;
    min-width: 160px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    box-shadow: 0 8px 24px rgb(0 0 0 / 24%);
    padding: var(--space-4) 0;
  }

  .agents-context-item {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    padding: var(--space-4) var(--space-8);
  }

  .agents-context-item:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .agents-context-item-danger {
    color: var(--color-danger, #c44);
  }
</style>
