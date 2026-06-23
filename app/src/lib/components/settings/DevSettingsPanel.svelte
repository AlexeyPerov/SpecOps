<script lang="ts">
  import { appState } from "../../state/appState";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const snapshot = $derived($appState);
  const chatHttpEnabled = $derived(snapshot.settings.chatHttp.enabled);

  function updateChatHttpEnabled(enabled: boolean): void {
    appState.setChatHttpEnabled(enabled);
  }
</script>

<section class="settings-section">
  <h3>Chat (beta)</h3>
  <p class="settings-section-note">
    Experimental HTTP chat context. When enabled, the activity rail shows a
    Chat button and the Chats subtree appears under Dev for HTTP provider
    configuration. Workspace agents (OpenCode) are unaffected.
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
        Chat (beta) is off. The activity rail Chat button and Chats settings
        tabs (Providers, Chat modes, Debug Provider) are hidden.
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