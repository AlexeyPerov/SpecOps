<script lang="ts">
  import { appState } from "../../state/appState";
  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();
  const enabled = $derived($appState.settings.sessionsEnabled);
</script>
<section class="settings-section">
  <h3>Workspace sessions</h3>
  <p class="settings-section-note">Choose a runtime and an isolated account profile in a new session. Existing native sessions keep their runtime and profile.</p>
  <label class="settings-toggle">
    <input type="checkbox" checked={enabled} onchange={event => appState.setSessionsEnabled(event.currentTarget.checked)} />
    Enable workspace sessions
  </label>
  <label class="settings-toggle"><input type="checkbox" checked={$appState.settings.warnConcurrentWriters} onchange={event => appState.applyPersistedSettings({ warnConcurrentWriters: event.currentTarget.checked })} />Warn before starting another possible writer</label>
  <p class="settings-section-note">Sessions share workspace files. Native write capability may be unknown. Stop does not undo files; use git or manual recovery.</p>
  {#if !enabled}<p class="settings-section-note">Workspace sessions are disabled. Open session tabs are closed.</p>{/if}
</section>
