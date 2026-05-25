<script lang="ts">
  import ChatPanel from "./ChatPanel.svelte";
  import ConsoleLogsPanel from "./ConsoleLogsPanel.svelte";

  import type { ConsoleTabId } from "../services/consoleTabPrefs";

  let {
    showChatTab = true,
    activeTab = "chat",
    onTabChange,
  }: {
    showChatTab?: boolean;
    activeTab?: ConsoleTabId;
    onTabChange?: (nextTab: ConsoleTabId) => void;
  } = $props();

  function selectTab(nextTab: ConsoleTabId): void {
    if (activeTab === nextTab) {
      return;
    }
    activeTab = nextTab;
    onTabChange?.(nextTab);
  }

  $effect(() => {
    if (!showChatTab && activeTab !== "logs") {
      activeTab = "logs";
      onTabChange?.("logs");
    }
  });
</script>

<section class="console-panel" aria-hidden="false">
  {#if showChatTab}
    <div class="console-tabs" role="tablist" aria-label="Console tabs">
      <button
        type="button"
        role="tab"
        class="console-tab"
        class:console-tab-active={activeTab === "chat"}
        aria-selected={activeTab === "chat"}
        tabindex={activeTab === "chat" ? 0 : -1}
        onclick={() => selectTab("chat")}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        class="console-tab"
        class:console-tab-active={activeTab === "logs"}
        aria-selected={activeTab === "logs"}
        tabindex={activeTab === "logs" ? 0 : -1}
        onclick={() => selectTab("logs")}
      >
        Logs
      </button>
    </div>
  {/if}

  <div class="console-content">
    {#if showChatTab && activeTab === "chat"}
      <div role="tabpanel" aria-label="Chat panel">
        <ChatPanel />
      </div>
    {:else}
      <div role="tabpanel" class="logs-panel-wrap">
        <ConsoleLogsPanel />
      </div>
    {/if}
  </div>
</section>

<style>
  .console-panel {
    min-height: 0;
    height: var(--console-height);
    overflow: hidden;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    display: flex;
    flex-direction: column;
  }

  .console-tabs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .console-tab {
    min-height: 24px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 12px;
    line-height: 1;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard);
  }

  .console-tab:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .console-tab:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .console-tab-active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-text-primary);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .console-content {
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

  .logs-panel-wrap {
    height: 100%;
    min-height: 0;
  }
</style>
