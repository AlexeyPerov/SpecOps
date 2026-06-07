<script lang="ts">
  import { tick } from "svelte";
  import type {
    ChatProviderId,
    DebugProviderSettings,
    ExternalFilesSettings,
    HttpConnection,
    HttpConnectionSettings,
  } from "../domain/contracts";
  import {
    formatModelListForInput,
    getProviderModelCatalog,
    parseModelListInput,
  } from "../ai/providers/providerModelCatalog";
  import { saveConnectionApiKey } from "../services/providerSecretsStore";
  import {
    DEFAULT_HTTP_CONNECTION_ID,
    defaultHttpConnection,
  } from "../ai/providers/httpConnectionSettings";
  import {
    getSettingsTabDefinition,
    SETTINGS_SIDEBAR,
    SETTINGS_TABS,
    type SettingsDialogTab,
  } from "../services/settingsDialogUi";
  import KeyboardShortcutsSettings from "./KeyboardShortcutsSettings.svelte";
  import { appState } from "../state/appState";
  import { chatStore } from "../state/chatStore";
  import { normalizeMaxBinaryOpenAsTextBytes } from "../services/binaryFileOpen";
  import { normalizeMaxOpenWithoutConfirmBytes } from "../services/largeFileOpen";

  const SETTINGS_TAB_SIDEBAR_WIDTH_PX = 132;
  const SETTINGS_BODY_PADDING_X_PX = 24;
  const SETTINGS_DIALOG_CHROME_BUFFER_PX = 8;

  let {
    open = false,
    initialTab = "editor",
    onClose = () => {},
  }: {
    open?: boolean;
    initialTab?: SettingsDialogTab;
    onClose?: () => void;
  } = $props();

  let activeTab = $state<SettingsDialogTab>("editor");
  let dialogEl: HTMLDivElement | null = $state(null);
  let headerEl: HTMLElement | null = $state(null);
  let tabMeasureEls = $state<Partial<Record<SettingsDialogTab, HTMLElement>>>({});
  let isResizing = $state(false);

  let initialWidthPx = $state(560);
  let initialHeightPx = $state(640);
  let dialogWidthPx = $state(560);
  let dialogHeightPx = $state(640);
  let sizeInitialized = $state(false);

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
    const parsedKb = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedKb)) {
      return;
    }
    updateExternalFilesSetting(
      "maxBinaryOpenAsTextBytes",
      normalizeMaxBinaryOpenAsTextBytes(parsedKb * 1024),
    );
  }

  function updateMaxOpenWithoutConfirmKb(rawValue: string): void {
    const parsedKb = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedKb)) {
      return;
    }
    updateExternalFilesSetting(
      "maxOpenWithoutConfirmBytes",
      normalizeMaxOpenWithoutConfirmBytes(parsedKb * 1024),
    );
  }

  type DebugSettingsScope = "debugChat" | "debugWorkspace";
  const NEW_CONNECTION_PREFIX = "conn";
  let selectedConnectionId = $state<string | null>(null);

  function updateScopedDebugProviderSetting(
    scope: DebugSettingsScope,
    key: keyof DebugProviderSettings,
    value: DebugProviderSettings[keyof DebugProviderSettings],
  ): void {
    if (scope === "debugChat") {
      appState.updateDebugChatProviderSettings({ [key]: value });
      return;
    }
    appState.updateDebugWorkspaceProviderSettings({ [key]: value });
  }

  function updateScopedDebugProviderNumberSetting(
    scope: DebugSettingsScope,
    key:
      | "delayMsMin"
      | "delayMsMax"
      | "chunkCharsMin"
      | "chunkCharsMax"
      | "failureProbability",
    rawValue: string,
  ): void {
    const parsed =
      key === "failureProbability" ? Number.parseFloat(rawValue) : Number.parseInt(rawValue, 10);
    updateScopedDebugProviderSetting(scope, key, Number.isFinite(parsed) ? parsed : 0);
  }

  function updateScopedDebugProviderSeed(scope: DebugSettingsScope, rawValue: string): void {
    const trimmed = rawValue.trim();
    updateScopedDebugProviderSetting(
      scope,
      "simulationSeed",
      trimmed.length === 0 ? null : Number.parseInt(trimmed, 10),
    );
  }

  function httpConnections(): HttpConnection[] {
    return snapshot.settings.providerSettings.httpConnections ?? [];
  }

  function activeHttpConnection(): HttpConnection {
    const connections = httpConnections();
    const selected = selectedConnectionId
      ? connections.find((connection) => connection.id === selectedConnectionId)
      : null;
    const fallback = connections[0] ?? { ...defaultHttpConnection, id: DEFAULT_HTTP_CONNECTION_ID };
    return selected ?? fallback;
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

  function updateProviderModelList(providerId: ChatProviderId, rawValue: string): void {
    const modelIds = parseModelListInput(rawValue);
    const currentCatalog = getProviderModelCatalog(
      snapshot.settings.providerModelCatalogs,
      providerId,
    );
    appState.updateProviderModelCatalog(providerId, {
      modelIds,
      defaultModelId: currentCatalog.defaultModelId,
    });
    if (providerId === "http") {
      void chatStore.runAccessPreflight();
    }
  }

  function updateProviderDefaultModel(providerId: ChatProviderId, defaultModelId: string): void {
    appState.updateProviderModelCatalog(providerId, { defaultModelId });
    if (providerId === "http") {
      void chatStore.runAccessPreflight();
    }
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

  function makeConnectionId(label: string): string {
    const slug = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const base = `${NEW_CONNECTION_PREFIX}-${slug || "http"}`;
    const ids = new Set(httpConnections().map((connection) => connection.id));
    if (!ids.has(base)) {
      return base;
    }
    let index = 2;
    while (ids.has(`${base}-${index}`)) {
      index += 1;
    }
    return `${base}-${index}`;
  }

  function addHttpConnection(): void {
    const id = makeConnectionId(`provider-${httpConnections().length + 1}`);
    const next: HttpConnection = {
      ...defaultHttpConnection,
      id,
      label: `Provider ${httpConnections().length + 1}`,
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

  function selectConnection(connectionId: string): void {
    selectedConnectionId = connectionId;
  }

  function setDefaultConnection(connectionId: string): void {
    appState.setDefaultConnectionId(connectionId);
    if (!selectedConnectionId) {
      selectedConnectionId = connectionId;
    }
  }

  function selectTab(nextTab: SettingsDialogTab): void {
    activeTab = nextTab;
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  function clampDialogSize(width: number, height: number): { width: number; height: number } {
    const maxWidth = Math.floor(window.innerWidth * 0.96);
    const maxHeight = Math.floor(window.innerHeight * 0.96);
    return {
      width: Math.max(initialWidthPx, Math.min(maxWidth, Math.floor(width))),
      height: Math.max(initialHeightPx, Math.min(maxHeight, Math.floor(height))),
    };
  }

  async function measureAndApplyInitialSize(): Promise<void> {
    await tick();
    const headerHeight = headerEl?.offsetHeight ?? 0;
    const tabHeights = SETTINGS_TABS.map((tab) => tabMeasureEls[tab.id]?.scrollHeight ?? 0);
    const tabWidths = SETTINGS_TABS.map((tab) => tabMeasureEls[tab.id]?.scrollWidth ?? 0);
    const bodyHeight = Math.max(...tabHeights, 0);
    const bodyWidth = Math.max(...tabWidths, 0);

    const measuredWidth =
      SETTINGS_TAB_SIDEBAR_WIDTH_PX +
      bodyWidth +
      SETTINGS_BODY_PADDING_X_PX +
      SETTINGS_DIALOG_CHROME_BUFFER_PX;
    const measuredHeight =
      headerHeight + bodyHeight + SETTINGS_DIALOG_CHROME_BUFFER_PX;

    const maxWidth = Math.floor(window.innerWidth * 0.96);
    const maxHeight = Math.floor(window.innerHeight * 0.96);
    const width = Math.min(maxWidth, measuredWidth);
    const height = Math.min(maxHeight, measuredHeight);

    initialWidthPx = width;
    initialHeightPx = height;
    dialogWidthPx = width;
    dialogHeightPx = height;
    sizeInitialized = true;
  }

  function handleResizeStart(event: PointerEvent): void {
    if (!sizeInitialized) {
      return;
    }
    event.preventDefault();
    isResizing = true;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = dialogWidthPx;
    const startHeight = dialogHeightPx;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const next = clampDialogSize(startWidth + deltaX, startHeight + deltaY);
      dialogWidthPx = next.width;
      dialogHeightPx = next.height;
    };

    const onPointerEnd = (): void => {
      isResizing = false;
      target?.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  }

  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      activeTab = initialTab;
      selectedConnectionId = snapshot.settings.providerSettings.defaultConnectionId ?? httpConnections()[0]?.id ?? null;
      if (!sizeInitialized) {
        void measureAndApplyInitialSize();
      }
    }
    wasOpen = open;
  });

  $effect(() => {
    const ids = new Set(httpConnections().map((connection) => connection.id));
    if (!selectedConnectionId || !ids.has(selectedConnectionId)) {
      selectedConnectionId =
        snapshot.settings.providerSettings.defaultConnectionId ??
        httpConnections()[0]?.id ??
        null;
    }
  });

  $effect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => dialogEl?.focus());

    const onWindowKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onWindowKeydown, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onWindowKeydown, true);
    };
  });
</script>

{#snippet providerModelCatalogPanel(providerId: ChatProviderId, heading: string)}
  {@const catalog = getProviderModelCatalog(snapshot.settings.providerModelCatalogs, providerId)}
  <div class="settings-subsection">
    <h4>{heading}</h4>
    <p class="settings-section-note">
      One model ID per line. Duplicate entries are removed when saved.
    </p>
    <label class="settings-field">
      <span>Model list</span>
      <textarea
        rows={Math.max(3, catalog.modelIds.length + 1)}
        spellcheck="false"
        value={formatModelListForInput(catalog.modelIds)}
        onchange={(event) =>
          updateProviderModelList(
            providerId,
            (event.currentTarget as HTMLTextAreaElement).value,
          )}
      ></textarea>
    </label>
    <label class="settings-field">
      <span>Default model</span>
      <select
        value={catalog.defaultModelId}
        onchange={(event) =>
          updateProviderDefaultModel(
            providerId,
            (event.currentTarget as HTMLSelectElement).value,
          )}
      >
        {#each catalog.modelIds as modelId (modelId)}
          <option value={modelId}>{modelId}</option>
        {/each}
      </select>
    </label>
  </div>
{/snippet}

{#snippet settingsPanel(tabId: SettingsDialogTab)}
  {#if tabId === "editor"}
    {@render editorSettingsPanel()}
  {:else if tabId === "shortcuts"}
    <KeyboardShortcutsSettings />
  {:else if tabId === "connections"}
    {@render connectionsSettingsPanel()}
  {:else if tabId === "debugAi"}
    {@render debugProviderSettingsPanel(
      "debugChat",
      "debug-chat",
      "Debug Provider",
      "Settings for the Chats Debug Provider. Enabled by default for development dogfooding; uncheck Enable to hide it from Chats.",
      "Show Debug Provider in Chats",
    )}
  {:else}
    {@render debugProviderSettingsPanel(
      "debugWorkspace",
      "debug-workspace",
      "Debug Provider",
      "Settings for the workspace Debug Provider. Enabled by default for development dogfooding; uncheck Enable to hide it from workspace chat.",
      "Show Debug Provider in workspace chat",
    )}
  {/if}
{/snippet}

{#snippet editorSettingsPanel()}
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
{/snippet}

{#snippet connectionsSettingsPanel()}
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
            <button
              type="button"
              class="connection-row"
              class:connection-row-active={connection.id === activeHttpConnection().id}
              onclick={() => selectConnection(connection.id)}
            >
              <span>{connection.label}</span>
              {#if snapshot.settings.providerSettings.defaultConnectionId === connection.id}
                <small>Default</small>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    {#if httpConnections().length > 0}
      {@const activeConnection = activeHttpConnection()}
      <div class="settings-subsection">
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
              updateHttpConnectionSetting(
                "baseUrl",
                (event.currentTarget as HTMLInputElement).value,
              )}
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
        <button
          type="button"
          class="settings-action settings-action-danger"
          disabled={httpConnections().length <= 1}
          onclick={() => void removeHttpConnection(activeConnection.id)}
        >
          Remove connection
        </button>
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
{/snippet}

{#snippet debugProviderSettingsPanel(
  settingsScope: DebugSettingsScope,
  catalogProviderId: ChatProviderId,
  title: string,
  note: string,
  enableLabel: string,
)}
  {@const debugSettings = snapshot.settings.providerSettings[settingsScope]}
  <section class="settings-section">
    <h3>{title}</h3>
    <p class="settings-section-note">{note}</p>
    <div class="settings-subsection">
      <h4>Enable</h4>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={debugSettings.enabled}
          onchange={(event) =>
            updateScopedDebugProviderSetting(
              settingsScope,
              "enabled",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        {enableLabel}
      </label>
    </div>
    <div class="settings-subsection">
      <h4>Simulation</h4>
      <label class="settings-field">
        <span>Simulation seed</span>
        <input
          type="text"
          inputmode="numeric"
          placeholder="Random"
          value={debugSettings.simulationSeed ?? ""}
          oninput={(event) =>
            updateScopedDebugProviderSeed(
              settingsScope,
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="settings-field">
        <span>Delay min (ms)</span>
        <input
          type="number"
          min="0"
          value={debugSettings.delayMsMin}
          onchange={(event) =>
            updateScopedDebugProviderNumberSetting(
              settingsScope,
              "delayMsMin",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="settings-field">
        <span>Delay max (ms)</span>
        <input
          type="number"
          min="0"
          value={debugSettings.delayMsMax}
          onchange={(event) =>
            updateScopedDebugProviderNumberSetting(
              settingsScope,
              "delayMsMax",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="settings-field">
        <span>Chunk min (chars)</span>
        <input
          type="number"
          min="1"
          value={debugSettings.chunkCharsMin}
          onchange={(event) =>
            updateScopedDebugProviderNumberSetting(
              settingsScope,
              "chunkCharsMin",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="settings-field">
        <span>Chunk max (chars)</span>
        <input
          type="number"
          min="1"
          value={debugSettings.chunkCharsMax}
          onchange={(event) =>
            updateScopedDebugProviderNumberSetting(
              settingsScope,
              "chunkCharsMax",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="settings-field">
        <span>Failure probability</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={debugSettings.failureProbability}
          onchange={(event) =>
            updateScopedDebugProviderNumberSetting(
              settingsScope,
              "failureProbability",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="settings-field">
        <span>Failure message</span>
        <input
          type="text"
          value={debugSettings.failureMessage}
          onchange={(event) =>
            updateScopedDebugProviderSetting(
              settingsScope,
              "failureMessage",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
    </div>
    <div class="settings-subsection">
      <h4>Output</h4>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={debugSettings.includeDiagnostics}
          onchange={(event) =>
            updateScopedDebugProviderSetting(
              settingsScope,
              "includeDiagnostics",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Include diagnostics appendix in replies
      </label>
    </div>
    {@render providerModelCatalogPanel(catalogProviderId, "Models")}
  </section>
{/snippet}

{#if open}
  <div
    class="settings-dialog-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}
  >
    {#if !sizeInitialized}
      <div class="settings-dialog-measure" aria-hidden="true">
        <div bind:this={headerEl} class="settings-dialog-header settings-dialog-header-measure">
          <h2 class="settings-dialog-title">Settings</h2>
        </div>
        {#each SETTINGS_TABS as tab (tab.id)}
          <div
            class="settings-dialog-body settings-dialog-body-measure"
            bind:this={tabMeasureEls[tab.id]}
          >
            {@render settingsPanel(tab.id)}
          </div>
        {/each}
      </div>
    {/if}

    <div
      bind:this={dialogEl}
      class="settings-dialog"
      class:settings-dialog-resizing={isResizing}
      class:settings-dialog-sizing={!sizeInitialized}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      tabindex="-1"
      style={`width:${dialogWidthPx}px; height:${dialogHeightPx}px; min-width:${initialWidthPx}px; min-height:${initialHeightPx}px;`}
      onkeydown={handleDialogKeydown}
      onclick={(event) => event.stopPropagation()}
    >
      <header class="settings-dialog-header">
        <h2 id="settings-dialog-title" class="settings-dialog-title">Settings</h2>
        <button type="button" class="settings-dialog-close" aria-label="Close settings" onclick={onClose}>
          ×
        </button>
      </header>

      <div class="settings-dialog-main">
        <div
          class="settings-dialog-sidebar"
          style={`width: ${SETTINGS_TAB_SIDEBAR_WIDTH_PX}px;`}
          role="tablist"
          aria-label="Settings sections"
        >
          {#each SETTINGS_SIDEBAR as entry (entry.kind === "tab" ? entry.tab.id : entry.label)}
            {#if entry.kind === "tab"}
              <button
                type="button"
                role="tab"
                class="settings-dialog-tab"
                class:settings-dialog-tab-active={activeTab === entry.tab.id}
                aria-selected={activeTab === entry.tab.id}
                onclick={() => selectTab(entry.tab.id)}
              >
                {entry.tab.label}
              </button>
            {:else}
              <p class="settings-dialog-section-label">{entry.label}</p>
              {#each entry.tabs as tab (tab.id)}
                <button
                  type="button"
                  role="tab"
                  class="settings-dialog-tab"
                  class:settings-dialog-tab-active={activeTab === tab.id}
                  aria-selected={activeTab === tab.id}
                  onclick={() => selectTab(tab.id)}
                >
                  {tab.label}
                </button>
              {/each}
            {/if}
          {/each}
        </div>

        <div
          class="settings-dialog-body"
          role="tabpanel"
          aria-label={getSettingsTabDefinition(activeTab).panelAriaLabel}
        >
          {@render settingsPanel(activeTab)}
        </div>
      </div>

      <div
        class="settings-dialog-resize-handle"
        role="separator"
        aria-label="Resize settings dialog"
        onpointerdown={handleResizeStart}
      ></div>
    </div>
  </div>
{/if}

<style>
  @import "../styles/settingsForm.css";
  @import "../styles/settingsFormMultiline.css";
  @import "../styles/settingsDialogForm.css";

  .settings-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-12);
    background: color-mix(in srgb, var(--color-bg-root) 55%, transparent);
    backdrop-filter: blur(4px);
  }

  .settings-dialog-measure {
    position: fixed;
    left: -10000px;
    top: 0;
    visibility: hidden;
    pointer-events: none;
    width: max-content;
    max-width: 520px;
  }

  .settings-dialog-header-measure {
    width: 520px;
    box-sizing: border-box;
  }

  .settings-dialog-body-measure {
    width: 404px;
    box-sizing: border-box;
    overflow: visible;
    padding: var(--space-8) var(--space-12) var(--space-12);
  }

  .settings-dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-width: 96vw;
    max-height: 96vh;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    color: var(--color-text-primary);
    box-sizing: border-box;
  }

  .settings-dialog-sizing {
    visibility: hidden;
    pointer-events: none;
  }

  .settings-dialog-resizing {
    user-select: none;
  }

  .settings-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-12) var(--space-12) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .settings-dialog-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .settings-dialog-close {
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .settings-dialog-close:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .settings-dialog-close:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .settings-dialog-main {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .settings-dialog-sidebar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-6);
    border-right: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-text-secondary) 4%, var(--color-surface-1));
  }

  .settings-dialog-tab {
    width: 100%;
    min-height: 32px;
    padding: 0 var(--space-6) 0 var(--space-12);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 12px;
    font-weight: var(--font-weight-normal);
    line-height: 1.3;
    text-align: left;
    cursor: pointer;
  }

  .settings-dialog-tab:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .settings-dialog-tab:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .settings-dialog-tab-active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-text-primary);
  }

  .settings-dialog-section-label {
    margin: var(--space-8) 0 var(--space-2);
    padding: 0 var(--space-6) 0 var(--space-2);
    font-size: var(--font-size-body);
    font-weight: 700;
    color: var(--color-text-primary);
    line-height: 1.3;
    user-select: none;
  }

  .settings-dialog-section-label:first-child {
    margin-top: 0;
  }

  .settings-dialog-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: var(--space-8) var(--space-12) var(--space-12);
  }

  .settings-dialog-resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: se-resize;
    touch-action: none;
  }

  .settings-dialog-resize-handle::after {
    content: "";
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--color-text-secondary);
    border-bottom: 2px solid var(--color-text-secondary);
    opacity: 0.65;
  }

  .connection-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .connection-row {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: var(--space-4) var(--space-6);
    cursor: pointer;
    text-align: left;
  }

  .connection-row-active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-1));
  }

  .settings-action {
    align-self: flex-start;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    padding: var(--space-3) var(--space-6);
    cursor: pointer;
  }

  .settings-action-danger {
    color: var(--color-text-danger);
  }
</style>
