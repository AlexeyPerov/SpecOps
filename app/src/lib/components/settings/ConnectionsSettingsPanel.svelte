<script lang="ts">
  import type {
    HttpConnection,
    HttpConnectionSettings,
    OpencodeHealthStatus,
    OpencodeTransportMode,
  } from "../../domain/contracts";
  import { formatModelListForInput, parseModelListInput } from "../../ai/providers/providerModelCatalog";
  import {
    loadOpencodeServerPassword,
    saveConnectionApiKey,
    saveOpencodeServerPassword,
  } from "../../services/providerSecretsStore";
  import {
    DEFAULT_HTTP_CONNECTION_ID,
    defaultHttpConnection,
  } from "../../ai/providers/httpConnectionSettings";
  import { validateOpencodeBaseUrl } from "../../services/opencodeSettings";
  import { appState } from "../../state/appState";
  import { chatStore } from "../../state/chatStore";
  import { confirm } from "@tauri-apps/plugin-dialog";
  import {
    makeHttpConnectionId,
    resolveSelectedListItem,
    resolveSelectedListItemId,
  } from "./settingsPanelActions";
  import { refreshOpencodeCatalog } from "../../ai/opencodeCatalog";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const snapshot = $derived($appState);
  let selectedConnectionId = $state<string | null>(null);
  let opencodeServerPassword = $state("");

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

  function opencodeHealthStatusLabel(status: OpencodeHealthStatus): string {
    switch (status) {
      case "checking":
        return "Checking";
      case "healthy":
        return "Healthy";
      case "degraded":
        return "Degraded";
      case "error":
        return "Error";
      case "unknown":
      default:
        return "Unknown";
    }
  }

  function opencodeHealthStatusClass(status: OpencodeHealthStatus): string {
    switch (status) {
      case "healthy":
        return "opencode-health-good";
      case "degraded":
        return "opencode-health-warn";
      case "error":
        return "opencode-health-bad";
      case "checking":
        return "opencode-health-checking";
      case "unknown":
      default:
        return "opencode-health-unknown";
    }
  }

  function applyOpencodeReconnectState(
    nextOpencode: Partial<{ mode: OpencodeTransportMode; baseUrl: string }>,
  ): void {
    appState.applyPersistedSettings({
      opencode: nextOpencode,
      opencodeHealth: {
        status: "checking",
        source: nextOpencode.mode ?? snapshot.settings.opencode.mode,
        checkedAt: new Date().toISOString(),
        lastErrorMessage: null,
      },
    });
    void chatStore.runAccessPreflight();
  }

  function updateOpencodeMode(mode: OpencodeTransportMode): void {
    if (snapshot.settings.opencode.mode === mode) {
      return;
    }
    applyOpencodeReconnectState({ mode });
  }

  function updateOpencodeBaseUrl(baseUrl: string): void {
    applyOpencodeReconnectState({ baseUrl });
  }

  async function loadOpencodePassword(): Promise<void> {
    opencodeServerPassword = await loadOpencodeServerPassword();
  }

  async function updateOpencodeServerPassword(password: string): Promise<void> {
    opencodeServerPassword = password;
    await saveOpencodeServerPassword(password);
    appState.applyPersistedSettings({
      opencodeHealth: {
        status: "checking",
        source: snapshot.settings.opencode.mode,
        checkedAt: new Date().toISOString(),
        lastErrorMessage: null,
      },
    });
    void chatStore.runAccessPreflight();
  }

  function checkOpencodeConnection(): void {
    appState.applyPersistedSettings({
      opencode: {
        mode: snapshot.settings.opencode.mode,
        baseUrl: snapshot.settings.opencode.baseUrl,
      },
      opencodeHealth: {
        status: "checking",
        source: snapshot.settings.opencode.mode,
        checkedAt: new Date().toISOString(),
        lastErrorMessage: null,
      },
    });
    void chatStore.runAccessPreflight();
  }

  function refreshOpencodeModels(): void {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (workspaceRoot) {
      void refreshOpencodeCatalog(workspaceRoot);
    }
  }

  const opencodeUrlValidationMessage = $derived(
    snapshot.settings.opencode.mode === "url"
      ? validateOpencodeBaseUrl(snapshot.settings.opencode.baseUrl)
      : null,
  );
  const opencodeHealth = $derived(snapshot.settings.opencodeHealth);

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
      void loadOpencodePassword();
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
    HTTP (OpenAI-compatible) connections. API keys are stored in a separate secrets file and are
    never written to chat history or diagnostics.
  </p>
  <div class="settings-subsection">
    <h4>Connection list</h4>
    <button type="button" class="settings-action" onclick={addHttpConnection}>Add connection</button>
    {#if httpConnections().length === 0}
      <p class="settings-section-note">No providers configured yet. Add one to enable HTTP chat.</p>
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
        <select
          value={activeConnection.modelCatalog.defaultModelId}
          onchange={(event) =>
            updateConnectionDefaultModel(
              activeConnection.id,
              (event.currentTarget as HTMLSelectElement).value,
            )}
        >
          {#each activeConnection.modelCatalog.modelIds as modelId (modelId)}
            <option value={modelId}>{modelId}</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}
</section>

<section class="settings-section">
  <h3>Workspaces / OpenCode</h3>
  <p class="settings-section-note">
    Configure workspace transport for OpenCode sidecar or remote URL mode.
  </p>
  <div class="settings-subsection">
    <h4>Transport</h4>
    <label class="settings-toggle">
      <input
        type="radio"
        name="opencode-transport-mode"
        checked={snapshot.settings.opencode.mode === "sidecar"}
        onchange={() => updateOpencodeMode("sidecar")}
      />
      Sidecar (default)
    </label>
    <label class="settings-toggle">
      <input
        type="radio"
        name="opencode-transport-mode"
        checked={snapshot.settings.opencode.mode === "url"}
        onchange={() => updateOpencodeMode("url")}
      />
      URL
    </label>
    {#if snapshot.settings.opencode.mode === "url"}
      <label class="settings-field">
        <span>OpenCode server URL</span>
        <input
          type="url"
          spellcheck="false"
          placeholder="https://opencode.example.com"
          value={snapshot.settings.opencode.baseUrl}
          oninput={(event) =>
            updateOpencodeBaseUrl((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {#if opencodeUrlValidationMessage}
        <p class="settings-section-note opencode-validation-note">{opencodeUrlValidationMessage}</p>
      {/if}
    {/if}
    <label class="settings-field">
      <span>Server password</span>
      <input
        type="password"
        autocomplete="off"
        spellcheck="false"
        placeholder="Enter OpenCode server password"
        value={opencodeServerPassword}
        oninput={(event) =>
          void updateOpencodeServerPassword((event.currentTarget as HTMLInputElement).value)}
      />
    </label>
  </div>
  <div class="settings-subsection">
    <h4>Health</h4>
    <p class="settings-section-note">
      Status:
      <span class={`opencode-health-pill ${opencodeHealthStatusClass(opencodeHealth.status)}`}>
        {opencodeHealthStatusLabel(opencodeHealth.status)}
      </span>
      {#if opencodeHealth.source}
        <span class="opencode-health-source">({opencodeHealth.source})</span>
      {/if}
    </p>
    {#if opencodeHealth.lastErrorMessage}
      <p class="settings-section-note opencode-health-error">{opencodeHealth.lastErrorMessage}</p>
    {/if}
    <button type="button" class="settings-action" onclick={checkOpencodeConnection}>
      Check connection
    </button>
  </div>
  <div class="settings-subsection">
    <h4>Models</h4>
    <p class="settings-section-note">
      Workspace model selection is populated from the OpenCode server catalog.
    </p>
    <button type="button" class="settings-action" onclick={refreshOpencodeModels}>
      Refresh model list
    </button>
  </div>
</section>

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsFormMultiline.css";
  @import "../../styles/settingsDialogForm.css";
  @import "../../styles/settingsPanelLists.css";

  .opencode-validation-note,
  .opencode-health-error {
    color: var(--color-text-danger);
  }

  .opencode-health-pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-3);
    margin-left: var(--space-3);
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .opencode-health-source {
    margin-left: var(--space-2);
  }

  .opencode-health-good {
    color: var(--color-text-success);
  }

  .opencode-health-warn {
    color: var(--color-text-warning);
  }

  .opencode-health-bad {
    color: var(--color-text-danger);
  }

  .opencode-health-checking,
  .opencode-health-unknown {
    color: var(--color-text-secondary);
  }
</style>
