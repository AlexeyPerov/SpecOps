<script lang="ts">
  interface ConnectionOption {
    value: string;
    label: string;
  }

  interface Props {
    availableConnections: ConnectionOption[];
    activeConnectionSelection: string | null;
    availableModels: string[];
    activeModel: string;
    connectionDisabled: boolean;
    modelDisabled: boolean;
    onSelectConnection: (value: string) => void;
    onSelectModel: (modelId: string) => void;
  }

  let {
    availableConnections,
    activeConnectionSelection,
    availableModels,
    activeModel,
    connectionDisabled,
    modelDisabled,
    onSelectConnection,
    onSelectModel,
  }: Props = $props();
</script>

<div class="chat-provider-picker">
  <label class="chat-provider-field">
    <select
      class="chat-provider-select"
      aria-label="Select chat connection"
      value={activeConnectionSelection ?? ""}
      disabled={connectionDisabled}
      onchange={(event) => {
        const next = (event.currentTarget as HTMLSelectElement).value;
        onSelectConnection(next);
      }}
    >
      {#each availableConnections as connection (connection.value)}
        <option value={connection.value}>{connection.label}</option>
      {/each}
    </select>
  </label>
  <label class="chat-provider-field">
    <select
      class="chat-provider-select"
      aria-label="Select chat model"
      value={activeModel}
      disabled={modelDisabled}
      onchange={(event) => {
        const next = (event.currentTarget as HTMLSelectElement).value;
        onSelectModel(next);
      }}
    >
      {#each availableModels as modelId (modelId)}
        <option value={modelId}>{modelId}</option>
      {/each}
    </select>
  </label>
</div>

<style>
  .chat-provider-picker {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
  }

  .chat-provider-field {
    display: inline-flex;
    align-items: center;
    min-width: 0;
  }

  .chat-provider-select {
    min-height: 24px;
    min-width: 120px;
    max-width: 180px;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 11px;
    line-height: 1;
  }

  .chat-provider-select:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-provider-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @container (max-width: 520px) {
    .chat-provider-picker {
      flex: 1 1 100%;
    }

    .chat-provider-field {
      flex: 1;
      min-width: 0;
    }

    .chat-provider-select {
      width: 100%;
      max-width: none;
    }
  }
</style>
