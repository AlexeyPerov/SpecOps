<script lang="ts">
  import { onMount, untrack, type Snippet } from "svelte";

  let { storageKey, label, vertical = false, initial = 0.35, minFirst = 120,
    minSecond = 160, collapsed = false, collapseSecond = false, first, second }: {
    storageKey: string; label: string; vertical?: boolean; initial?: number;
    minFirst?: number; minSecond?: number; collapsed?: boolean; collapseSecond?: boolean;
    first: Snippet; second: Snippet;
  } = $props();
  let host: HTMLDivElement;
  let extent = $state(0);
  let ratio = $state(0.35);
  let dragging = $state<number | null>(null);
  let startPosition = 0;
  let startSize = 0;
  const available = $derived(Math.max(0, extent - 6));
  const minimum = $derived(Math.min(minFirst, available * minFirst / (minFirst + minSecond)));
  const maximum = $derived(Math.max(minimum, available - Math.min(minSecond, available * minSecond / (minFirst + minSecond))));
  const size = $derived(Math.max(minimum, Math.min(maximum, available * ratio)));

  $effect(() => {
    const key = storageKey;
    const fallback = initial;
    untrack(() => {
      dragging = null;
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null");
        ratio = typeof saved === "number" && Number.isFinite(saved) && saved > 0 && saved < 1 ? saved : fallback;
      } catch { ratio = fallback; }
    });
  });

  onMount(() => {
    const measure = () => { extent = vertical ? host.clientHeight : host.clientWidth; };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    return () => observer.disconnect();
  });

  function save(value: number): void {
    ratio = value;
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Layout remains usable when storage is unavailable. */ }
  }
  function resize(value: number): void {
    if (available > 0) save(Math.max(minimum, Math.min(maximum, value)) / available);
  }
  function keydown(event: KeyboardEvent): void {
    const increase = vertical ? "ArrowDown" : "ArrowRight";
    const decrease = vertical ? "ArrowUp" : "ArrowLeft";
    if (event.key === increase || event.key === decrease) {
      event.preventDefault();
      resize(size + (event.key === increase ? 1 : -1) * (event.shiftKey ? 40 : 10));
    } else if (event.key === "Home" || event.key === "Enter") {
      event.preventDefault(); save(initial);
    } else if (event.key === "End") { event.preventDefault(); resize(maximum); }
  }
  function start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = event.pointerId;
    startPosition = vertical ? event.clientY : event.clientX;
    startSize = size;
    (event.currentTarget as HTMLElement).focus();
  }
  function move(event: PointerEvent): void {
    if (dragging !== event.pointerId) return;
    resize(startSize + (vertical ? event.clientY : event.clientX) - startPosition);
  }
  function stop(event: PointerEvent): void {
    if (dragging === event.pointerId) dragging = null;
  }
</script>

<svelte:window onpointermove={move} onpointerup={stop} onpointercancel={stop} onblur={() => dragging = null} />
<div class="workspace-split" class:vertical class:dragging={dragging !== null} bind:this={host}
  style:grid-template-columns={vertical ? undefined : collapsed ? collapseSecond ? "minmax(0, 1fr) 0px 0px" : "0px 0px minmax(0, 1fr)" : `${size}px 6px minmax(0, 1fr)`}
  style:grid-template-rows={vertical ? collapsed ? collapseSecond ? "minmax(0, 1fr) 0px 0px" : "0px 0px minmax(0, 1fr)" : `${size}px 6px minmax(0, 1fr)` : undefined}>
  <div class="workspace-split-pane" hidden={collapsed && !collapseSecond}>{@render first()}</div>
  <!-- A focusable separator implements the WAI-ARIA window splitter pattern. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="workspace-split-handle" role="separator" tabindex={collapsed ? -1 : 0} hidden={collapsed}
    aria-label={label} aria-orientation={vertical ? "horizontal" : "vertical"}
    aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(size)}
    title={`${label}. Arrow keys resize; Home or Enter resets; double-click resets.`}
    onkeydown={keydown} onpointerdown={start} ondblclick={() => save(initial)}></div>
  <div class="workspace-split-pane" hidden={collapsed && collapseSecond}>{@render second()}</div>
</div>

<style>
  .workspace-split { display: grid; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
  .workspace-split-pane { min-width: 0; min-height: 0; overflow: hidden; }
  .workspace-split-handle { cursor: col-resize; touch-action: none; background: var(--color-border-subtle); }
  .vertical > .workspace-split-handle { cursor: row-resize; }
  .workspace-split-handle:hover, .workspace-split-handle:focus-visible, .dragging > .workspace-split-handle { background: var(--color-accent); }
  .workspace-split-handle:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
  .dragging { user-select: none; }
</style>
