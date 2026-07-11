<script lang="ts">
  /**
   * Test-only harness that renders SearchablePickerShell with three options.
   */
  import SearchablePickerShell from "./SearchablePickerShell.svelte";
  import SearchablePickerOption from "./SearchablePickerOption.svelte";

  let {
    open = true,
    query = $bindable(""),
    activeIndex = $bindable(0),
    optionCount = 3,
    onClose = () => {},
    onSelect,
  }: {
    open?: boolean;
    query?: string;
    activeIndex?: number;
    optionCount?: number;
    onClose?: () => void;
    onSelect?: (index: number) => void;
  } = $props();

  const labels = ["Alpha", "Bravo", "Charlie"];
</script>

<SearchablePickerShell
  {open}
  label="Test picker"
  bind:query
  bind:activeIndex
  {optionCount}
  optionIdPrefix="test-opt"
  listId="test-picker-list"
  {onClose}
  {onSelect}
>
  {#each labels.slice(0, optionCount) as label, index (index)}
    <SearchablePickerOption {index} active={index === activeIndex} idPrefix="test-opt">
      {label}
    </SearchablePickerOption>
  {/each}
  {#snippet footer()}
    <span>↑↓ navigate · Enter select · Esc close</span>
  {/snippet}
</SearchablePickerShell>
