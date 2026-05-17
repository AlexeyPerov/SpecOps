<script lang="ts">
  import { onMount } from "svelte";
  import EditorSurface from "../lib/components/EditorSurface.svelte";
  import {
    commandDefinitions,
    dispatchMenuCommand,
    keymapCommandForEvent,
  } from "../lib/commands/registry";
  import type { AppCommandId } from "../lib/domain/contracts";
  import type { EditorCommandRunner } from "../lib/types/editor";
  import { appState } from "../lib/state/appState";
  import { initializeLogging, logDiagnostic } from "../lib/services/logging";
  import { openPath } from "../lib/services/fileSystem";

  let settingsPaneOpen = false;
  let statusMessage = "Ready";
  let editorRunner: EditorCommandRunner | null = null;

  $: state = $appState;
  $: activeTab = state.session.openTabs.find(
    (tab) => tab.id === state.session.selectedTabId,
  );
  $: activeDocument =
    state.documents.find((documentState) => documentState.id === activeTab?.documentId) ??
    state.documents[0];

  function notify(message: string): void {
    statusMessage = message;
  }

  function runCommand(commandId: AppCommandId): void {
    dispatchMenuCommand(commandId, {
      isSettingsPaneOpen: () => settingsPaneOpen,
      setSettingsPaneOpen: (next) => {
        settingsPaneOpen = next;
      },
      notify,
      getState: () => state,
      confirm: (message) => window.confirm(message),
      getEditorRunner: () => editorRunner,
    });
  }

  async function setupRuntime(): Promise<void> {
    appState.initializeTheme();
    await initializeLogging();
    await logDiagnostic({
      level: "info",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "app shell initialized",
    });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (
      (event.target as HTMLElement | null)?.closest(
        "input, textarea, [contenteditable=true]",
      )
    ) {
      return;
    }
    const command = keymapCommandForEvent(event);
    if (!command) {
      return;
    }

    event.preventDefault();
    runCommand(command);
  }

  onMount(() => {
    void setupRuntime();

    const search = new URLSearchParams(window.location.search);
    const openParam = search.get("open");
    if (openParam) {
      void openPath(openParam)
        .then((opened) => {
          if (opened.sizeBytes > 10 * 1024 * 1024) {
            notify("Open failed: file exceeds 10MB MVP limit.");
            return;
          }
          appState.openFileInTab(opened.path, opened.content);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "unknown error";
          notify(`Failed to open file from path: ${message}`);
        });
    }

    function onKeydown(event: KeyboardEvent): void {
      handleKeydown(event);
    }

    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
    };
  });
</script>

<main class="shell">
  <header class="tab-header">
    <div class="header-left">
      {#each state.session.openTabs as tab, index}
        {@const tabDoc = state.documents.find((doc) => doc.id === tab.documentId)}
        {#if tabDoc}
        <button
          class={`tab ${tab.id === state.session.selectedTabId ? "tab-active" : ""}`}
          type="button"
          onclick={() => appState.selectTab(tab.id)}
        >
          {tabDoc.title}{tabDoc.isDirty ? "*" : ""}
        </button>
        <button class="tab-action" type="button" onclick={() => appState.moveTab(index, Math.max(0, index - 1))}>
          ←
        </button>
        <button
          class="tab-action"
          type="button"
          onclick={() => appState.moveTab(index, Math.min(state.session.openTabs.length - 1, index + 1))}
        >
          →
        </button>
        {/if}
      {/each}
    </div>
    <div class="header-right">
      <button class="toolbar-button" type="button" onclick={() => runCommand("file.open")}>
        Open
      </button>
      <button class="toolbar-button" type="button" onclick={() => runCommand("file.save")}>
        Save
      </button>
      <button class="toolbar-button" type="button" onclick={() => runCommand("file.saveAs")}>
        Save As
      </button>
      <button class="toolbar-button" type="button" onclick={() => runCommand("file.saveAll")}>
        Save All
      </button>
      <button class="toolbar-button" type="button" onclick={() => runCommand("file.rename")}>
        Rename
      </button>
      <button class="toolbar-button" type="button" onclick={() => runCommand("tab.close")}>
        Close
      </button>
      <button class="toolbar-button" type="button" onclick={() => runCommand("app.toggleSettingsPane")}>
        Settings
      </button>
      <button class="toolbar-button" type="button" onclick={() => runCommand("view.toggleTheme")}>
        Theme
      </button>
      <button class="toolbar-button" type="button" onclick={() => appState.cycleAccent()}>
        Accent
      </button>
    </div>
  </header>

  <section class="workspace">
    <EditorSurface
      content={activeDocument?.content ?? ""}
      wrapLines={state.editor.wrapLines}
      zoomPercent={state.editor.zoomPercent}
      onStatusMessage={notify}
      onDocumentDirty={(nextContent) => {
        if (!activeDocument) {
          return;
        }
        appState.setDocumentContent(activeDocument.id, nextContent);
      }}
      registerEditorCommandRunner={(runner) => {
        editorRunner = runner;
      }}
    />
    <aside class="settings-pane" data-open={settingsPaneOpen}>
      <h2>Settings</h2>
      <p>Theme: {state.settings.themeMode}</p>
      <p>Accent: {state.settings.accent}</p>
      <p>Recent files: {state.recentFiles.length}</p>
      <p>This pane uses token-driven overlay styling.</p>
    </aside>
  </section>

  <footer class="status-bar">
    <button class="status-segment" type="button">Ln {state.editor.cursorLine}, Col {state.editor.cursorColumn}</button>
    <button class="status-segment" type="button">{activeDocument?.encoding.toUpperCase() ?? "UTF-8"}</button>
    <button class="status-segment" type="button">{activeDocument?.lineEnding.toUpperCase() ?? "LF"}</button>
    <button class="status-segment" type="button">{state.editor.zoomPercent}%</button>
    <button class="status-segment" type="button">{state.editor.wrapLines ? "Wrap: On" : "Wrap: Off"}</button>
    <button class="status-segment" type="button">{activeDocument?.isDirty ? "Modified" : "Saved"}</button>
    <button class="status-segment path-segment" type="button">{activeDocument?.filePath ?? "No file path"}</button>
    <span class="status-message">{statusMessage}</span>
  </footer>

  <nav class="command-demo">
    {#each commandDefinitions as command}
      <button class="menu-action" type="button" onclick={() => runCommand(command.id)}>
        {command.menuPath}
      </button>
    {/each}
  </nav>
</main>

<style>
  .shell {
    height: 100vh;
    display: grid;
    grid-template-rows: var(--tab-header-height) 1fr var(--statusbar-height);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
  }

  .tab-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-8);
    padding: 0 var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .tab,
  .toolbar-button,
  .status-segment,
  .menu-action,
  .tab-action {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    height: calc(var(--tab-header-height) - var(--space-8));
    padding: 0 var(--space-8);
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .tab-action {
    height: calc(var(--tab-header-height) - var(--space-12));
    padding: 0 var(--space-4);
  }

  .tab-active {
    background: var(--color-hover);
    border-color: var(--color-border-subtle);
  }

  .workspace {
    position: relative;
    padding: var(--space-8);
    overflow: hidden;
  }

  .settings-pane {
    position: absolute;
    top: var(--space-8);
    right: var(--space-8);
    width: var(--settings-pane-width);
    max-width: calc(100% - var(--space-8) * 2);
    height: calc(100% - var(--space-8) * 2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-overlay);
    backdrop-filter: blur(var(--blur-overlay));
    box-shadow: var(--shadow-overlay);
    padding: var(--space-12);
    transform: translateX(110%);
    opacity: 0;
    pointer-events: none;
    transition:
      transform var(--motion-medium) var(--easing-emphasized),
      opacity var(--motion-medium) var(--easing-standard);
  }

  .settings-pane[data-open="true"] {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-8);
    background: var(--color-statusbar-bg);
    border-top: 1px solid var(--color-border-subtle);
    font-size: var(--font-size-status);
  }

  .status-segment {
    height: calc(var(--statusbar-height) - var(--space-4));
    font-size: var(--font-size-status);
  }

  .status-message {
    margin-left: auto;
    color: var(--color-text-secondary);
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path-segment {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-demo {
    position: absolute;
    inset: auto auto calc(var(--statusbar-height) + var(--space-8)) var(--space-8);
    display: flex;
    gap: var(--space-6);
  }

  .tab:hover,
  .toolbar-button:hover,
  .status-segment:hover,
  .menu-action:hover,
  .tab-action:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .tab:focus-visible,
  .toolbar-button:focus-visible,
  .status-segment:focus-visible,
  .menu-action:focus-visible,
  .tab-action:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .tab:active,
  .toolbar-button:active,
  .status-segment:active,
  .menu-action:active,
  .tab-action:active {
    background: var(--color-pressed);
  }
</style>
