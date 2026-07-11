<script lang="ts">
  /**
   * Presentational option row for SearchablePickerShell.
   * Sets role/option id/aria-selected and data-picker-option-index for shell pointer handling.
   */
  import { pickerOptionId } from "../picker/pickerOptionId";
  import type { Snippet } from "svelte";

  let {
    index,
    active,
    idPrefix = "searchable-picker-option",
    disabled = false,
    children,
  }: {
    index: number;
    active: boolean;
    idPrefix?: string;
    disabled?: boolean;
    children?: Snippet;
  } = $props();
</script>

<li role="presentation">
  <button
    type="button"
    id={pickerOptionId(idPrefix, index)}
    role="option"
    aria-selected={active}
    aria-disabled={disabled || undefined}
    data-picker-option-index={index}
    tabindex="-1"
    class:is-active={active}
    class:is-disabled={disabled}
  >
    {@render children?.()}
  </button>
</li>

<style>
  button {
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

  button.is-active {
    background: var(--color-surface-2);
  }

  button.is-disabled {
    opacity: 0.55;
    cursor: default;
  }

  @media (prefers-reduced-motion: reduce) {
    button {
      transition: none;
    }
  }
</style>
