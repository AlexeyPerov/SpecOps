<script lang="ts">
  import { appState } from "../../state/appState";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const snapshot = $derived($appState);
  const opencodeEnabled = $derived(snapshot.settings.opencode.enabled);

  function updateOpencodeEnabled(enabled: boolean): void {
    appState.setOpencodeEnabled(enabled);
  }
</script>

<section class="settings-section">
  <h3>OpenCode (beta)</h3>
  <p class="settings-section-note">
    Experimental workspace sessions backend. When enabled, workspaces gain a
    Sessions sidebar, the activity rail shows per-workspace session counts,
    and Settings gains a Workspaces section with OpenCode, Config, Providers,
    MCP servers, Agents, Permissions, Commands, and Instructions tabs.
  </p>
  <div class="settings-subsection">
    <label class="settings-toggle" title="Enable OpenCode (beta) for workspace sessions">
      <input
        type="checkbox"
        checked={opencodeEnabled}
        title="Enable OpenCode (beta) for workspace sessions"
        onchange={(event) =>
          updateOpencodeEnabled((event.currentTarget as HTMLInputElement).checked)}
      />
      Enable OpenCode (beta)
    </label>
    {#if !opencodeEnabled}
      <p class="settings-section-note">
        OpenCode (beta) is off. Workspace folders open as editors without
        sessions, the Sessions sidebar and per-workspace session counts are
        hidden, and the Workspaces settings section is removed. Any open
        session tabs are closed.
      </p>
    {:else}
      <p class="settings-section-note">
        OpenCode (beta) is on. Configure transport, providers, MCP servers,
        agents, permissions, commands, and instructions in the Workspaces
        section.
      </p>
    {/if}
  </div>
</section>
