<script lang="ts">
  import { chatStore } from "../../state/chatStore";
  import {
    getOpencodeConfigStore,
    isConfigStoreAvailable,
    loadOpencodeConfigStore,
    saveOpencodeConfig,
  } from "../../ai/opencodeConfigStore";
  import {
    getConfigAgents,
    removeConfigAgent,
    setConfigAgent,
  } from "../../ai/backends/opencodeConfig";
  import type {
    OpencodeAgentConfigEntry,
    OpencodeAgentDetail,
    OpencodeConfigDocument,
  } from "../../ai/backends/workspaceAgentBackend";
  import AgentEditorDialog from "./AgentEditorDialog.svelte";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const workspaceRoot = $derived(chatStore.getActiveWorkspaceRoot());
  const available = $derived(isConfigStoreAvailable(workspaceRoot));
  const store = $derived(
    workspaceRoot ? getOpencodeConfigStore(workspaceRoot) : null,
  );

  let editorOpen = $state(false);
  let editingName = $state<string | null>(null);
  let editingEntry = $state<OpencodeAgentConfigEntry | null>(null);
  let editingReadonly = $state(false);
  let actionError = $state<string | null>(null);
  let wasDialogOpen = false;

  $effect(() => {
    if (dialogOpen && !wasDialogOpen && workspaceRoot && available) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
    wasDialogOpen = dialogOpen;
  });

  function agentsOf(): OpencodeAgentDetail[] {
    return store?.agents ?? [];
  }

  function customAgentNames(): string[] {
    if (!store?.config) {
      return [];
    }
    return Object.keys(getConfigAgents(store.config));
  }

  function startCreate(): void {
    editingName = null;
    editingEntry = null;
    editingReadonly = false;
    actionError = null;
    editorOpen = true;
  }

  function startEdit(detail: OpencodeAgentDetail): void {
    const config = store?.config;
    if (!config) {
      return;
    }
    const custom = getConfigAgents(config);
    const existing = custom[detail.name];
    editingName = detail.name;
    editingReadonly = detail.builtin && !existing;
    editingEntry = existing ?? {
      ...(detail.description ? { description: detail.description } : {}),
      ...(detail.prompt ? { prompt: detail.prompt } : {}),
      ...(detail.model
        ? { model: `${detail.model.providerId}/${detail.model.modelId}` }
        : {}),
      mode: detail.mode,
      ...(detail.steps !== undefined ? { steps: detail.steps } : {}),
    };
    actionError = null;
    editorOpen = true;
  }

  async function persistConfig(next: OpencodeConfigDocument | null | undefined): Promise<void> {
    if (!workspaceRoot || !next) {
      return;
    }
    const state = await saveOpencodeConfig(workspaceRoot, next);
    actionError = state.status === "error" ? state.lastErrorMessage : null;
  }

  async function handleSaveAgent(name: string, entry: OpencodeAgentConfigEntry): Promise<void> {
    const config = store?.config;
    if (!config) {
      return;
    }
    const previousName = editingName;
    const renamed = previousName !== null && previousName !== name;
    let next = config;
    if (renamed && previousName !== null) {
      next = removeConfigAgent(next, previousName);
    }
    next = setConfigAgent(next, name, entry);
    editorOpen = false;
    await persistConfig(next);
  }

  async function handleDeleteAgent(name: string): Promise<void> {
    const config = store?.config;
    if (!config) {
      return;
    }
    editorOpen = false;
    await persistConfig(removeConfigAgent(config, name));
  }

  function handleReload(): void {
    if (workspaceRoot) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
  }

  function modeLabel(mode: OpencodeAgentDetail["mode"]): string {
    switch (mode) {
      case "primary":
        return "Primary";
      case "subagent":
        return "Subagent";
      case "all":
        return "All";
      default:
        return mode;
    }
  }
</script>

{#if !available}
  <section class="settings-section">
    <h3>Agents</h3>
    <p class="settings-section-note">
      Open a workspace folder with OpenCode enabled to manage agents.
    </p>
  </section>
{:else}
  <section class="settings-section">
    <h3>Agents</h3>
    <p class="settings-section-note">
      Built-in and custom agents for the active workspace. Custom agents are written to the
      <code>agent:</code> key in <code>opencode.json</code>.
    </p>
    {#if store?.status === "loading"}
      <p class="settings-section-note">Loading agents…</p>
    {:else if store?.status === "error"}
      <p class="settings-section-note agent-error">
        {store.lastErrorMessage ?? "Failed to load agents."}
      </p>
      <button type="button" class="btn btn-sm" onclick={handleReload}>Retry</button>
    {:else}
      <div class="connection-list">
        {#each agentsOf() as agent (agent.name)}
          <div class="connection-row agent-row">
            <div class="agent-row-main">
              <span class="agent-row-name">{agent.name}</span>
              {#if agent.builtin}<span class="agent-tag">built-in</span>{:else}<span class="agent-tag agent-tag-custom">custom</span>{/if}
              <span class="agent-row-meta">{modeLabel(agent.mode)}</span>
              {#if agent.model}<span class="agent-row-meta">{agent.model.providerId}/{agent.model.modelId}</span>{/if}
              {#if agent.description}<span class="agent-row-desc">{agent.description}</span>{/if}
            </div>
            <div class="agent-row-actions">
              <button type="button" class="btn btn-sm" onclick={() => startEdit(agent)}>
                {agent.builtin ? "View" : "Edit"}
              </button>
            </div>
          </div>
        {/each}
      </div>
      {#if actionError}<p class="settings-section-note agent-error">{actionError}</p>{/if}
      <div class="agent-create-actions">
        <button type="button" class="btn btn-sm" onclick={startCreate}>New custom agent</button>
        <button type="button" class="btn btn-sm" onclick={handleReload}>Refresh</button>
      </div>
      <p class="settings-section-note">
        {agentsOf().length} agent(s) · {customAgentNames().length} custom
      </p>
    {/if}
  </section>
{/if}

<AgentEditorDialog
  open={editorOpen}
  name={editingName}
  entry={editingEntry}
  readonly={editingReadonly}
  onClose={() => (editorOpen = false)}
  onSave={handleSaveAgent}
  onDelete={handleDeleteAgent}
/>

<style>
  .agent-row {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
  }

  .agent-row-main {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .agent-row-name {
    font-weight: 600;
  }

  .agent-row-meta {
    color: var(--color-text-secondary);
    font-size: 0.75rem;
  }

  .agent-row-desc {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .agent-row-actions {
    display: flex;
    gap: var(--space-3);
  }

  .agent-tag {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
  }

  .agent-tag-custom {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .agent-create-actions {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .agent-error {
    color: var(--color-text-danger);
  }
</style>
