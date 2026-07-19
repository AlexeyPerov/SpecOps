<script lang="ts">
  import { appState } from "../../state/appState";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const snapshot = $derived($appState);
  const chatHttpEnabled = $derived(snapshot.settings.chatHttp.enabled);
  const opencodeEnabled = $derived(snapshot.settings.opencode.enabled);

  function updateChatHttpEnabled(enabled: boolean): void {
    appState.setChatHttpEnabled(enabled);
  }

  function updateOpencodeEnabled(enabled: boolean): void {
    appState.setOpencodeEnabled(enabled);
  }
</script>

<section class="settings-section">
  <h3>Chat (beta)</h3>
  <p class="settings-section-note">
    Experimental HTTP chat context. When enabled, the activity rail shows a
    Chat button and Dev gains Providers, Chat modes, and Debug Provider tabs
    for HTTP configuration. Workspace sessions (OpenCode) are unaffected.
  </p>
  <div class="settings-subsection">
    <label class="settings-toggle" title="Enable Chat (beta) for the HTTP chat context">
      <input
        type="checkbox"
        checked={chatHttpEnabled}
        title="Enable Chat (beta) for the HTTP chat context"
        onchange={(event) =>
          updateChatHttpEnabled((event.currentTarget as HTMLInputElement).checked)}
      />
      Enable Chat (beta)
    </label>
    {#if !chatHttpEnabled}
      <p class="settings-section-note">
        Chat (beta) is off. The activity rail Chat button and the Dev tabs for
        Providers, Chat modes, and Debug Provider are hidden.
      </p>
    {:else}
      <p class="settings-section-note">
        Chat (beta) is on. Configure HTTP providers and Debug Provider in
        the tabs listed below.
      </p>
    {/if}
  </div>
  {#if dialogOpen && chatHttpEnabled}
    <div class="settings-subsection">
      <h4>Chats</h4>
      <p class="settings-section-note">
        <strong>Providers</strong> — OpenAI-compatible HTTP connections.<br />
        <strong>Chat modes</strong> — Per-mode prompt and tool toggles.<br />
        <strong>Debug Provider</strong> — Local simulator for development.
      </p>
    </div>
  {/if}
</section>

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