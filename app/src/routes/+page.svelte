<script lang="ts">
  import { onMount } from "svelte";
  import EditorSurface from "../lib/components/EditorSurface.svelte";
  import {
    commandDefinitions,
    dispatchMenuCommand,
    getActiveDocumentContent,
    keymapCommandForEvent,
  } from "../lib/commands/registry";
  import { appState } from "../lib/state/appState";
  import { initializeLogging, logDiagnostic } from "../lib/services/logging";

  let settingsPaneOpen = false;
  let statusMessage = "Ready";

  $: state = $appState;
  $: activeContent = getActiveDocumentContent();

  function notify(message: string): void {
    statusMessage = message;
  }

  function runCommand(commandId: (typeof commandDefinitions)[number]["id"]): void {
    dispatchMenuCommand(commandId, {
      isSettingsPaneOpen: () => settingsPaneOpen,
      setSettingsPaneOpen: (next) => {
        settingsPaneOpen = next;
      },
      notify,
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
    const command = keymapCommandForEvent(event);
    if (!command) {
      return;
    }

    event.preventDefault();
    runCommand(command);
  }

  onMount(() => {
    void setupRuntime();
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
      <button class="tab tab-active" type="button">Untitled</button>
      <button class="tab" type="button">README.md</button>
    </div>
    <div class="header-right">
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
    <EditorSurface initialContent={activeContent} />
    <aside class="settings-pane" data-open={settingsPaneOpen}>
      <h2>Settings</h2>
      <p>Theme: {state.settings.themeMode}</p>
      <p>Accent: {state.settings.accent}</p>
      <p>This pane uses token-driven overlay styling.</p>
    </aside>
  </section>

  <footer class="status-bar">
    <button class="status-segment" type="button">Ln 1, Col 1</button>
    <button class="status-segment" type="button">{state.documents[0].encoding.toUpperCase()}</button>
    <button class="status-segment" type="button">{state.documents[0].lineEnding.toUpperCase()}</button>
    <button class="status-segment" type="button">100%</button>
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
  .menu-action {
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
  .menu-action:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .tab:focus-visible,
  .toolbar-button:focus-visible,
  .status-segment:focus-visible,
  .menu-action:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .tab:active,
  .toolbar-button:active,
  .status-segment:active,
  .menu-action:active {
    background: var(--color-pressed);
  }
</style>
