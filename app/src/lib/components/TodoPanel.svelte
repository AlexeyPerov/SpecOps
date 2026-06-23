<script lang="ts">
  import {
    getSessionTodos,
    refreshSessionTodos,
    sortSessionTodos,
    summarizeTodoProgress,
  } from "../ai/opencodeTodoStore";
  import type {
    OpencodeTodoEntry,
    OpencodeTodoStatus,
  } from "../ai/backends/workspaceAgentBackend";

  /**
   * M5-T1 — TODO panel. Renders the agent's `session.todo` list as a
   * checklist grouped by status (in_progress / pending / completed /
   * cancelled) with a progress summary. Auto-refresh is wired by the parent
   * (AppShell) on `todowrite` tool events; this component only renders the
   * reactive store and exposes a manual refresh button.
   */
  interface Props {
    workspaceRootPath: string;
    sessionId: string;
    onJumpToMessage?: (messageId?: string) => void;
  }

  let {
    workspaceRootPath,
    sessionId,
    onJumpToMessage,
  }: Props = $props();

  // Derive the store from the live props (a fresh Readable is returned per
  // workspace-root + session-id pair) and subscribe in a second `$derived`.
  // The previous `const store = …` captured the initial prop values and
  // tripped svelte-check's `state_referenced_locally` warning.
  const store = $derived(getSessionTodos(workspaceRootPath, sessionId));
  const todoState = $derived($store);

  const sorted = $derived(sortSessionTodos(todoState.todos));
  const progress = $derived(summarizeTodoProgress(todoState.todos));
  const isEmpty = $derived(todoState.status === "loaded" && todoState.todos.length === 0);

  function statusLabel(status: OpencodeTodoStatus): string {
    switch (status) {
      case "in_progress":
        return "In progress";
      case "pending":
        return "Pending";
      case "completed":
        return "Completed";
      case "cancelled":
        return "Cancelled";
    }
  }

  function handleRefresh(): void {
    void refreshSessionTodos({ workspaceRootPath, sessionId });
  }

  function handleJump(): void {
    // We don't currently have a per-todo message id from `session.todo`, so
    // jumping scrolls to the latest assistant message. The parent may remap.
    onJumpToMessage?.();
  }
</script>

<section class="todo-panel" aria-label="Session todo list">
  <header class="todo-header">
    <div class="todo-header-title">
      <h2>Todos</h2>
      {#if progress.total > 0}
        <span class="todo-progress" title={`${progress.completed} of ${progress.total} done`}>
          {progress.completed}/{progress.total}
        </span>
      {/if}
    </div>
    <button
      type="button"
      class="toolbar-button todo-refresh"
      onclick={handleRefresh}
      disabled={todoState.status === "loading"}
      title="Refresh todos"
    >
      {todoState.status === "loading" ? "Loading…" : "Refresh"}
    </button>
  </header>

  <div class="todo-body">
    {#if todoState.status === "error"}
      <p class="todo-empty todo-error" role="alert">{todoState.lastErrorMessage}</p>
    {:else if todoState.status === "loading" && todoState.todos.length === 0}
      <p class="todo-empty">Loading todos…</p>
    {:else if isEmpty}
      <p class="todo-empty">No todos yet. The agent will list tasks here as it works.</p>
    {:else}
      <ul class="todo-list">
        {#each sorted as todo (todo.content + todo.status)}
          <li class={`todo-item todo-item-${todo.status}`}>
            <span class={`todo-marker todo-marker-${todo.status}`} aria-hidden="true">
              {#if todo.status === "completed"}✓{:else if todo.status === "cancelled"}×{/if}
            </span>
            <button
              type="button"
              class="todo-content"
              title="Jump to latest message"
              onclick={handleJump}
            >
              <span class="todo-text">{todo.content}</span>
              <span class="todo-meta">
                <span class="todo-status-chip todo-status-{todo.status}">
                  {statusLabel(todo.status)}
                </span>
                <span class="todo-priority todo-priority-{todo.priority}">{todo.priority}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .todo-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border-left: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .todo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .todo-header-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }

  .todo-header h2 {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
  }

  .todo-progress {
    font-size: 10px;
    color: var(--color-text-secondary);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
  }

  .todo-refresh {
    min-height: 24px;
    font-size: 11px;
  }

  .todo-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4) var(--space-6);
  }

  .todo-empty {
    margin: 0;
    padding: var(--space-10) var(--space-4);
    text-align: center;
    color: var(--color-text-secondary);
    font-size: 12px;
  }

  .todo-error {
    color: #e06c75;
  }

  .todo-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .todo-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
  }

  .todo-item:hover {
    background: var(--color-hover);
  }

  .todo-item-completed,
  .todo-item-cancelled {
    opacity: 0.6;
  }

  .todo-marker {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    line-height: 1;
    color: var(--color-text-secondary);
  }

  .todo-marker-in_progress {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  }

  .todo-marker-completed {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-surface-1);
  }

  .todo-marker-cancelled {
    color: #e06c75;
    border-color: color-mix(in srgb, #e06c75 50%, var(--color-border-subtle));
  }

  .todo-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .todo-text {
    font-size: 12px;
    line-height: 1.4;
    word-break: break-word;
    white-space: pre-wrap;
  }

  .todo-item-completed .todo-text {
    text-decoration: line-through;
  }

  .todo-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: 10px;
  }

  .todo-status-chip {
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    text-transform: capitalize;
  }

  .todo-priority {
    text-transform: capitalize;
    color: var(--color-text-secondary);
  }

  .todo-priority-high {
    color: #e06c75;
  }

  .todo-priority-medium {
    color: var(--color-text-secondary);
  }

  .todo-priority-low {
    color: var(--color-text-secondary);
    opacity: 0.7;
  }
</style>
