<script lang="ts">
  /**
   * Reusable searchable-listbox chrome for future quick-open / command palette.
   * Provides query field, listbox region, active-descendant wiring, Escape, and
   * focus restoration via EditorOverlayHost. Consumers supply option rows.
   *
   * Does not implement fuzzy ranking or command catalogs (M0.6).
   */
  import EditorOverlayHost from "./EditorOverlayHost.svelte";

  let {
    open = false,
    label,
    query = $bindable(""),
    activeOptionId = null,
    listId = "editor-listbox-options",
    onClose,
    onQueryKeydown,
    children,
    footer,
  }: {
    open?: boolean;
    label: string;
    query?: string;
    /** `id` of the active option for aria-activedescendant. */
    activeOptionId?: string | null;
    listId?: string;
    onClose: () => void;
    onQueryKeydown?: (event: KeyboardEvent) => void;
    children?: import("svelte").Snippet;
    footer?: import("svelte").Snippet;
  } = $props();

  let queryInputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (open) {
      queueMicrotask(() => {
        queryInputEl?.focus();
        queryInputEl?.select();
      });
    }
  });
</script>

<EditorOverlayHost
  {open}
  {label}
  role="dialog"
  {onClose}
  class="editor-listbox-chrome"
>
  <div class="editor-listbox-chrome-inner">
    <input
      bind:this={queryInputEl}
      class="editor-listbox-query"
      type="text"
      role="combobox"
      aria-autocomplete="list"
      aria-controls={listId}
      aria-expanded={open}
      aria-activedescendant={activeOptionId}
      placeholder="Search…"
      bind:value={query}
      onkeydown={onQueryKeydown}
    />
    <ul
      id={listId}
      class="editor-listbox-options"
      role="listbox"
      aria-label={label}
    >
      {@render children?.()}
    </ul>
    {#if footer}
      <div class="editor-listbox-footer">
        {@render footer()}
      </div>
    {/if}
  </div>
</EditorOverlayHost>

<style>
  .editor-listbox-chrome-inner {
    display: grid;
    gap: var(--space-6);
    min-width: 280px;
    max-width: min(480px, calc(100vw - 2 * var(--space-12)));
    padding: var(--space-8);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
  }

  .editor-listbox-query {
    height: 30px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
    padding: 0 var(--space-8);
    font: inherit;
    outline: none;
  }

  .editor-listbox-query:focus {
    border-color: var(--color-accent);
  }

  .editor-listbox-options {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 240px;
    overflow: auto;
  }

  .editor-listbox-footer {
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }
</style>
