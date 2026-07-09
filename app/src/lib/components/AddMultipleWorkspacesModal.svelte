<script lang="ts">
  import type { ImmediateSubfolder } from "../services/workspaceSubfolders";
  import { emptySet } from "../collections/emptyCollections";

  /**
   * Add-multiple modal (decision 8): a centered dialog listing the immediate
   * subfolders of a chosen parent directory as checkboxes. All are unchecked by
   * default; paths already in the session are shown disabled and pre-excluded.
   * "Add selected" runs the batch add; "Cancel" closes without side effects.
   */
  let {
    open = false,
    loading = false,
    errorMessage = null,
    entries = [],
    selected = emptySet<string>(),
    parentPath = null,
    onToggleEntry,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    loading?: boolean;
    errorMessage?: string | null;
    entries?: ReadonlyArray<ImmediateSubfolder>;
    selected?: Set<string>;
    parentPath?: string | null;
    onToggleEntry?: (path: string, checked: boolean) => void;
    onConfirm?: () => void;
    onCancel?: () => void;
  } = $props();

  const selectableEntries = $derived(entries.filter((entry) => !entry.exists));
  const selectAllDisabled = $derived(selectableEntries.length === 0);

  function handleBackdropKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !loading) {
      event.stopPropagation();
      onCancel?.();
    }
  }

  function selectAll(): void {
    for (const entry of selectableEntries) {
      onToggleEntry?.(entry.path, true);
    }
  }

  function clearAll(): void {
    for (const entry of selectableEntries) {
      onToggleEntry?.(entry.path, false);
    }
  }
</script>

{#if open}
  <div
    class="add-multiple-backdrop"
    role="presentation"
    onclick={() => {
      if (!loading) {
        onCancel?.();
      }
    }}
    onkeydown={handleBackdropKeydown}
  >
    <div
      class="add-multiple-dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Add multiple workspaces"
      onclick={(event) => event.stopPropagation()}
      onkeydown={handleBackdropKeydown}
    >
      <header class="add-multiple-header">
        <h2>Add multiple workspaces</h2>
        {#if parentPath}
          <p class="add-multiple-parent" title={parentPath}>{parentPath}</p>
        {/if}
      </header>

      {#if loading}
        <div class="add-multiple-state">Scanning subfolders…</div>
      {:else if errorMessage}
        <div class="add-multiple-state add-multiple-error">{errorMessage}</div>
      {:else if entries.length === 0}
        <div class="add-multiple-state">No subfolders found.</div>
      {:else}
        <div class="add-multiple-toolbar">
          <button type="button" class="wm-quiet-button" onclick={selectAll} disabled={selectAllDisabled}>
            Select all
          </button>
          <button type="button" class="wm-quiet-button" onclick={clearAll} disabled={selectAllDisabled}>
            Clear
          </button>
        </div>
        <ul class="add-multiple-list">
          {#each entries as entry (entry.path)}
            <li class="add-multiple-item" class:add-multiple-item-disabled={entry.exists}>
              <label class="add-multiple-label">
                <input
                  type="checkbox"
                  checked={selected.has(entry.path)}
                  disabled={entry.exists}
                  onchange={(event) => {
                    const target = event.currentTarget as HTMLInputElement;
                    onToggleEntry?.(entry.path, target.checked);
                  }}
                />
                <span class="add-multiple-item-name">{entry.name}</span>
                {#if entry.exists}
                  <span class="add-multiple-item-tag">already open</span>
                {/if}
              </label>
            </li>
          {/each}
        </ul>
      {/if}

      <footer class="add-multiple-actions">
        <button type="button" class="btn btn-secondary" onclick={() => onCancel?.()} disabled={loading}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => onConfirm?.()}
          disabled={loading || selected.size === 0}
        >
          Add selected ({selected.size})
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .add-multiple-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-scrim, rgba(0, 0, 0, 0.5)) 60%, transparent);
  }

  .add-multiple-dialog {
    width: min(560px, 92vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }

  .add-multiple-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .add-multiple-parent {
    margin: var(--space-1) 0 0;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add-multiple-state {
    padding: var(--space-8) 0;
    text-align: center;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .add-multiple-error {
    color: var(--color-danger, var(--color-text-secondary));
  }

  .add-multiple-toolbar {
    display: flex;
    gap: var(--space-3);
  }

  .wm-quiet-button {
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .wm-quiet-button:hover:not(:disabled) {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .wm-quiet-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .add-multiple-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--color-border-subtle);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .add-multiple-item {
    padding: var(--space-2) var(--space-1);
  }

  .add-multiple-item-disabled {
    opacity: 0.55;
  }

  .add-multiple-label {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    cursor: pointer;
    user-select: none;
  }

  .add-multiple-item-disabled .add-multiple-label {
    cursor: default;
  }

  .add-multiple-label input {
    cursor: pointer;
  }

  .add-multiple-item-disabled .add-multiple-label input {
    cursor: default;
  }

  .add-multiple-item-name {
    font-size: 0.875rem;
    color: var(--color-text-primary);
  }

  .add-multiple-item-tag {
    margin-left: auto;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .add-multiple-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }
</style>
