<script lang="ts">
  import Select from "../Select.svelte";
  import type { HttpConnection, HttpConnectionSettings } from "../../domain/contracts";
  import { formatModelListForInput, parseModelListInput } from "../../ai/providers/providerModelCatalog";
  import { saveConnectionApiKey } from "../../services/providerSecretsStore";
  import {
    DEFAULT_HTTP_CONNECTION_ID,
    defaultHttpConnection,
  } from "../../ai/providers/httpConnectionSettings";
  import { appState } from "../../state/appState";
  import { chatStore } from "../../state/chatStore";
  import { confirm } from "@tauri-apps/plugin-dialog";
  import {
    makeHttpConnectionId,
    resolveSelectedListItem,
    resolveSelectedListItemId,
  } from "./settingsPanelActions";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const snapshot = $derived($appState);
  let selectedConnectionId = $state<string | null>(null);

  function httpConnections(): HttpConnection[] {
    return snapshot.settings.providerSettings.httpConnections ?? [];
  }

  function activeHttpConnection(): HttpConnection {
    const connections = httpConnections();
    const fallback = connections[0] ?? { ...defaultHttpConnection, id: DEFAULT_HTTP_CONNECTION_ID };
    return resolveSelectedListItem(selectedConnectionId, connections) ?? fallback;
  }

  function updateHttpConnectionSetting(
    key: keyof HttpConnectionSettings,
    value: HttpConnectionSettings[keyof HttpConnectionSettings],
  ): void {
    const connection = activeHttpConnection();
    appState.updateHttpConnection(connection.id, { [key]: value });
    appState.updateHttpConnectionSettings({ [key]: value });
    void chatStore.runAccessPreflight();
  }

  async function updateHttpApiKey(rawValue: string): Promise<void> {
    const connection = activeHttpConnection();
    appState.setConnectionApiKey(connection.id, rawValue);
    await saveConnectionApiKey(connection.id, rawValue);
    void chatStore.runAccessPreflight();
  }

  function updateConnectionModelList(connectionId: string, rawValue: string): void {
    const connection = httpConnections().find((entry) => entry.id === connectionId);
    if (!connection) {
      return;
    }
    const modelIds = parseModelListInput(rawValue);
    const currentCatalog = connection.modelCatalog;
    appState.updateHttpConnection(connectionId, {
      modelCatalog: {
        modelIds,
        defaultModelId: currentCatalog.defaultModelId,
      },
    });
    void chatStore.runAccessPreflight();
  }

  function updateConnectionDefaultModel(connectionId: string, defaultModelId: string): void {
    const connection = httpConnections().find((entry) => entry.id === connectionId);
    if (!connection) {
      return;
    }
    appState.updateHttpConnection(connectionId, {
      modelCatalog: {
        ...connection.modelCatalog,
        defaultModelId,
      },
    });
    void chatStore.runAccessPreflight();
  }

  function addHttpConnection(): void {
    const connections = httpConnections();
    const id = makeHttpConnectionId(
      `provider-${connections.length + 1}`,
      connections.map((connection) => connection.id),
    );
    const next: HttpConnection = {
      ...defaultHttpConnection,
      id,
      label: `Provider ${connections.length + 1}`,
      enabled: true,
    };
    appState.addHttpConnection(next);
    appState.setDefaultConnectionId(snapshot.settings.providerSettings.defaultConnectionId ?? id);
    selectedConnectionId = id;
    void chatStore.runAccessPreflight();
  }

  async function removeHttpConnection(connectionId: string): Promise<void> {
    appState.removeHttpConnection(connectionId);
    await saveConnectionApiKey(connectionId, "");
    const remaining = httpConnections().filter((connection) => connection.id !== connectionId);
    selectedConnectionId = remaining[0]?.id ?? null;
    void chatStore.runAccessPreflight();
  }

  async function confirmRemoveHttpConnection(connectionId: string): Promise<void> {
    const connection = httpConnections().find((entry) => entry.id === connectionId);
    const label = connection?.label ?? "this connection";
    const confirmed = await confirm(`Remove provider "${label}"?`, {
      title: "Remove connection",
      okLabel: "Remove",
      cancelLabel: "Cancel",
      kind: "warning",
    });
    if (!confirmed) {
      return;
    }
    await removeHttpConnection(connectionId);
  }

  function selectConnection(connectionId: string): void {
    selectedConnectionId = connectionId;
  }

  function setDefaultConnection(connectionId: string): void {
    appState.setDefaultConnectionId(connectionId);
    if (!selectedConnectionId) {
      selectedConnectionId = connectionId;
    }
  }

  let wasDialogOpen = false;

  $effect(() => {
    if (dialogOpen && !wasDialogOpen) {
      selectedConnectionId =
        snapshot.settings.providerSettings.defaultConnectionId ??
        httpConnections()[0]?.id ??
        null;
    }
    wasDialogOpen = dialogOpen;
  });

  $effect(() => {
    selectedConnectionId = resolveSelectedListItemId(
      selectedConnectionId,
      httpConnections().map((connection) => connection.id),
      snapshot.settings.providerSettings.defaultConnectionId,
    );
  });
</script>

<section class="settings-section">
  <h3>Providers</h3>
  <p class="settings-section-note">
    HTTP (OpenAI-compatible) connections for Chat context. API keys are stored in a separate secrets
    file and are never written to chat history or diagnostics.
  </p>
  <div class="settings-subsection">
    <h4>Connection list</h4>
    <button type="button" class="settings-action" onclick={addHttpConnection}>Add connection</button>
    {#if httpConnections().length === 0}
      <p class="settings-section-note">No providers configured yet. Add one to enable Chat context.</p>
    {:else}
      <div class="connection-list" role="listbox" aria-label="HTTP connections">
        {#each httpConnections() as connection (connection.id)}
          <div
            class="connection-row"
            class:connection-row-active={connection.id === activeHttpConnection().id}
            role="option"
            aria-selected={connection.id === activeHttpConnection().id}
          >
            <button
              type="button"
              class="connection-row-select"
              onclick={() => selectConnection(connection.id)}
            >
              <span>{connection.label}</span>
              {#if snapshot.settings.providerSettings.defaultConnectionId === connection.id}
                <small>Default</small>
              {/if}
            </button>
            <button
              type="button"
              class="connection-row-remove settings-action settings-action-danger"
              disabled={httpConnections().length <= 1}
              aria-label={`Remove ${connection.label}`}
              onclick={() => void confirmRemoveHttpConnection(connection.id)}
            >
              Remove
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {#if httpConnections().length > 0}
    {@const activeConnection = activeHttpConnection()}
    <div class="settings-subsection settings-subsection-separated">
      <h4>Selected connection</h4>
      <label class="settings-field">
        <span>Label</span>
        <input
          type="text"
          value={activeConnection.label}
          onchange={(event) =>
            appState.updateHttpConnection(activeConnection.id, {
              label: (event.currentTarget as HTMLInputElement).value,
            })}
        />
      </label>
      <label class="settings-field">
        <span>Base URL</span>
        <input
          type="url"
          spellcheck="false"
          value={activeConnection.baseUrl}
          onchange={(event) =>
            updateHttpConnectionSetting("baseUrl", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={activeConnection.enabled}
          onchange={(event) =>
            updateHttpConnectionSetting(
              "enabled",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Enabled
      </label>
      <label class="settings-toggle">
        <input
          type="radio"
          name="default-http-connection"
          checked={snapshot.settings.providerSettings.defaultConnectionId === activeConnection.id}
          onchange={() => setDefaultConnection(activeConnection.id)}
        />
        Use as default
      </label>
    </div>
    <div class="settings-subsection">
      <h4>Credentials</h4>
      <label class="settings-field">
        <span>API key</span>
        <input
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="Enter API key"
          value={snapshot.settings.providerApiKeys[activeConnection.id] ?? ""}
          oninput={(event) => void updateHttpApiKey((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>
    <div class="settings-subsection">
      <h4>Models</h4>
      <label class="settings-field">
        <span>Model list</span>
        <textarea
          rows={Math.max(3, activeConnection.modelCatalog.modelIds.length + 1)}
          spellcheck="false"
          value={formatModelListForInput(activeConnection.modelCatalog.modelIds)}
          onchange={(event) =>
            updateConnectionModelList(
              activeConnection.id,
              (event.currentTarget as HTMLTextAreaElement).value,
            )}
        ></textarea>
      </label>
      <label class="settings-field">
        <span>Default model</span>
        <Select
          options={activeConnection.modelCatalog.modelIds.map((id: string) => ({ value: id, label: id }))}
          value={activeConnection.modelCatalog.defaultModelId}
          onchange={(value) => updateConnectionDefaultModel(activeConnection.id, value)}
          ariaLabel="Select default model"
        />
      </label>
    </div>
  {/if}
</section>
