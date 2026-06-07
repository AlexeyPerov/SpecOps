<script lang="ts">
  import type { ChatProviderId, DebugProviderSettings } from "../../domain/contracts";
  import { appState } from "../../state/appState";
  import ProviderModelCatalogPanel from "./ProviderModelCatalogPanel.svelte";
  import {
    parseDebugProviderNumberSetting,
    parseDebugProviderSeed,
    type DebugProviderNumberKey,
    type DebugSettingsScope,
  } from "./settingsPanelActions";

  let {
    settingsScope,
    catalogProviderId,
    title,
    note,
    enableLabel,
  }: {
    settingsScope: DebugSettingsScope;
    catalogProviderId: ChatProviderId;
    title: string;
    note: string;
    enableLabel: string;
  } = $props();

  const snapshot = $derived($appState);
  const debugSettings = $derived(snapshot.settings.providerSettings[settingsScope]);

  function updateScopedDebugProviderSetting(
    key: keyof DebugProviderSettings,
    value: DebugProviderSettings[keyof DebugProviderSettings],
  ): void {
    if (settingsScope === "debugChat") {
      appState.updateDebugChatProviderSettings({ [key]: value });
      return;
    }
    appState.updateDebugWorkspaceProviderSettings({ [key]: value });
  }

  function updateScopedDebugProviderNumberSetting(
    key: DebugProviderNumberKey,
    rawValue: string,
  ): void {
    updateScopedDebugProviderSetting(key, parseDebugProviderNumberSetting(key, rawValue));
  }

  function updateScopedDebugProviderSeed(rawValue: string): void {
    updateScopedDebugProviderSetting("simulationSeed", parseDebugProviderSeed(rawValue));
  }
</script>

<section class="settings-section">
  <h3>{title}</h3>
  <p class="settings-section-note">{note}</p>
  <div class="settings-subsection">
    <h4>Enable</h4>
    <label class="settings-toggle">
      <input
        type="checkbox"
        checked={debugSettings.enabled}
        onchange={(event) =>
          updateScopedDebugProviderSetting(
            "enabled",
            (event.currentTarget as HTMLInputElement).checked,
          )}
      />
      {enableLabel}
    </label>
  </div>
  <div class="settings-subsection">
    <h4>Simulation</h4>
    <label class="settings-field">
      <span>Simulation seed</span>
      <input
        type="text"
        inputmode="numeric"
        placeholder="Random"
        value={debugSettings.simulationSeed ?? ""}
        oninput={(event) =>
          updateScopedDebugProviderSeed((event.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <label class="settings-field">
      <span>Delay min (ms)</span>
      <input
        type="number"
        min="0"
        value={debugSettings.delayMsMin}
        onchange={(event) =>
          updateScopedDebugProviderNumberSetting(
            "delayMsMin",
            (event.currentTarget as HTMLInputElement).value,
          )}
      />
    </label>
    <label class="settings-field">
      <span>Delay max (ms)</span>
      <input
        type="number"
        min="0"
        value={debugSettings.delayMsMax}
        onchange={(event) =>
          updateScopedDebugProviderNumberSetting(
            "delayMsMax",
            (event.currentTarget as HTMLInputElement).value,
          )}
      />
    </label>
    <label class="settings-field">
      <span>Chunk min (chars)</span>
      <input
        type="number"
        min="1"
        value={debugSettings.chunkCharsMin}
        onchange={(event) =>
          updateScopedDebugProviderNumberSetting(
            "chunkCharsMin",
            (event.currentTarget as HTMLInputElement).value,
          )}
      />
    </label>
    <label class="settings-field">
      <span>Chunk max (chars)</span>
      <input
        type="number"
        min="1"
        value={debugSettings.chunkCharsMax}
        onchange={(event) =>
          updateScopedDebugProviderNumberSetting(
            "chunkCharsMax",
            (event.currentTarget as HTMLInputElement).value,
          )}
      />
    </label>
    <label class="settings-field">
      <span>Failure probability</span>
      <input
        type="number"
        min="0"
        max="1"
        step="0.01"
        value={debugSettings.failureProbability}
        onchange={(event) =>
          updateScopedDebugProviderNumberSetting(
            "failureProbability",
            (event.currentTarget as HTMLInputElement).value,
          )}
      />
    </label>
    <label class="settings-field">
      <span>Failure message</span>
      <input
        type="text"
        value={debugSettings.failureMessage}
        onchange={(event) =>
          updateScopedDebugProviderSetting(
            "failureMessage",
            (event.currentTarget as HTMLInputElement).value,
          )}
      />
    </label>
  </div>
  <div class="settings-subsection">
    <h4>Output</h4>
    <label class="settings-toggle">
      <input
        type="checkbox"
        checked={debugSettings.includeDiagnostics}
        onchange={(event) =>
          updateScopedDebugProviderSetting(
            "includeDiagnostics",
            (event.currentTarget as HTMLInputElement).checked,
          )}
      />
      Include diagnostics appendix in replies
    </label>
  </div>
  <ProviderModelCatalogPanel providerId={catalogProviderId} heading="Models" />
</section>

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsFormMultiline.css";
  @import "../../styles/settingsDialogForm.css";
</style>
