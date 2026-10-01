<script lang="ts">
  import { classifyProjectFileIcon } from "../../services/projectFileIcon";
  import { projectFileSymbols } from "./projectFileSymbols";

  let { name, size = 16 }: { name: string; size?: number } = $props();
  const kind = $derived(classifyProjectFileIcon(name));
  const symbol = $derived(projectFileSymbols[kind]);
</script>

<svg
  width={size} height={size} viewBox="0 0 16 16" fill="none"
  class="project-file-icon color-{symbol.color}"
  data-file-icon={kind} aria-hidden="true" xmlns="http://www.w3.org/2000/svg"
>
  {#each symbol.paths as path}
    <path d={path.d}
      fill={path.solid ? "currentColor" : "none"}
      fill-rule="evenodd"
      stroke={path.solid ? "none" : "currentColor"}
      stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"
    />
  {/each}
  {#if "label" in symbol && symbol.label}
    <text x="8" y="11.5" text-anchor="middle" fill="currentColor"
      font-family="ui-monospace, monospace" font-size={symbol.label.length > 1 ? 9 : 12}
      font-weight="600">{symbol.label}</text>
  {/if}
</svg>

<style>
  .project-file-icon { flex-shrink: 0; }
  .color-neutral { color: var(--color-text-secondary); }
  .color-blue { color: light-dark(#247bb0, #61aed5); }
  .color-yellow { color: light-dark(#93800a, #c6cf49); }
  .color-orange { color: light-dark(#be6537, #dd9469); }
  .color-purple { color: light-dark(#8257b3, #b693dd); }
  .color-green { color: light-dark(#438459, #82b591); }
  .color-red { color: light-dark(#bf4d59, #df8390); }
</style>
