<script lang="ts">
  /**
   * Thin alias kept for M0.5 call sites / docs. Prefer SearchablePickerShell.
   */
  import SearchablePickerShell from "./SearchablePickerShell.svelte";

  let {
    open = false,
    label,
    query = $bindable(""),
    listId = "editor-listbox-options",
    onClose,
    children,
    footer,
  }: {
    open?: boolean;
    label: string;
    query?: string;
    listId?: string;
    onClose: () => void;
    children?: import("svelte").Snippet;
    footer?: import("svelte").Snippet;
  } = $props();
</script>

<SearchablePickerShell
  {open}
  {label}
  bind:query
  {listId}
  {onClose}
  {children}
  {footer}
/>
