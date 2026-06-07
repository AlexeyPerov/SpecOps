<script lang="ts">
  import type { NearbyTextFile } from "../services/nearbyFiles";

  interface Props {
    open?: boolean;
    enabled?: boolean;
    loading?: boolean;
    files?: NearbyTextFile[];
    menuEl?: HTMLDivElement | null;
    onOpenChange?: (open: boolean) => void;
    onOpenFile?: (path: string) => void;
    onOpenAll?: () => void;
  }

  let {
    open = false,
    enabled = false,
    loading = false,
    files = [],
    menuEl = null,
    onOpenChange = () => {},
    onOpenFile = () => {},
    onOpenAll = () => {},
  }: Props = $props();

  const hasFiles = $derived(files.length > 0);
</script>

<div
  class="tab-context-submenu"
  role="none"
  onpointerenter={() => {
    if (enabled) {
      onOpenChange(true);
    }
  }}
  onpointerleave={() => onOpenChange(false)}
  onfocusin={() => {
    if (enabled) {
      onOpenChange(true);
    }
  }}
  onfocusout={(event) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !menuEl?.contains(nextTarget)) {
      onOpenChange(false);
    }
  }}
>
  <button
    class="tab-context-item tab-context-item-submenu"
    type="button"
    role="menuitem"
    aria-haspopup="menu"
    aria-expanded={open}
    disabled={!enabled}
    onpointerdown={(event) => {
      event.stopPropagation();
      if (enabled) {
        onOpenChange(true);
      }
    }}
  >
    <span>Open Nearby</span>
    <span class="tab-context-chevron">›</span>
  </button>
  {#if open && enabled}
    <div class="tab-context-submenu-panel" role="menu">
      {#if loading}
        <button class="tab-context-item" type="button" role="menuitem" disabled>Loading...</button>
      {:else if !hasFiles}
        <button class="tab-context-item" type="button" role="menuitem" disabled>
          No nearby files
        </button>
      {:else}
        {#each files as nearbyFile (nearbyFile.path)}
          <button
            class="tab-context-item"
            type="button"
            role="menuitem"
            onpointerdown={(event) => {
              event.stopPropagation();
              onOpenFile(nearbyFile.path);
            }}
          >
            {nearbyFile.basename}
          </button>
        {/each}
      {/if}

      <div class="tab-context-separator" role="separator"></div>

      <button
        class="tab-context-item"
        type="button"
        role="menuitem"
        disabled={!hasFiles}
        onpointerdown={(event) => {
          event.stopPropagation();
          if (hasFiles) {
            onOpenAll();
          }
        }}
      >
        Open All Nearby
      </button>
    </div>
  {/if}
</div>
