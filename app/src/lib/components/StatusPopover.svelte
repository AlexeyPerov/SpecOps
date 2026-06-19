<script lang="ts">
  import { getStatusSummary, refreshStatusSummary } from "../ai/opencodeStatusSummary";
  import { openSettingsDialog } from "../services/settingsDialogUi";
  import { onMount } from "svelte";

  /**
   * M5-T4 — status popover. Aggregated LSP / MCP / provider / model /
   * permission snapshot for the active workspace, with quick links to the
   * relevant settings panels. Rendered as an anchored popover from the
   * title-bar status button.
   */
  interface Props {
    workspaceRootPath: string;
    open: boolean;
    onClose?: () => void;
  }

  let { workspaceRootPath, open, onClose }: Props = $props();

  let popoverEl = $state<HTMLDivElement | null>(null);

  // Derive the store from the live prop (a fresh Readable is returned per
  // workspace root) and subscribe in a second `$derived`. The previous
  // `const store = …` captured the initial prop value and tripped svelte-check's
  // `state_referenced_locally` warning.
  const store = $derived(getStatusSummary(workspaceRootPath));
  const summary = $derived($store);

  onMount(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (!open) {
        return;
      }
      if (popoverEl?.contains(event.target as Node)) {
        return;
      }
      onClose?.();
    }
    function handleKeydown(event: KeyboardEvent): void {
      if (open && event.key === "Escape") {
        onClose?.();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeydown);
    };
  });

  function handleRefresh(): void {
    void refreshStatusSummary({ workspaceRootPath });
  }

  function openSettings(tab: Parameters<typeof openSettingsDialog>[0]): void {
    openSettingsDialog(tab);
    onClose?.();
  }

  const lspConnected = $derived(
    summary.lspServers.filter((server) => server.status === "connected").length,
  );
</script>

{#if open}
  <div
    bind:this={popoverEl}
    class="status-popover"
    role="dialog"
    aria-label="Workspace status"
    tabindex="-1"
  >
    <header class="status-popover-header">
      <h2>Status</h2>
      <button
        type="button"
        class="toolbar-button status-popover-refresh"
        onclick={handleRefresh}
        disabled={summary.status === "loading"}
      >
        {summary.status === "loading" ? "Loading…" : "Refresh"}
      </button>
    </header>

    {#if summary.status === "error" && summary.lastErrorMessage}
      <p class="status-popover-error" role="alert">{summary.lastErrorMessage}</p>
    {/if}

    <dl class="status-popover-grid">
      <button
        type="button"
        class="status-row"
        onclick={() => openSettings("openCodeConfig")}
        title="Open OpenCode config"
      >
        <dt>Model</dt>
        <dd>{summary.defaultModelId ?? "default"}</dd>
      </button>
      <button
        type="button"
        class="status-row"
        onclick={() => openSettings("agents")}
        title="Open agent settings"
      >
        <dt>Default agent</dt>
        <dd>{summary.defaultAgentId ?? "—"}</dd>
      </button>
      <div class="status-row status-row-static">
        <dt>LSP servers</dt>
        <dd>{lspConnected}/{summary.lspServers.length} connected</dd>
      </div>
      <button
        type="button"
        class="status-row"
        onclick={() => openSettings("mcp")}
        title="Open MCP settings"
      >
        <dt>MCP servers</dt>
        <dd>{summary.mcpConnected}/{summary.mcpTotal} connected</dd>
      </button>
      <button
        type="button"
        class="status-row"
        onclick={() => openSettings("providers")}
        title="Open provider settings"
      >
        <dt>Providers</dt>
        <dd>{summary.providersConnected}/{summary.providersTotal} connected</dd>
      </button>
      <button
        type="button"
        class="status-row"
        onclick={() => openSettings("permissions")}
        title="Open permission rules"
      >
        <dt>Permission rules</dt>
        <dd>{summary.permissionRuleCount}</dd>
      </button>
    </dl>

    {#if summary.loadedAt}
      <footer class="status-popover-footer">
        Updated {new Date(summary.loadedAt).toLocaleTimeString()}
      </footer>
    {/if}
  </div>
{/if}

<style>
  .status-popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: var(--space-4);
    z-index: 1200;
    min-width: 240px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    color: var(--color-text-primary);
    display: flex;
    flex-direction: column;
  }

  .status-popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .status-popover-header h2 {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
  }

  .status-popover-refresh {
    min-height: 22px;
    font-size: 11px;
  }

  .status-popover-error {
    margin: 0;
    padding: var(--space-4) var(--space-8);
    color: #e06c75;
    font-size: 11px;
  }

  .status-popover-grid {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button.status-row:hover {
    background: var(--color-hover);
    border-color: var(--color-border-subtle);
  }

  .status-row-static {
    cursor: default;
  }

  .status-row dt {
    margin: 0;
    font-size: 11px;
    color: var(--color-text-secondary);
  }

  .status-row dd {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .status-popover-footer {
    padding: var(--space-3) var(--space-8);
    border-top: 1px solid var(--color-border-subtle);
    font-size: 10px;
    color: var(--color-text-secondary);
  }
</style>
