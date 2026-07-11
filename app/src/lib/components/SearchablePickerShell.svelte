<script lang="ts">
  /**
   * Accessible searchable-picker shell for future quick-open / command palette.
   * Owns query focus, combobox/listbox semantics, keyboard navigation, Enter,
   * Escape (via overlay host), pointer activation, and active-row scrolling.
   * Consumers supply option rows and selection handling — no fuzzy logic here.
   *
   * Pane-local overlay only (EditorOverlayHost). Do not use for destructive
   * confirmations — those stay on DialogShell / ConfirmDialog.
   */
  import EditorOverlayHost from "./EditorOverlayHost.svelte";
  import {
    listNavigationActionFromKeyboard,
    moveActiveIndex,
  } from "../picker/listNavigation";
  import { pickerOptionId } from "../picker/pickerOptionId";

  let {
    open = false,
    label,
    query = $bindable(""),
    activeIndex = $bindable(0),
    /** Number of currently visible options (drives keyboard bounds). */
    optionCount = 0,
    optionIdPrefix = "searchable-picker-option",
    listId = "searchable-picker-options",
    placeholder = "Search…",
    onClose,
    /** Invoked when Enter selects the active option (index >= 0). */
    onSelect,
    /** Optional: notify when query changes (bind:query already updates). */
    onQueryInput,
    children,
    footer,
  }: {
    open?: boolean;
    label: string;
    query?: string;
    activeIndex?: number;
    optionCount?: number;
    optionIdPrefix?: string;
    listId?: string;
    placeholder?: string;
    onClose: () => void;
    onSelect?: (index: number) => void;
    onQueryInput?: (query: string) => void;
    children?: import("svelte").Snippet;
    footer?: import("svelte").Snippet;
  } = $props();

  let queryInputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLUListElement | null>(null);

  const activeOptionId = $derived(
    activeIndex >= 0 && activeIndex < optionCount
      ? pickerOptionId(optionIdPrefix, activeIndex)
      : null,
  );

  $effect(() => {
    if (open) {
      queueMicrotask(() => {
        queryInputEl?.focus();
        queryInputEl?.select();
      });
    }
  });

  $effect(() => {
    if (!open || !listEl || activeIndex < 0) {
      return;
    }
    const id = pickerOptionId(optionIdPrefix, activeIndex);
    const option = listEl.querySelector<HTMLElement>(`[id="${id}"]`);
    if (option && typeof option.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  });

  function handleQueryInput(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    query = value;
    onQueryInput?.(value);
  }

  function handleQueryKeydown(event: KeyboardEvent): void {
    const nav = listNavigationActionFromKeyboard(event);
    if (nav) {
      event.preventDefault();
      event.stopPropagation();
      activeIndex = moveActiveIndex(activeIndex, optionCount, nav);
      return;
    }

    if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < optionCount) {
        event.preventDefault();
        event.stopPropagation();
        onSelect?.(activeIndex);
      }
      return;
    }

    // Escape is handled by EditorOverlayHost so focus restores correctly.
  }

  function handleListPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    const option = target?.closest<HTMLElement>("[data-picker-option-index]");
    if (!option) {
      return;
    }
    const raw = option.dataset.pickerOptionIndex;
    if (raw === undefined) {
      return;
    }
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= optionCount) {
      return;
    }
    activeIndex = index;
    // Pointer selection on click (pointerup would race with focus); use click via pointerdown+button
  }

  function handleListClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const option = target?.closest<HTMLElement>("[data-picker-option-index]");
    if (!option) {
      return;
    }
    const raw = option.dataset.pickerOptionIndex;
    if (raw === undefined) {
      return;
    }
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= optionCount) {
      return;
    }
    activeIndex = index;
    onSelect?.(index);
  }
</script>

<EditorOverlayHost
  {open}
  {label}
  role="dialog"
  {onClose}
  class="searchable-picker-shell"
>
  <div class="searchable-picker-inner">
    <input
      bind:this={queryInputEl}
      class="searchable-picker-query"
      type="text"
      role="combobox"
      aria-autocomplete="list"
      aria-controls={listId}
      aria-expanded={open}
      aria-activedescendant={activeOptionId}
      {placeholder}
      value={query}
      oninput={handleQueryInput}
      onkeydown={handleQueryKeydown}
    />
    <!-- Keyboard nav lives on the combobox input; list handlers are pointer + a11y pairing. -->
    <ul
      bind:this={listEl}
      id={listId}
      class="searchable-picker-options"
      role="listbox"
      aria-label={label}
      onpointerdown={handleListPointerDown}
      onclick={handleListClick}
      onkeydown={handleQueryKeydown}
    >
      {@render children?.()}
    </ul>
    {#if footer}
      <div class="searchable-picker-footer">
        {@render footer()}
      </div>
    {/if}
  </div>
</EditorOverlayHost>

<style>
  .searchable-picker-inner {
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

  .searchable-picker-query {
    height: 30px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
    padding: 0 var(--space-8);
    font: inherit;
    outline: none;
  }

  .searchable-picker-query:focus {
    border-color: var(--color-accent);
  }

  .searchable-picker-options {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 240px;
    overflow: auto;
  }

  .searchable-picker-footer {
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  :global(.searchable-picker-options [data-picker-option-index]) {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    padding: var(--space-6) var(--space-8);
    font: inherit;
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard);
  }

  :global(.searchable-picker-options [data-picker-option-index][aria-selected="true"]) {
    background: var(--color-surface-2);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.searchable-picker-options [data-picker-option-index]) {
      transition: none;
    }
  }
</style>
