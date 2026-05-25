<script lang="ts">
  import ConsoleLogsPanel from "./ConsoleLogsPanel.svelte";

  type ConsoleTabId = "chat" | "logs";

  let activeTab = $state<ConsoleTabId>("chat");
</script>

<section class="console-panel" aria-hidden="false">
  <div class="console-tabs" role="tablist" aria-label="Console tabs">
    <button
      type="button"
      role="tab"
      class="console-tab"
      class:console-tab-active={activeTab === "chat"}
      aria-selected={activeTab === "chat"}
      tabindex={activeTab === "chat" ? 0 : -1}
      onclick={() => {
        activeTab = "chat";
      }}
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
      onclick={() => {
        activeTab = "logs";
      }}
    >
      Logs
    </button>
  </div>

  <div class="console-content">
    {#if activeTab === "chat"}
      <div class="chat-placeholder" role="tabpanel">
        Start chat
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

  .chat-placeholder {
    display: flex;
    align-items: center;
    height: 100%;
    padding: var(--space-4) var(--space-8);
    color: var(--color-text-secondary);
  }
</style>
