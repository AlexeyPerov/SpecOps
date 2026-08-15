<script lang="ts">
  import type {
    AgentModelDescriptor,
    AgentModeDescriptor,
  } from "../session/binding";
  import type { SessionCatalogSnapshot } from "../services/agentHostRuntime";

  /**
   * Runtime-neutral runtime/model/mode picker for the session composer.
   *
   * The runtime is fixed for the session's lifetime (immutable binding); only
   * the model and mode are selectable. When the runtime catalog is loading,
   * unavailable, or empty, the selects render disabled with an explanatory
   * title so unsupported states are explained rather than blank.
   */
  interface Props {
    runtimeId: string;
    runtimeLabel: string;
    catalog: SessionCatalogSnapshot;
    activeModelId: string;
    activeModeId: string;
    disabled?: boolean;
    onSelectModel?: (modelId: string) => void;
    onSelectMode?: (modeId: string) => void;
  }

  let {
    runtimeId,
    runtimeLabel,
    catalog,
    activeModelId,
    activeModeId,
    disabled = false,
    onSelectModel,
    onSelectMode,
  }: Props = $props();

  const catalogUnavailableTitle = $derived.by(() => {
    if (catalog.status === "loading") {
      return "Loading the runtime catalog…";
    }
    if (catalog.status === "error") {
      return catalog.errorMessage ?? "Runtime catalog is unavailable.";
    }
    if (catalog.status === "empty") {
      return "This runtime exposes no models or modes.";
    }
    return "";
  });
  const isCatalogDisabled = $derived(
    disabled || catalog.status === "loading" || catalog.status === "error" || catalog.status === "empty",
  );
  const models = $derived(catalog.models as readonly AgentModelDescriptor[]);
  const modes = $derived(catalog.modes as readonly AgentModeDescriptor[]);
  const hasModes = $derived(modes.length > 1);

  function modelLabel(model: AgentModelDescriptor): string {
    return model.name ?? model.id;
  }

  function modeLabel(mode: AgentModeDescriptor): string {
    return mode.name ?? mode.id;
  }
</script>

<div class="session-catalog-picker" role="group" aria-label="Session runtime catalog">
  <span class="session-catalog-runtime" title={`Session runtime: ${runtimeLabel} (fixed for this session)`}>
    {runtimeLabel}
  </span>
  <label class="session-catalog-field">
    <span class="session-catalog-label">Model</span>
    <select
      class="session-catalog-select"
      disabled={isCatalogDisabled || models.length === 0}
      title={models.length === 0 ? catalogUnavailableTitle || "This runtime lists no models." : ""}
      value={activeModelId}
      onchange={(event) => {
        const value = event.currentTarget.value;
        if (value) {
          onSelectModel?.(value);
        }
      }}
    >
      {#if models.length === 0}
        <option value="">{catalog.status === "loading" ? "Loading…" : "No models"}</option>
      {:else}
        {#each models as model (model.id)}
          <option value={model.id}>{modelLabel(model)}</option>
        {/each}
      {/if}
    </select>
  </label>
  {#if hasModes}
    <label class="session-catalog-field">
      <span class="session-catalog-label">Mode</span>
      <select
        class="session-catalog-select"
        disabled={isCatalogDisabled}
        value={activeModeId}
        onchange={(event) => {
          const value = event.currentTarget.value;
          if (value) {
            onSelectMode?.(value);
          }
        }}
      >
        {#each modes as mode (mode.id)}
          <option value={mode.id}>{modeLabel(mode)}</option>
        {/each}
      </select>
    </label>
  {/if}
</div>

<style>
  .session-catalog-picker {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  .session-catalog-runtime {
    display: inline-block;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: 10px;
    line-height: 1.6;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .session-catalog-field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .session-catalog-label {
    color: var(--color-text-secondary);
    font-size: 10px;
    white-space: nowrap;
  }

  .session-catalog-select {
    max-width: 160px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: 11px;
    line-height: 1.5;
    min-height: 22px;
  }

  .session-catalog-select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
