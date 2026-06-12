<script lang="ts">
  import Select from "./Select.svelte";

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

  const connectionOptions = $derived(
    availableConnections.map((c) => ({ value: c.value, label: c.label })),
  );
  const modelOptions = $derived(
    availableModels.map((m) => ({ value: m, label: m })),
  );
</script>

<div class="chat-provider-picker">
  <Select
    options={connectionOptions}
    value={activeConnectionSelection ?? ""}
    disabled={connectionDisabled}
    onchange={onSelectConnection}
    ariaLabel="Select chat connection"
    class="chat-provider-select"
  />
  <Select
    options={modelOptions}
    value={activeModel}
    disabled={modelDisabled}
    onchange={onSelectModel}
    ariaLabel="Select chat model"
    class="chat-provider-select"
  />
</div>

<style>
  .chat-provider-picker {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
  }

  :global(.chat-provider-select) {
    min-width: 120px;
    max-width: 180px;
  }

  :global(.chat-provider-select .select-trigger) {
    font-size: 11px;
  }

  @container (max-width: 520px) {
    .chat-provider-picker {
      flex: 1 1 100%;
    }

    :global(.chat-provider-select) {
      flex: 1;
      min-width: 0;
      max-width: none;
    }
  }
</style>
