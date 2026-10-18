<script lang="ts">
  import WorkspaceSwitcherPicker from './WorkspaceSwitcherPicker.svelte';
  let { onClose = () => {} }: { onClose?: () => void } = $props();
  let open = $state(false);
</script>
<button type="button" class="opener" onclick={() => { open = true; }}>Switch</button>
<WorkspaceSwitcherPicker {open} currentWindowId="main" onClose={() => { open = false; onClose(); }} />
