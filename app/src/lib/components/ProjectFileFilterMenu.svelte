<script lang="ts">
  import { PROJECT_FILE_FILTERS, type ProjectFileFilter } from "../services/projectTypeFilter";
  import { clampFixedOverlayPosition } from "./clampFixedOverlayPosition";

  let { value, onSelect }: { value: ProjectFileFilter; onSelect: (value: ProjectFileFilter) => void } = $props();
  const menuId = $props.id();
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);
  let position = $state({ x: 0, y: 0 });
  const label = $derived(PROJECT_FILE_FILTERS.find((option) => option.value === value)?.label ?? "All files");

  function close(restoreFocus = false): void {
    open = false;
    if (restoreFocus) trigger?.focus();
  }
  function outside(event: PointerEvent): void {
    if (open && event.target instanceof Node && !trigger?.contains(event.target) && !menu?.contains(event.target)) close();
  }
  function menuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const current = items.findIndex((item) => item === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }
  $effect(() => {
    if (!open || !trigger || !menu) return;
    const anchor = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    position = clampFixedOverlayPosition(anchor.right - bounds.width, anchor.bottom + 4, bounds.width, bounds.height);
    menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  });
</script>

<svelte:window onpointerdown={outside} onresize={() => close()} />

<button
  bind:this={trigger}
  class={['btn btn-sm btn-ghost project-filter-trigger', { 'project-filter-active': value !== 'all' }]}
  type="button"
  aria-label="Filter project files"
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={open ? menuId : undefined}
  title={`Filter project files: ${label}`}
  onclick={() => { open = !open; }}
  onkeydown={(event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); open = true; }
  }}
>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 3h12L9 8v4l-2 1V8L2 3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
  </svg>
</button>
{#if open}
  <div bind:this={menu} id={menuId} class="project-filter-menu" role="menu" aria-label="Project file filter"
    tabindex="-1" style={`left:${position.x}px;top:${position.y}px`} onkeydown={menuKeydown}>
    {#each PROJECT_FILE_FILTERS as option (option.value)}
      <button type="button" role="menuitemradio" aria-checked={value === option.value} tabindex="-1"
        onclick={() => { onSelect(option.value); close(true); }}>
        <span class="project-filter-check" aria-hidden="true">{value === option.value ? "✓" : ""}</span>
        {option.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .project-filter-trigger { flex: 0 0 24px; width: 24px; padding: 2px; color: var(--color-text-secondary); }
  .project-filter-active { color: var(--color-text-primary); background: var(--color-pressed); }
  .project-filter-menu { position: fixed; z-index: 100; min-width: 185px; max-width: calc(100vw - 8px); padding: 4px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-primary); box-shadow: var(--shadow-overlay); font-size: var(--font-size-status); }
  .project-filter-menu button { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px; border: 0; border-radius: var(--radius-sm); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .project-filter-menu button:hover, .project-filter-menu button:focus-visible { background: var(--color-hover); outline: none; }
  .project-filter-check { flex: 0 0 14px; width: 14px; }
</style>
