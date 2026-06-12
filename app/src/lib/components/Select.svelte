<script lang="ts">
  import { tick } from "svelte";

  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    options: SelectOption[];
    value?: string;
    onchange?: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    class?: string;
  }

  let {
    options = [],
    value = "",
    onchange,
    placeholder,
    disabled = false,
    title,
    ariaLabel,
    class: className = "",
  }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);
  let listboxEl = $state<HTMLUListElement | null>(null);
  let activeIndex = $state(-1);

  const selectedOption = $derived(options.find((o) => o.value === value));
  const displayLabel = $derived(selectedOption?.label ?? placeholder ?? "");

  function toggleOpen(): void {
    if (disabled) return;
    open = !open;
    if (open) {
      activeIndex = options.findIndex((o) => o.value === value);
    }
  }

  function selectOption(option: SelectOption): void {
    if (option.disabled) return;
    onchange?.(option.value);
    open = false;
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          open = true;
          activeIndex = options.findIndex((o) => o.value === value);
        } else {
          moveActive(event.key === "ArrowDown" ? 1 : -1);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open && activeIndex >= 0 && !options[activeIndex]?.disabled) {
          selectOption(options[activeIndex]);
        } else {
          toggleOpen();
        }
        break;
      case "Escape":
        event.preventDefault();
        open = false;
        break;
    }
  }

  function handleListboxKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && !options[activeIndex]?.disabled) {
          selectOption(options[activeIndex]);
        }
        break;
      case "Escape":
        event.preventDefault();
        open = false;
        break;
    }
  }

  function moveActive(delta: number): void {
    let next = activeIndex + delta;
    const len = options.length;
    if (next < 0) next = len - 1;
    if (next >= len) next = 0;
    while (options[next]?.disabled) {
      next += delta;
      if (next < 0) next = len - 1;
      if (next >= len) next = 0;
    }
    activeIndex = next;
    void tick().then(() => {
      listboxEl?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    });
  }

  function handleBackdropPointerdown(): void {
    open = false;
  }

  $effect(() => {
    if (!open) return;
    function onClick(event: MouseEvent): void {
      if (containerEl && !containerEl.contains(event.target as Node)) {
        open = false;
      }
    }
    document.addEventListener("pointerdown", onClick);
    return () => document.removeEventListener("pointerdown", onClick);
  });
</script>

<div class="select-container {className}" bind:this={containerEl} {title}>
  <button
    type="button"
    class="select-trigger"
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    onclick={toggleOpen}
    onkeydown={handleTriggerKeydown}
  >
    <span class="select-label">{displayLabel}</span>
    <span class="select-chevron" aria-hidden="true">&#9662;</span>
  </button>

  {#if open}
    <div class="select-backdrop" role="presentation" onpointerdown={handleBackdropPointerdown}></div>
    <ul
      class="select-listbox"
      bind:this={listboxEl}
      role="listbox"
      tabindex="-1"
      onkeydown={handleListboxKeydown}
    >
      {#each options as option, index (option.value)}
        <li
          role="option"
          class="select-option"
          class:select-option-active={index === activeIndex}
          class:select-option-selected={option.value === value}
          aria-selected={option.value === value}
          aria-disabled={option.disabled}
          onpointerdown={() => selectOption(option)}
          onmouseenter={() => {
            if (!option.disabled) activeIndex = index;
          }}
        >
          {option.label}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .select-container {
    position: relative;
    display: inline-flex;
  }

  .select-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    min-height: 24px;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    line-height: 1;
    cursor: pointer;
    user-select: none;
  }

  .select-trigger:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .select-trigger:hover:not(:disabled) {
    background: var(--color-hover);
  }

  .select-trigger:active:not(:disabled) {
    background: var(--color-pressed);
  }

  .select-trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .select-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .select-chevron {
    font-size: 10px;
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .select-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1099;
  }

  .select-listbox {
    position: absolute;
    top: calc(100% + var(--space-4));
    left: 0;
    z-index: 1100;
    min-width: 100%;
    max-height: 220px;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-4);
    list-style: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-overlay);
  }

  .select-option {
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .select-option-active {
    background: var(--color-hover);
  }

  .select-option-selected {
    font-weight: 600;
  }

  .select-option[aria-disabled="true"] {
    color: var(--color-text-secondary);
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
