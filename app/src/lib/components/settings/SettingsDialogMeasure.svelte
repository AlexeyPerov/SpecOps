<script lang="ts">
  import type { Snippet } from "svelte";
  import { SETTINGS_TABS, type SettingsDialogTab } from "../../services/settingsDialogUi";

  let {
    settingsPanel,
    headerEl = $bindable(null),
    tabMeasureEls = $bindable({} as Partial<Record<SettingsDialogTab, HTMLElement>>),
  }: {
    settingsPanel: Snippet<[SettingsDialogTab]>;
    headerEl?: HTMLElement | null;
    tabMeasureEls?: Partial<Record<SettingsDialogTab, HTMLElement>>;
  } = $props();
</script>

<div class="settings-dialog-measure" aria-hidden="true">
  <div bind:this={headerEl} class="settings-dialog-header settings-dialog-header-measure">
    <h2 class="settings-dialog-title">Settings</h2>
  </div>
  {#each SETTINGS_TABS as tab (tab.id)}
    <div
      class="settings-dialog-body settings-dialog-body-measure"
      bind:this={tabMeasureEls[tab.id]}
    >
      {@render settingsPanel(tab.id)}
    </div>
  {/each}
</div>
