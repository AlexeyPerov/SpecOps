<script lang="ts">
  import { appState } from "../../state/appState";

  const snapshot = $derived($appState);
</script>

<section class="settings-section">
  <h3>Logs panel</h3>
  <p class="settings-section-note">
    When enabled, the status bar can open the bottom logs panel.
  </p>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.logSettings.canOpenLogsPanel}
      onchange={(event) =>
        appState.updateLogSettings({
          canOpenLogsPanel: (event.currentTarget as HTMLInputElement).checked,
        })}
    />
    Can open logs panel
  </label>
</section>

<section class="settings-section">
  <h3>Provider logging</h3>
  <p class="settings-section-note">
    Verbose logging writes full provider request and response payloads to the console.
  </p>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.logSettings.verboseProviderLogging}
      onchange={(event) =>
        appState.updateLogSettings({
          verboseProviderLogging: (event.currentTarget as HTMLInputElement).checked,
        })}
    />
    Verbose provider logging
  </label>
</section>

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsDialogForm.css";
</style>
