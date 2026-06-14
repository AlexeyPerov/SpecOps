<script lang="ts">
  import Select from "./Select.svelte";
  import type { OpencodeCatalogState } from "../ai/opencodeCatalog";
  import type { OpencodeAgentEntry, OpencodeProviderEntry, OpencodeModelEntry } from "../ai/backends/workspaceAgentBackend";

  interface Props {
    catalog: OpencodeCatalogState | null;
    activeAgentId?: string;
    activeProviderId?: string;
    activeModelId?: string;
    disabled: boolean;
    onSelectAgent: (agentId: string) => void;
    onSelectProvider: (providerId: string) => void;
    onSelectModel: (modelId: string) => void;
  }

  let {
    catalog,
    activeAgentId = "",
    activeProviderId = "",
    activeModelId = "",
    disabled,
    onSelectAgent,
    onSelectProvider,
    onSelectModel,
  }: Props = $props();

  const agents = $derived(catalog?.agents ?? []);
  const providers = $derived(catalog?.providers ?? []);
  const models = $derived(catalog?.models ?? []);
  const status = $derived(catalog?.status ?? "idle");

  const agentOptions = $derived(
    agents.map((agent: OpencodeAgentEntry) => ({ value: agent.id, label: agent.name })),
  );
  const providerOptions = $derived(
    providers.map((provider: OpencodeProviderEntry) => ({ value: provider.id, label: provider.name })),
  );
  const modelOptions = $derived(
    models.map((model: OpencodeModelEntry) => ({ value: model.id, label: model.name })),
  );

  const showLoadingHint = $derived(status === "idle" || status === "loading");
  const showErrorHint = $derived(status === "error");
  const showEmptyHint = $derived(status === "loaded" && models.length === 0);
</script>

<div class="ws-catalog-picker">
  {#if showErrorHint}
    <span class="ws-catalog-hint ws-catalog-hint--error" title="OpenCode catalog failed to load">
      Catalog error — check Settings &rarr; Workspaces &rarr; OpenCode
    </span>
  {:else if showLoadingHint}
    <span class="ws-catalog-hint" title="Loading OpenCode catalog">
      Loading models&hellip;
    </span>
  {:else if showEmptyHint}
    <span class="ws-catalog-hint" title="No models in OpenCode catalog">
      No models &mdash; use Refresh model list in Settings &rarr; Workspaces &rarr; OpenCode
    </span>
  {:else}
    {#if agentOptions.length > 0}
      <Select
        options={agentOptions}
        value={activeAgentId}
        {disabled}
        onchange={onSelectAgent}
        ariaLabel="Select OpenCode agent"
        class="ws-catalog-select"
      />
    {/if}
    {#if providerOptions.length > 0}
      <Select
        options={providerOptions}
        value={activeProviderId}
        {disabled}
        onchange={onSelectProvider}
        ariaLabel="Select OpenCode provider"
        class="ws-catalog-select"
      />
    {/if}
    <Select
      options={modelOptions}
      value={activeModelId}
      {disabled}
      onchange={onSelectModel}
      ariaLabel="Select workspace model"
      class="ws-catalog-select"
    />
  {/if}
</div>

<style>
  .ws-catalog-picker {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
  }

  :global(.ws-catalog-select) {
    min-width: 120px;
    max-width: 180px;
  }

  :global(.ws-catalog-select .select-trigger) {
    font-size: 11px;
  }

  .ws-catalog-hint {
    font-size: 11px;
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ws-catalog-hint--error {
    color: #e06c75;
  }

  @container (max-width: 520px) {
    .ws-catalog-picker {
      flex: 1 1 100%;
    }

    :global(.ws-catalog-select) {
      flex: 1;
      min-width: 0;
      max-width: none;
    }
  }
</style>
