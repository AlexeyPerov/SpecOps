<script lang="ts">
  import { appState } from "../../state/appState";
  import {
    buildSettingsSidebar,
    getSettingsTabDefinition,
    resolveOpenSettingsDialogTab,
    SETTINGS_TABS,
    type SettingsDialogTab,
  } from "../../services/settingsDialogUi";
  import KeyboardShortcutsSettings from "../KeyboardShortcutsSettings.svelte";
  import ChatModesSettingsPanel from "./ChatModesSettingsPanel.svelte";
  import ConnectionsSettingsPanel from "./ConnectionsSettingsPanel.svelte";
  import DebugProviderSettingsPanel from "./DebugProviderSettingsPanel.svelte";
  import DevSettingsPanel from "./DevSettingsPanel.svelte";
  import OpenCodeSettingsPanel from "./OpenCodeSettingsPanel.svelte";
  import OpenCodeConfigPanel from "./OpenCodeConfigPanel.svelte";
  import ProviderManagementPanel from "./ProviderManagementPanel.svelte";
  import McpManagementPanel from "./McpManagementPanel.svelte";
  import AgentManagementPanel from "./AgentManagementPanel.svelte";
  import PermissionRulesPanel from "./PermissionRulesPanel.svelte";
  import CommandManagementPanel from "./CommandManagementPanel.svelte";
  import InstructionsPanel from "./InstructionsPanel.svelte";
  import EditorSettingsPanel from "./EditorSettingsPanel.svelte";
  import AppearancePanel from "./AppearancePanel.svelte";
  import LogsSettingsPanel from "./LogsSettingsPanel.svelte";
  import VersionControlSettingsPanel from "./VersionControlSettingsPanel.svelte";

  /**
   * Width of the settings section sidebar. Carried over from the legacy
   * settings dialog chrome; the dialog-level geometry subsystem has been
   * removed now that Settings renders as a chrome-less editor-pane tab.
   */
  const SETTINGS_TAB_SIDEBAR_WIDTH_PX = 132;

  let { subTab }: { subTab?: string } = $props();

  const settingsSidebar = $derived(
    buildSettingsSidebar($appState.settings.chatHttp),
  );
  const visibleTabIds = $derived(
    new Set(
      settingsSidebar.flatMap((entry) =>
        entry.kind === "tab" ? [entry.tab.id] : entry.tabs.map((tab) => tab.id),
      ),
    ),
  );

  let activeTab = $state<SettingsDialogTab>("editor");

  // Honour a deep-link target carried by the view tab (e.g. openSettingsDialog("connections")).
  $effect(() => {
    if (subTab) {
      const resolved = resolveOpenSettingsDialogTab(
        subTab as SettingsDialogTab,
        $appState.settings.chatHttp,
      );
      activeTab = resolved;
    }
  });

  // Reset to a valid tab when the active one is hidden by the chat-http gate.
  $effect(() => {
    if (!visibleTabIds.has(activeTab)) {
      activeTab = "dev";
    }
  });

  function selectTab(nextTab: SettingsDialogTab): void {
    activeTab = nextTab;
  }
</script>

{#snippet settingsPanel(tabId: SettingsDialogTab)}
  {#if tabId === "editor"}
    <EditorSettingsPanel />
  {:else if tabId === "shortcuts"}
    <KeyboardShortcutsSettings />
  {:else if tabId === "appearance"}
    <AppearancePanel />
  {:else if tabId === "versionControl"}
    <VersionControlSettingsPanel />
  {:else if tabId === "dev"}
    <DevSettingsPanel dialogOpen={true} />
  {:else if tabId === "connections"}
    <ConnectionsSettingsPanel dialogOpen={true} />
  {:else if tabId === "chatModes"}
    <ChatModesSettingsPanel />
  {:else if tabId === "debugAi"}
    <DebugProviderSettingsPanel
      settingsScope="debugChat"
      catalogProviderId="debug-chat"
      title="Debug Provider"
      note="Settings for the Chats Debug Provider. Enabled by default for development dogfooding; uncheck Enable to hide it from Chats."
      enableLabel="Show Debug Provider in Chats"
    />
  {:else if tabId === "opencode"}
    <OpenCodeSettingsPanel dialogOpen={true} />
  {:else if tabId === "openCodeConfig"}
    <OpenCodeConfigPanel dialogOpen={true} />
  {:else if tabId === "providers"}
    <ProviderManagementPanel dialogOpen={true} />
  {:else if tabId === "mcp"}
    <McpManagementPanel dialogOpen={true} />
  {:else if tabId === "agents"}
    <AgentManagementPanel dialogOpen={true} />
  {:else if tabId === "permissions"}
    <PermissionRulesPanel dialogOpen={true} />
  {:else if tabId === "commands"}
    <CommandManagementPanel dialogOpen={true} />
  {:else if tabId === "instructions"}
    <InstructionsPanel dialogOpen={true} />
  {:else if tabId === "logs"}
    <LogsSettingsPanel />
  {:else if tabId === "debugAgent"}
    <DebugProviderSettingsPanel
      settingsScope="debugWorkspace"
      catalogProviderId="debug-workspace"
      title="Debug Provider"
      note="Settings for the workspace Debug Provider. Enabled by default for development dogfooding; uncheck Enable to hide it from workspace chat."
      enableLabel="Show Debug Provider in workspace chat"
    />
  {/if}
{/snippet}

<div class="settings-view" role="tabpanel" aria-label="Settings">
  <div
    class="settings-view-sidebar"
    style={`width: ${SETTINGS_TAB_SIDEBAR_WIDTH_PX}px;`}
    role="tablist"
    aria-label="Settings sections"
  >
    {#each settingsSidebar as entry (entry.kind === "tab" ? entry.tab.id : entry.label)}
      {#if entry.kind === "tab"}
        <button
          type="button"
          role="tab"
          class="settings-view-tab"
          class:settings-view-tab-active={activeTab === entry.tab.id}
          aria-selected={activeTab === entry.tab.id}
          onclick={() => selectTab(entry.tab.id)}
        >
          {entry.tab.label}
        </button>
      {:else}
        <p class="settings-view-section-label">{entry.label}</p>
        {#each entry.tabs as tab (tab.id)}
          <button
            type="button"
            role="tab"
            class="settings-view-tab"
            class:settings-view-tab-active={activeTab === tab.id}
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
    class="settings-view-body"
    role="tabpanel"
    aria-label={getSettingsTabDefinition(activeTab).panelAriaLabel}
  >
    {@render settingsPanel(activeTab)}
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .settings-view-sidebar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4) var(--space-12);
    border-right: 1px solid var(--color-border-subtle);
    overflow-y: auto;
  }

  .settings-view-section-label {
    margin: var(--space-4) 0 var(--space-1);
    padding: 0 var(--space-4);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .settings-view-tab {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .settings-view-tab:hover {
    background: var(--color-surface-2);
  }

  .settings-view-tab-active {
    background: var(--color-surface-2);
    font-weight: 600;
  }

  .settings-view-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-10) var(--space-12) var(--space-12);
  }
</style>
