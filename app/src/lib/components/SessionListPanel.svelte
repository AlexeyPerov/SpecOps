<script lang="ts">
  import type { WorkspaceAgentSessionDetails } from "../ai/backends/workspaceAgentBackend";
  import {
    SESSION_LIST_DATE_GROUP_LABELS,
    SESSION_LIST_DATE_GROUP_ORDER,
    filterSessionList,
    formatSessionListTimestamp,
    groupSessionListByDate,
    sortSessionList,
    toSessionListItem,
    type SessionListItem,
    type SessionListSort,
  } from "../ai/backends/opencodeSessionList";
  import { emptySet } from "../collections/emptyCollections";

  /**
   * M2-T2 — unified per-workspace session list. Shows every OpenCode session
   * for the workspace directory (not just SpecOps-created agent tabs), with
   * search, sort, and quick-open. Mounted as a modal overlay triggered from
   * the agents sidebar.
   */
  interface Props {
    open: boolean;
    /** Linked sessions already opened as SpecOps agent tabs (for badges). */
    openSessionIds?: ReadonlySet<string>;
    activeSessionId?: string | null;
    sessions?: readonly WorkspaceAgentSessionDetails[];
    loading?: boolean;
    errorMessage?: string | null;
    sort?: SessionListSort;
    searchQuery?: string;
    onOpenSession?: (sessionId: string, title?: string) => void;
    onClose?: () => void;
    onSearchChange?: (query: string) => void;
    onSortChange?: (sort: SessionListSort) => void;
    onRefresh?: () => void;
  }

  let {
    open,
    openSessionIds = emptySet<string>(),
    activeSessionId = null,
    sessions = [],
    loading = false,
    errorMessage = null,
    sort = "updated",
    searchQuery = "",
    onOpenSession = () => {},
    onClose = () => {},
    onSearchChange = () => {},
    onSortChange = () => {},
    onRefresh = () => {},
  }: Props = $props();

  let backdropEl = $state<HTMLDivElement | null>(null);

  function handleBackdropPointerDown(event: PointerEvent): void {
    if (event.target === backdropEl) {
      onClose();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  const items = $derived(sessions.map(toSessionListItem));
  const filtered = $derived(filterSessionList(items, searchQuery));
  const sorted = $derived(sortSessionList(filtered, sort));
  const grouped = $derived(groupSessionListByDate(sorted));

  function groupsWithSessions(): typeof SESSION_LIST_DATE_GROUP_ORDER {
    return SESSION_LIST_DATE_GROUP_ORDER.filter((group) => grouped[group].length > 0);
  }
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
  <div
    bind:this={backdropEl}
    class="session-list-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="session-list-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-list-title"
      tabindex="-1"
    >
      <header class="session-list-header">
        <h2 id="session-list-title" class="session-list-title">Sessions</h2>
        <div class="session-list-controls">
          <label class="session-list-search">
            <input
              type="search"
              placeholder="Search sessions…"
              value={searchQuery}
              oninput={(e) => onSearchChange(e.currentTarget.value)}
            />
          </label>
          <select
            class="session-list-sort"
            value={sort}
            onchange={(e) => onSortChange(e.currentTarget.value as SessionListSort)}
          >
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
          </select>
          <button type="button" class="toolbar-button" onclick={onRefresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button type="button" class="toolbar-button" onclick={onClose}>Close</button>
        </div>
      </header>

      <div class="session-list-body">
        {#if errorMessage}
          <p class="session-list-empty" role="alert">{errorMessage}</p>
        {:else if loading && sorted.length === 0}
          <p class="session-list-empty">Loading sessions…</p>
        {:else if sorted.length === 0}
          <p class="session-list-empty">
            {searchQuery.trim() ? "No sessions match your search." : "No sessions yet."}
          </p>
        {:else}
          {#each groupsWithSessions() as group (group)}
            <section class="session-list-group">
              <h3 class="session-list-group-label">{SESSION_LIST_DATE_GROUP_LABELS[group]}</h3>
              <ul class="session-list-items">
                {#each grouped[group] as item (item.key)}
                  {@const isOpen = openSessionIds.has(item.details.id)}
                  {@const isActive = item.details.id === activeSessionId}
                  <li>
                    <button
                      type="button"
                      class={`session-list-row ${isActive ? "session-list-row-active" : ""}`}
                      onclick={() => onOpenSession(item.details.id, item.details.title)}
                    >
                      <span class="session-list-row-title">
                        {item.details.title.trim() || "Untitled session"}
                      </span>
                      <span class="session-list-row-meta">
                        {#if item.details.shareUrl}
                          <span class="session-list-row-badge" title={item.details.shareUrl}>shared</span>
                        {/if}
                        {#if item.details.parentId}
                          <span class="session-list-row-badge" title={`Forked from ${item.details.parentId}`}>fork</span>
                        {/if}
                        {#if isOpen}
                          <span class="session-list-row-badge session-list-row-badge-open">open</span>
                        {/if}
                        <span class="session-list-row-time">
                          {formatSessionListTimestamp(item.sortTimestamp)}
                        </span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .session-list-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .session-list-panel {
    width: min(640px, calc(100vw - 2 * var(--space-12)));
    max-height: min(640px, calc(100vh - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .session-list-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .session-list-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .session-list-controls {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .session-list-search {
    flex: 1;
    min-width: 160px;
  }

  .session-list-search input,
  .session-list-sort {
    height: 28px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-4);
    font: inherit;
    font-size: 11px;
  }

  .session-list-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-6) var(--space-10);
  }

  .session-list-empty {
    margin: 0;
    padding: var(--space-10) 0;
    text-align: center;
    color: var(--color-text-secondary);
    font-size: 12px;
  }

  .session-list-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
  }

  .session-list-group-label {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .session-list-items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .session-list-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4) var(--space-6);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .session-list-row:hover {
    background: var(--color-hover);
  }

  .session-list-row-active {
    background: var(--color-selection);
    border-color: var(--color-border-subtle);
  }

  .session-list-row-title {
    font-size: 12px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-list-row-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: 10px;
    color: var(--color-text-secondary);
  }

  .session-list-row-badge {
    display: inline-block;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .session-list-row-badge-open {
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle));
    color: var(--color-accent);
  }

  .session-list-row-time {
    margin-left: auto;
  }
</style>
