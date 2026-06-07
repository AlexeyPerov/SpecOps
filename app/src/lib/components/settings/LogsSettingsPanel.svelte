<script lang="ts">
  import { appState } from "../../state/appState";

  const snapshot = $derived($appState);
</script>

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
