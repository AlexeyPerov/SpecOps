<script lang="ts">
  import { onDestroy } from "svelte";
  import ConsoleLogsPanel from "./ConsoleLogsPanel.svelte";
  import {
    DEFAULT_CONSOLE_HEIGHT_PX,
    MIN_CONSOLE_HEIGHT_PX,
    normalizeConsoleHeightPx,
  } from "../services/consoleTabPrefs";
  import { startPointerDrag } from "./pointerDrag";
  import {
    clearConsoleLogs,
    consoleLogs,
    consoleLevelRank,
    getMinConsoleLevel,
    setMinConsoleLevel,
    type ConsoleLogEntry,
  } from "../services/appConsole";
  import type { DiagnosticLevel } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { downloadPerfReport } from "../services/perfReportDownload";

  let {
    heightPx = $bindable(DEFAULT_CONSOLE_HEIGHT_PX),
    onHeightCommit,
  }: {
    heightPx?: number;
    onHeightCommit?: () => void;
  } = $props();

  let isResizing = $state(false);
  let activeResizeTeardown: (() => void) | null = null;
  let minLevel = $state<DiagnosticLevel>(getMinConsoleLevel());
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let perfDownloading = $state(false);
  let perfError = $state<string | null>(null);

  // P03-08-T2: the perf download action is only meaningful while collection is
  // armed; track the setting reactively so the toolbar button reflects state.
  const collectPerfLogs = $derived($appState.settings.logSettings.collectPerfLogs);

  function clampHeight(next: number): number {
    return normalizeConsoleHeightPx(next);
  }

  function handleResizeStart(event: PointerEvent): void {
    event.preventDefault();
    activeResizeTeardown?.();
    isResizing = true;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = heightPx;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const teardown = startPointerDrag({
      pointerId,
      target,
      onMove: (moveEvent) => {
        const deltaY = startY - moveEvent.clientY;
        heightPx = clampHeight(startHeight + deltaY);
      },
      onEnd: () => {
        isResizing = false;
        activeResizeTeardown = null;
        onHeightCommit?.();
      },
    });

    activeResizeTeardown = () => {
      isResizing = false;
      teardown();
    };
  }

  onDestroy(() => {
    activeResizeTeardown?.();
    activeResizeTeardown = null;
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
  });

  function handleResizeDoubleClick(): void {
    heightPx = DEFAULT_CONSOLE_HEIGHT_PX;
    onHeightCommit?.();
  }

  function handleClear(): void {
    clearConsoleLogs();
  }

  function handleLevelChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value as DiagnosticLevel;
    minLevel = value;
    setMinConsoleLevel(value);
  }

  async function handleCopyVisible(): Promise<void> {
    // Read the current ring snapshot (already oldest→newest), then apply the
    // same display-level filter as the panel so Copy matches what is on screen.
    let entries: ConsoleLogEntry[] = [];
    const unsubscribe = consoleLogs.subscribe((value) => {
      entries = value;
    });
    unsubscribe();
    const minRank = consoleLevelRank(minLevel);
    const visible = entries.filter((entry) => consoleLevelRank(entry.level) >= minRank);
    if (visible.length === 0) {
      return;
    }
    const text = visible.map((entry) => entry.text).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (copyTimer) {
        clearTimeout(copyTimer);
      }
      copyTimer = setTimeout(() => {
        copied = false;
        copyTimer = null;
      }, 1500);
    } catch {
      // Clipboard may be unavailable (permissions, non-secure context). Silent.
    }
  }

  async function handleDownloadPerfReport(): Promise<void> {
    if (perfDownloading) {
      return;
    }
    perfDownloading = true;
    perfError = null;
    try {
      const settings = $appState.settings;
      // Embed the perf-relevant settings slice so the report is interpretable.
      const snapshot = {
        gitIntegration: settings.gitIntegration,
        externalFiles: {
          watchExternalChanges: settings.externalFiles.watchExternalChanges,
        },
        collectPerfLogs: settings.logSettings.collectPerfLogs,
      };
      await downloadPerfReport({ settings: snapshot });
    } catch (error: unknown) {
      perfError = error instanceof Error ? error.message : String(error);
    } finally {
      perfDownloading = false;
    }
  }
</script>

<section
  class="console-panel"
  class:console-panel-resizing={isResizing}
  aria-hidden="false"
  style={`--console-height: ${heightPx}px;`}
>
  <div
    class="console-resize-handle"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize console panel"
    aria-valuemin={MIN_CONSOLE_HEIGHT_PX}
    aria-valuenow={heightPx}
    onpointerdown={handleResizeStart}
    ondblclick={handleResizeDoubleClick}
  ></div>

  <div class="console-toolbar" role="toolbar" aria-label="Console actions">
    <label class="console-toolbar-level">
      <span class="console-toolbar-label">Level</span>
      <select value={minLevel} onchange={handleLevelChange} aria-label="Minimum log level">
        <option value="debug">Debug</option>
        <option value="info">Info</option>
        <option value="warn">Warn</option>
        <option value="error">Error</option>
      </select>
    </label>
    <button
      type="button"
      class="console-toolbar-btn"
      title="Clear console"
      aria-label="Clear console"
      onclick={handleClear}
    >
      Clear
    </button>
    <button
      type="button"
      class="console-toolbar-btn"
      title="Copy visible log lines"
      aria-label="Copy visible log lines"
      onclick={handleCopyVisible}
    >
      {copied ? "Copied" : "Copy"}
    </button>
    <button
      type="button"
      class="console-toolbar-btn"
      title={collectPerfLogs ? "Download performance report" : "Enable performance log collection in Settings first"}
      aria-label="Download performance report"
      disabled={!collectPerfLogs || perfDownloading}
      onclick={handleDownloadPerfReport}
    >
      {perfDownloading ? "…" : "Perf report"}
    </button>
    {#if perfError}
      <span class="console-toolbar-error" role="status">{perfError}</span>
    {/if}
  </div>

  <div class="console-content">
    <ConsoleLogsPanel minLevel={minLevel} />
  </div>
</section>

<style>
  .console-panel {
    position: relative;
    min-height: 0;
    height: var(--console-height);
    overflow: hidden;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    display: flex;
    flex-direction: column;
  }

  .console-panel-resizing {
    user-select: none;
  }

  .console-resize-handle {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: row-resize;
    touch-action: none;
    z-index: 2;
  }

  .console-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--editor-content-padding-x, var(--space-8));
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .console-toolbar-level {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .console-toolbar-label {
    white-space: nowrap;
  }

  .console-toolbar select {
    height: var(--space-10);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-status);
    padding: 0 var(--space-2);
    outline: none;
  }

  .console-toolbar select:focus {
    border-color: var(--color-accent);
  }

  .console-toolbar-btn {
    height: var(--space-10);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-status);
    padding: 0 var(--space-3);
    cursor: pointer;
  }

  .console-toolbar-btn:hover:not(:disabled) {
    background: var(--color-hover);
  }

  .console-toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .console-toolbar-error {
    font-size: var(--font-size-status);
    color: var(--color-danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .console-content {
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }
</style>
