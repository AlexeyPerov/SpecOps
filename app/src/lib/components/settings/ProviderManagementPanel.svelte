<script lang="ts">
  import { chatStore } from "../../state/chatStore";
  import {
    getOpencodeConfigStore,
    isConfigStoreAvailable,
    loadOpencodeConfigStore,
    removeProviderAuth,
    setProviderApiKey,
    startProviderOAuth,
  } from "../../ai/opencodeConfigStore";
  import type { OpencodeProviderStatus } from "../../ai/backends/workspaceAgentBackend";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const workspaceRoot = $derived(chatStore.getActiveWorkspaceRoot());
  const available = $derived(isConfigStoreAvailable(workspaceRoot));
  const store = $derived(
    workspaceRoot ? getOpencodeConfigStore(workspaceRoot) : null,
  );

  /** Provider id → API key being typed (not yet saved). */
  let apiKeyDrafts = $state<Record<string, string>>({});
  let actionMessage = $state<string | null>(null);
  let wasDialogOpen = false;

  $effect(() => {
    if (dialogOpen && !wasDialogOpen && workspaceRoot && available) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
    wasDialogOpen = dialogOpen;
  });

  function providersOf(): OpencodeProviderStatus[] {
    return store?.providers ?? [];
  }

  function apiKeyDraft(providerId: string): string {
    return apiKeyDrafts[providerId] ?? "";
  }

  function setApiKeyDraft(providerId: string, value: string): void {
    apiKeyDrafts = { ...apiKeyDrafts, [providerId]: value };
  }

  async function handleConnect(providerId: string): Promise<void> {
    if (!workspaceRoot) {
      return;
    }
    const key = apiKeyDraft(providerId).trim();
    actionMessage = null;
    if (key.length === 0) {
      actionMessage = "Enter an API key to connect.";
      return;
    }
    const ok = await setProviderApiKey(workspaceRoot, providerId, key);
    actionMessage = ok ? `Connected ${providerId}.` : `Failed to connect ${providerId}.`;
    if (ok) {
      const next = { ...apiKeyDrafts };
      delete next[providerId];
      apiKeyDrafts = next;
    }
  }

  async function handleOAuth(providerId: string): Promise<void> {
    if (!workspaceRoot) {
      return;
    }
    actionMessage = null;
    const url = await startProviderOAuth(workspaceRoot, providerId);
    if (url) {
      actionMessage = `Opening browser to authorize ${providerId}…`;
      window.open(url, "_blank", "noopener");
    } else {
      actionMessage = `${providerId} does not support OAuth or the flow could not start.`;
    }
  }

  async function handleDisconnect(providerId: string): Promise<void> {
    if (!workspaceRoot) {
      return;
    }
    actionMessage = null;
    const ok = await removeProviderAuth(workspaceRoot, providerId);
    actionMessage = ok ? `Disconnected ${providerId}.` : `Failed to disconnect ${providerId}.`;
  }

  function handleReload(): void {
    if (workspaceRoot) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
  }
</script>

{#if !available}
  <section class="settings-section">
    <h3>Providers</h3>
    <p class="settings-section-note">
      Open a workspace folder with OpenCode enabled to manage providers.
    </p>
  </section>
{:else}
  <section class="settings-section">
    <h3>Providers</h3>
    <p class="settings-section-note">
      Connect AI providers for the active workspace. Keys are stored in OpenCode config, not SpecOps.
    </p>
    {#if store?.status === "loading"}
      <p class="settings-section-note">Loading providers…</p>
    {:else if store?.status === "error"}
      <p class="settings-section-note provider-error">
        {store.lastErrorMessage ?? "Failed to load providers."}
      </p>
      <button type="button" class="settings-action" onclick={handleReload}>Retry</button>
    {:else if providersOf().length === 0}
      <p class="settings-section-note">No providers available. Configure one in your OpenCode config.</p>
    {:else}
      <div class="connection-list">
        {#each providersOf() as provider (provider.id)}
          <div class="connection-row provider-row">
            <div class="provider-row-main">
              <span class="provider-row-name">{provider.name}</span>
              <span
                class="provider-badge"
                class:provider-badge-connected={provider.connected}
                class:provider-badge-off={!provider.connected}
              >
                {provider.connected ? "Connected" : "Not connected"}
              </span>
              <span class="provider-row-meta">{provider.modelCount} models</span>
              {#if provider.source}<span class="provider-row-meta">{provider.source}</span>{/if}
            </div>
            <div class="provider-row-actions">
              {#if provider.connected}
                <button
                  type="button"
                  class="settings-action settings-action-danger"
                  onclick={() => handleDisconnect(provider.id)}
                >
                  Disconnect
                </button>
              {:else}
                <input
                  type="password"
                  class="provider-key-input"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="API key"
                  value={apiKeyDraft(provider.id)}
                  oninput={(event) =>
                    setApiKeyDraft(provider.id, (event.currentTarget as HTMLInputElement).value)}
                />
                <button type="button" class="settings-action" onclick={() => handleConnect(provider.id)}>
                  Connect
                </button>
                <button type="button" class="settings-action" onclick={() => handleOAuth(provider.id)}>
                  OAuth
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if actionMessage}
        <p class="settings-section-note provider-action-message">{actionMessage}</p>
      {/if}
      <button type="button" class="settings-action" onclick={handleReload}>Refresh</button>
    {/if}
  </section>
{/if}

<style>
  .provider-row {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
  }

  .provider-row-main {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .provider-row-name {
    font-weight: 600;
  }

  .provider-row-meta {
    color: var(--color-text-secondary);
    font-size: 0.75rem;
  }

  .provider-row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .provider-key-input {
    flex: 1;
    min-width: 160px;
    min-height: 28px;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
  }

  .provider-badge {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
  }

  .provider-badge-connected {
    color: var(--color-text-success);
    border-color: var(--color-text-success);
  }

  .provider-badge-off {
    color: var(--color-text-secondary);
  }

  .provider-error,
  .provider-action-message {
    color: var(--color-text-secondary);
  }

  .provider-error {
    color: var(--color-text-danger);
  }
</style>
