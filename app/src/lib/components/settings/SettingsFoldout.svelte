<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    nested = false,
    children,
  }: {
    title: string;
    nested?: boolean;
    children: Snippet;
  } = $props();

  let expanded = $state(false);

  function toggle(): void {
    expanded = !expanded;
  }
</script>

<div class="settings-foldout" class:settings-foldout-nested={nested}>
  <button
    type="button"
    class="settings-foldout-trigger"
    aria-expanded={expanded}
    onclick={toggle}
  >
    <span class="settings-foldout-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
    <span class="settings-foldout-title">{title}</span>
  </button>
  {#if expanded}
    <div class="settings-foldout-content">
      {@render children()}
    </div>
  {/if}
</div>
