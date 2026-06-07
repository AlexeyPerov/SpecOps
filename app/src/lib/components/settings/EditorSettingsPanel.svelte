<script lang="ts">
  import type { ExternalFilesSettings } from "../../domain/contracts";
  import { appState } from "../../state/appState";
  import {
    normalizeMaxBinaryOpenAsTextFromKb,
    normalizeMaxOpenWithoutConfirmFromKb,
  } from "./settingsPanelActions";

  const snapshot = $derived($appState);

  function updateExternalFilesSetting(
    key: keyof ExternalFilesSettings,
    value: boolean | number,
  ): void {
    const current = appState.getSnapshot().settings.externalFiles;
    appState.setExternalFilesSettings({
      ...current,
      [key]: value,
    });
  }

  function updateMaxBinaryOpenAsTextKb(rawValue: string): void {
    const normalizedBytes = normalizeMaxBinaryOpenAsTextFromKb(rawValue);
    if (normalizedBytes === null) {
      return;
    }
    updateExternalFilesSetting("maxBinaryOpenAsTextBytes", normalizedBytes);
  }

  function updateMaxOpenWithoutConfirmKb(rawValue: string): void {
    const normalizedBytes = normalizeMaxOpenWithoutConfirmFromKb(rawValue);
    if (normalizedBytes === null) {
      return;
    }
    updateExternalFilesSetting("maxOpenWithoutConfirmBytes", normalizedBytes);
  }
</script>

<section class="settings-section">
  <h3>Layout</h3>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.hideActivityRailWhenNotepadOnly}
      onchange={(event) =>
        appState.setHideActivityRailWhenNotepadOnly(
          (event.currentTarget as HTMLInputElement).checked,
        )}
    />
    Hide activity rail when Notepad only
  </label>
</section>

<section class="settings-section">
  <h3>External files</h3>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.externalFiles.watchExternalChanges}
      onchange={(event) =>
        updateExternalFilesSetting(
          "watchExternalChanges",
          (event.currentTarget as HTMLInputElement).checked,
        )}
    />
    Watch external file changes
  </label>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.externalFiles.autoReloadCleanFiles}
      disabled={!snapshot.settings.externalFiles.watchExternalChanges}
      onchange={(event) =>
        updateExternalFilesSetting(
          "autoReloadCleanFiles",
          (event.currentTarget as HTMLInputElement).checked,
        )}
    />
    Reload clean files automatically
  </label>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.externalFiles.checkOnWindowFocus}
      disabled={!snapshot.settings.externalFiles.watchExternalChanges}
      onchange={(event) =>
        updateExternalFilesSetting(
          "checkOnWindowFocus",
          (event.currentTarget as HTMLInputElement).checked,
        )}
    />
    Check when window gains focus
  </label>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={snapshot.settings.externalFiles.checkOnTabActivate}
      disabled={!snapshot.settings.externalFiles.watchExternalChanges}
      onchange={(event) =>
        updateExternalFilesSetting(
          "checkOnTabActivate",
          (event.currentTarget as HTMLInputElement).checked,
        )}
    />
    Check when tab becomes active
  </label>
  <label class="settings-field">
    <span>Max file size to open without confirmation (KB)</span>
    <input
      type="number"
      min="1"
      max="10240"
      step="1"
      value={Math.round(snapshot.settings.externalFiles.maxOpenWithoutConfirmBytes / 1024)}
      onchange={(event) =>
        updateMaxOpenWithoutConfirmKb((event.currentTarget as HTMLInputElement).value)}
    />
  </label>
  <p class="settings-section-note">
    Text-editor files larger than this limit open a tab with a confirmation step before loading
    contents. The confirmation is shown again after app relaunch.
  </p>
  <label class="settings-field">
    <span>Max binary file size to open as text (KB)</span>
    <input
      type="number"
      min="1"
      max="10240"
      step="1"
      value={Math.round(snapshot.settings.externalFiles.maxBinaryOpenAsTextBytes / 1024)}
      onchange={(event) =>
        updateMaxBinaryOpenAsTextKb((event.currentTarget as HTMLInputElement).value)}
    />
  </label>
  <p class="settings-section-note">
    Non-image binary files larger than this limit show a size notice instead of loading into the
    text editor.
  </p>
</section>

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsFormMultiline.css";
  @import "../../styles/settingsDialogForm.css";
</style>
