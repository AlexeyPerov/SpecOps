<script lang="ts">
  import { classifyProjectFileIcon } from "../../services/projectFileIcon";
  import { projectFileSymbols } from "./projectFileSymbols";

  let { name, size = 16, colored = true }: { name: string; size?: number; colored?: boolean } = $props();
  const kind = $derived(classifyProjectFileIcon(name));
  const symbol = $derived(projectFileSymbols[kind]);
</script>

<svg
  width={size} height={size} viewBox="0 0 16 16" fill="none"
  class="project-file-icon color-{symbol.color}"
  class:monochrome={!colored}
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
  .color-blue { color: var(--project-file-icon-blue, #61aed5); }
  .color-yellow { color: var(--project-file-icon-yellow, #c6cf49); }
  .color-orange { color: var(--project-file-icon-orange, #dd9469); }
  .color-purple { color: var(--project-file-icon-purple, #b693dd); }
  .color-green { color: var(--project-file-icon-green, #82b591); }
  .color-red { color: var(--project-file-icon-red, #df8390); }
  .project-file-icon.monochrome { color: var(--color-text-secondary); }
</style>
