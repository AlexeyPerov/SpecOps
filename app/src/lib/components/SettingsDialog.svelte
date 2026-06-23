<script lang="ts">
  import "../styles/settingsDialogChrome.css";
  import { appState } from "../state/appState";
  import {
    buildSettingsSidebar,
    getSettingsTabDefinition,
    resolveOpenSettingsDialogTab,
    SETTINGS_TABS,
    type SettingsDialogTab,
  } from "../services/settingsDialogUi";
  import { SETTINGS_DIALOG_VIEWPORT_MARGIN_PX } from "../services/settingsDialogGeometry";
  import KeyboardShortcutsSettings from "./KeyboardShortcutsSettings.svelte";
  import ChatModesSettingsPanel from "./settings/ChatModesSettingsPanel.svelte";
  import ConnectionsSettingsPanel from "./settings/ConnectionsSettingsPanel.svelte";
  import DebugProviderSettingsPanel from "./settings/DebugProviderSettingsPanel.svelte";
  import DevSettingsPanel from "./settings/DevSettingsPanel.svelte";
  import OpenCodeSettingsPanel from "./settings/OpenCodeSettingsPanel.svelte";
  import OpenCodeConfigPanel from "./settings/OpenCodeConfigPanel.svelte";
  import ProviderManagementPanel from "./settings/ProviderManagementPanel.svelte";
  import McpManagementPanel from "./settings/McpManagementPanel.svelte";
  import AgentManagementPanel from "./settings/AgentManagementPanel.svelte";
  import PermissionRulesPanel from "./settings/PermissionRulesPanel.svelte";
  import CommandManagementPanel from "./settings/CommandManagementPanel.svelte";
  import InstructionsPanel from "./settings/InstructionsPanel.svelte";
  import EditorSettingsPanel from "./settings/EditorSettingsPanel.svelte";
  import AppearancePanel from "./settings/AppearancePanel.svelte";
  import LogsSettingsPanel from "./settings/LogsSettingsPanel.svelte";
  import SettingsDialogMeasure from "./settings/SettingsDialogMeasure.svelte";
  import {
    handleSettingsDialogDragStart,
    handleSettingsDialogResizeStart,
    measureSettingsDialogInitialSize,
    SETTINGS_DIALOG_DEFAULT_HEIGHT_PX,
    SETTINGS_DIALOG_DEFAULT_WIDTH_PX,
    SETTINGS_TAB_SIDEBAR_WIDTH_PX,
    syncDialogBoundsToViewport,
  } from "./settings/settingsDialogChrome";

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
  let dialogEl: HTMLDivElement | null = $state(null);
  let headerEl: HTMLElement | null = $state(null);
  let tabMeasureEls = $state<Partial<Record<SettingsDialogTab, HTMLElement>>>({});
  let isResizing = $state(false);
  let isDragging = $state(false);

  let initialWidthPx = $state(SETTINGS_DIALOG_DEFAULT_WIDTH_PX);
  let initialHeightPx = $state(SETTINGS_DIALOG_DEFAULT_HEIGHT_PX);
  let dialogWidthPx = $state(SETTINGS_DIALOG_DEFAULT_WIDTH_PX);
  let dialogHeightPx = $state(SETTINGS_DIALOG_DEFAULT_HEIGHT_PX);
  let dialogLeftPx = $state(SETTINGS_DIALOG_VIEWPORT_MARGIN_PX);
  let dialogTopPx = $state(SETTINGS_DIALOG_VIEWPORT_MARGIN_PX);
  let sizeInitialized = $state(false);
  let positionInitialized = $state(false);

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

  function applySyncedBounds(): void {
    const synced = syncDialogBoundsToViewport(
      { dialogWidthPx, dialogHeightPx, dialogLeftPx, dialogTopPx },
      initialWidthPx,
      initialHeightPx,
    );
    dialogWidthPx = synced.dialogWidthPx;
    dialogHeightPx = synced.dialogHeightPx;
    dialogLeftPx = synced.dialogLeftPx;
    dialogTopPx = synced.dialogTopPx;
  }

  async function measureAndApplyInitialSize(): Promise<void> {
    const measured = await measureSettingsDialogInitialSize({
      headerEl,
      tabMeasureEls,
      tabIds: SETTINGS_TABS.map((tab) => tab.id),
      positionInitialized,
      dialogLeftPx,
      dialogTopPx,
      dialogWidthPx,
      dialogHeightPx,
    });
    initialWidthPx = measured.initialWidthPx;
    initialHeightPx = measured.initialHeightPx;
    dialogWidthPx = measured.dialogWidthPx;
    dialogHeightPx = measured.dialogHeightPx;
    dialogLeftPx = measured.dialogLeftPx;
    dialogTopPx = measured.dialogTopPx;
    positionInitialized = measured.positionInitialized;
    sizeInitialized = true;
  }

  function handleDragStart(event: PointerEvent): void {
    handleSettingsDialogDragStart(event, {
      sizeInitialized,
      isResizing,
      dialogLeftPx,
      dialogTopPx,
      dialogWidthPx,
      dialogHeightPx,
      onDraggingChange: (dragging) => {
        isDragging = dragging;
      },
      onPositionChange: (left, top) => {
        dialogLeftPx = left;
        dialogTopPx = top;
      },
    });
  }

  function handleResizeStart(event: PointerEvent): void {
    handleSettingsDialogResizeStart(event, {
      sizeInitialized,
      initialWidthPx,
      initialHeightPx,
      dialogWidthPx,
      dialogHeightPx,
      onResizingChange: (resizing) => {
        isResizing = resizing;
      },
      onSizeChange: (width, height) => {
        dialogWidthPx = width;
        dialogHeightPx = height;
      },
    });
  }

  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      activeTab = resolveOpenSettingsDialogTab(initialTab, $appState.settings.chatHttp);
      if (!sizeInitialized) {
        void measureAndApplyInitialSize();
      } else if (positionInitialized) {
        applySyncedBounds();
      }
    }
    wasOpen = open;
  });

  $effect(() => {
    if (!visibleTabIds.has(activeTab)) {
      activeTab = "dev";
    }
  });

  $effect(() => {
    if (!open) {
      return;
    }

    queueMicrotask(() => dialogEl?.focus());

    const onWindowKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onWindowResize = (): void => {
      applySyncedBounds();
    };

    window.addEventListener("keydown", onWindowKeydown, true);
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("keydown", onWindowKeydown, true);
      window.removeEventListener("resize", onWindowResize);
    };
  });
</script>

{#snippet settingsPanel(tabId: SettingsDialogTab)}
  {#if tabId === "editor"}
    <EditorSettingsPanel />
  {:else if tabId === "shortcuts"}
    <KeyboardShortcutsSettings />
  {:else if tabId === "appearance"}
    <AppearancePanel />
  {:else if tabId === "dev"}
    <DevSettingsPanel dialogOpen={open} />
  {:else if tabId === "connections"}
    <ConnectionsSettingsPanel dialogOpen={open} />
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
    <OpenCodeSettingsPanel dialogOpen={open} />
  {:else if tabId === "openCodeConfig"}
    <OpenCodeConfigPanel dialogOpen={open} />
  {:else if tabId === "providers"}
    <ProviderManagementPanel dialogOpen={open} />
  {:else if tabId === "mcp"}
    <McpManagementPanel dialogOpen={open} />
  {:else if tabId === "agents"}
    <AgentManagementPanel dialogOpen={open} />
  {:else if tabId === "permissions"}
    <PermissionRulesPanel dialogOpen={open} />
  {:else if tabId === "commands"}
    <CommandManagementPanel dialogOpen={open} />
  {:else if tabId === "instructions"}
    <InstructionsPanel dialogOpen={open} />
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

{#if open}
  <div class="settings-dialog-backdrop" role="presentation" aria-hidden="true"></div>

  {#if !sizeInitialized}
    <SettingsDialogMeasure bind:headerEl bind:tabMeasureEls {settingsPanel} />
  {/if}

  <div
    bind:this={dialogEl}
    class="settings-dialog"
    class:settings-dialog-resizing={isResizing}
    class:settings-dialog-dragging={isDragging}
    class:settings-dialog-sizing={!sizeInitialized}
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-dialog-title"
    tabindex="-1"
    style={`left:${dialogLeftPx}px; top:${dialogTopPx}px; width:${dialogWidthPx}px; height:${dialogHeightPx}px; min-width:${initialWidthPx}px; min-height:${initialHeightPx}px;`}
    onkeydown={handleDialogKeydown}
  >
    <header class="settings-dialog-header">
      <div
        class="settings-dialog-drag-region"
        role="button"
        tabindex="-1"
        aria-label="Drag to move settings window"
        onpointerdown={handleDragStart}
      >
        <h2 id="settings-dialog-title" class="settings-dialog-title">Settings</h2>
      </div>
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
        {#each settingsSidebar as entry (entry.kind === "tab" ? entry.tab.id : entry.label)}
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
{/if}
