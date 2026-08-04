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

<section class="settings-section">
  <h3>Performance logging</h3>
  <p class="settings-section-note">
    Capture performance timings (tab/workspace/file-open/git-command) into a bounded
    ring you can download as a report from the console toolbar. Off by default — the
    ring is not allocated while disabled.
  </p>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.logSettings.collectPerfLogs}
      onchange={(event) =>
        appState.updateLogSettings({
          collectPerfLogs: (event.currentTarget as HTMLInputElement).checked,
        })}
    />
    Collect performance logs
  </label>
</section>
