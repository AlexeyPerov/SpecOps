<script lang="ts">
  import type { ImmediateSubfolder } from "../services/workspaceSubfolders";
  import { emptySet } from "../collections/emptyCollections";
  import DialogShell from "./DialogShell.svelte";

  /**
   * Add-multiple modal (decision 8): a centered dialog listing the immediate
   * subfolders of a chosen parent directory as checkboxes. All are unchecked by
   * default; paths already in the session are shown disabled and pre-excluded.
   * "Add selected" runs the batch add; "Cancel" closes without side effects.
   *
   * Built on DialogShell for Escape, focus-in/restore, and focus trap.
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

  function dismiss(): void {
    if (!loading) {
      onCancel?.();
    }
  }
</script>

<DialogShell
  {open}
  title="Add multiple workspaces"
  width={560}
  onDismiss={loading ? undefined : dismiss}
  dismissOnBackdrop={!loading}
  panelClass="add-multiple-panel"
>
  {#if parentPath}
    <p class="add-multiple-parent" title={parentPath}>{parentPath}</p>
  {/if}

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

  {#snippet actions()}
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
  {/snippet}
</DialogShell>

<style>
  :global(.add-multiple-panel) {
    max-height: 80vh;
  }

  .add-multiple-parent {
    margin: 0;
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
    color: var(--color-danger);
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
</style>
