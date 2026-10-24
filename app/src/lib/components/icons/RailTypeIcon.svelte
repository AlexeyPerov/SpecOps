<script lang="ts">
  let { kind, size = 18 }: { kind: 'workspace' | 'tabGroup' | 'tasks' | 'notes' | 'folder'; size?: number } = $props();
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if kind === 'tabGroup'}
    <rect x="3" y="7" width="15" height="14" rx="2" /><path d="M7 3h12a2 2 0 0 1 2 2v12M3 11h15" />
  {:else if kind === 'tasks'}
    <rect x="3" y="3" width="18" height="18" rx="3" /><path d="m7 9 2 2 4-4M7 16h10" />
  {:else if kind === 'notes'}
    <path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10Z M14 3v7h7M7 14h10M7 17h7" />
  {:else if kind === 'folder'}
    <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  {:else}
    <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18M9 9v12" />
  {/if}
</svg>
