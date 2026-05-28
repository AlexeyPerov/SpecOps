<script lang="ts">
  import { tick } from "svelte";
  import type { DebugProviderSettings, ExternalFilesSettings } from "../domain/contracts";
  import { appState } from "../state/appState";

  export type SettingsDialogTab = "editor" | "debugAi";

  const SETTINGS_TAB_SIDEBAR_WIDTH_PX = 132;
  const SETTINGS_BODY_PADDING_X_PX = 24;
  const SETTINGS_DIALOG_CHROME_BUFFER_PX = 8;

  let {
    open = false,
    onClose = () => {},
  }: {
    open?: boolean;
    onClose?: () => void;
  } = $props();

  let activeTab = $state<SettingsDialogTab>("editor");
  let dialogEl: HTMLDivElement | null = $state(null);
  let headerEl: HTMLElement | null = $state(null);
  let editorMeasureEl: HTMLElement | null = $state(null);
  let debugMeasureEl: HTMLElement | null = $state(null);
  let isResizing = $state(false);

  let initialWidthPx = $state(560);
  let initialHeightPx = $state(640);
  let dialogWidthPx = $state(560);
  let dialogHeightPx = $state(640);
  let sizeInitialized = $state(false);

  const snapshot = $derived($appState);

  function updateExternalFilesSetting(
    key: keyof ExternalFilesSettings,
    value: boolean,
  ): void {
    const current = appState.getSnapshot().settings.externalFiles;
    appState.setExternalFilesSettings({
      ...current,
      [key]: value,
    });
  }

  function updateDebugProviderSetting(
    key: keyof DebugProviderSettings,
    value: DebugProviderSettings[keyof DebugProviderSettings],
  ): void {
    appState.updateDebugProviderSettings({ [key]: value });
  }

  function updateDebugProviderNumberSetting(
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
    updateDebugProviderSetting(key, Number.isFinite(parsed) ? parsed : 0);
  }

  function updateDebugProviderSeed(rawValue: string): void {
    const trimmed = rawValue.trim();
    updateDebugProviderSetting(
      "simulationSeed",
      trimmed.length === 0 ? null : Number.parseInt(trimmed, 10),
    );
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
    const editorHeight = editorMeasureEl?.scrollHeight ?? 0;
    const debugHeight = debugMeasureEl?.scrollHeight ?? 0;
    const editorWidth = editorMeasureEl?.scrollWidth ?? 0;
    const debugWidth = debugMeasureEl?.scrollWidth ?? 0;

    const bodyHeight = Math.max(editorHeight, debugHeight);
    const bodyWidth = Math.max(editorWidth, debugWidth);

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
      activeTab = "editor";
      if (!sizeInitialized) {
        void measureAndApplyInitialSize();
      }
    }
    wasOpen = open;
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

{#snippet editorSettingsPanel()}
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
  </section>
{/snippet}

{#snippet debugAiSettingsPanel()}
  <section class="settings-section">
    <h3>Debug AI provider</h3>
    <p class="settings-section-note">
      Settings for the Debug chat provider only. Enabled by default for development dogfooding;
      uncheck Enable to hide it from chat.
    </p>
    <div class="settings-subsection">
      <h4>Enable</h4>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={snapshot.settings.debugProvider.enabled}
          onchange={(event) =>
            updateDebugProviderSetting(
              "enabled",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Show Debug provider in chat
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
          value={snapshot.settings.debugProvider.simulationSeed ?? ""}
          oninput={(event) =>
            updateDebugProviderSeed((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="settings-field">
        <span>Delay min (ms)</span>
        <input
          type="number"
          min="0"
          value={snapshot.settings.debugProvider.delayMsMin}
          onchange={(event) =>
            updateDebugProviderNumberSetting(
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
          value={snapshot.settings.debugProvider.delayMsMax}
          onchange={(event) =>
            updateDebugProviderNumberSetting(
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
          value={snapshot.settings.debugProvider.chunkCharsMin}
          onchange={(event) =>
            updateDebugProviderNumberSetting(
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
          value={snapshot.settings.debugProvider.chunkCharsMax}
          onchange={(event) =>
            updateDebugProviderNumberSetting(
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
          value={snapshot.settings.debugProvider.failureProbability}
          onchange={(event) =>
            updateDebugProviderNumberSetting(
              "failureProbability",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="settings-field">
        <span>Failure message</span>
        <input
          type="text"
          value={snapshot.settings.debugProvider.failureMessage}
          onchange={(event) =>
            updateDebugProviderSetting(
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
          checked={snapshot.settings.debugProvider.includeDiagnostics}
          onchange={(event) =>
            updateDebugProviderSetting(
              "includeDiagnostics",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Include diagnostics appendix in replies
      </label>
    </div>
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
        <div
          class="settings-dialog-body settings-dialog-body-measure"
          bind:this={editorMeasureEl}
        >
          {@render editorSettingsPanel()}
        </div>
        <div class="settings-dialog-body settings-dialog-body-measure" bind:this={debugMeasureEl}>
          {@render debugAiSettingsPanel()}
        </div>
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
          <button
            type="button"
            role="tab"
            class="settings-dialog-tab"
            class:settings-dialog-tab-active={activeTab === "editor"}
            aria-selected={activeTab === "editor"}
            onclick={() => selectTab("editor")}
          >
            Editor
          </button>
          <button
            type="button"
            role="tab"
            class="settings-dialog-tab"
            class:settings-dialog-tab-active={activeTab === "debugAi"}
            aria-selected={activeTab === "debugAi"}
            onclick={() => selectTab("debugAi")}
          >
            Debug AI
          </button>
        </div>

        <div
          class="settings-dialog-body"
          role="tabpanel"
          aria-label={activeTab === "editor" ? "Editor settings" : "Debug AI provider settings"}
        >
          {#if activeTab === "editor"}
            {@render editorSettingsPanel()}
          {:else}
            {@render debugAiSettingsPanel()}
          {/if}
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
    padding: 0 var(--space-6);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 12px;
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
</style>
