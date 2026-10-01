<script lang="ts">
  let { expanded = false, visible = true }: { expanded?: boolean; visible?: boolean } = $props();
</script>

<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
  class="tree-chevron" class:expanded class:invisible={!visible}>
  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.35"
    stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  .tree-chevron { flex-shrink: 0; color: var(--color-text-secondary); transition: transform var(--motion-fast) var(--easing-standard); }
  .expanded { transform: rotate(90deg); }
  .invisible { visibility: hidden; }
  @media (prefers-reduced-motion: reduce) { .tree-chevron { transition: none; } }
</style>
