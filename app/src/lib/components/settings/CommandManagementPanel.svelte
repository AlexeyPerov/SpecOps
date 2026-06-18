<script lang="ts">
  import { chatStore } from "../../state/chatStore";
  import {
    getOpencodeConfigStore,
    isConfigStoreAvailable,
    loadOpencodeConfigStore,
    saveOpencodeConfig,
  } from "../../ai/opencodeConfigStore";
  import {
    getConfigCommands,
    removeConfigCommand,
    setConfigCommand,
  } from "../../ai/backends/opencodeConfig";
  import type { OpencodeCommandConfigEntry, OpencodeConfigDocument } from "../../ai/backends/workspaceAgentBackend";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const workspaceRoot = $derived(chatStore.getActiveWorkspaceRoot());
  const available = $derived(isConfigStoreAvailable(workspaceRoot));
  const store = $derived(
    workspaceRoot ? getOpencodeConfigStore(workspaceRoot) : null,
  );

  type Draft = { name: string; entry: OpencodeCommandConfigEntry };
  let editing = $state<Draft | null>(null);
  let actionError = $state<string | null>(null);
  let wasDialogOpen = false;

  $effect(() => {
    if (dialogOpen && !wasDialogOpen && workspaceRoot && available) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
    wasDialogOpen = dialogOpen;
  });

  function commandsOf(): Record<string, OpencodeCommandConfigEntry> {
    if (!store?.config) {
      return {};
    }
    return getConfigCommands(store.config);
  }

  function startCreate(): void {
    editing = { name: "", entry: { template: "" } };
    actionError = null;
  }

  function startEdit(name: string, entry: OpencodeCommandConfigEntry): void {
    editing = { name, entry: { ...entry } };
    actionError = null;
  }

  async function persistConfig(next: OpencodeConfigDocument | null | undefined): Promise<void> {
    if (!workspaceRoot || !next) {
      return;
    }
    const state = await saveOpencodeConfig(workspaceRoot, next);
    actionError = state.status === "error" ? state.lastErrorMessage : null;
  }

  async function handleSave(originalName: string, name: string, entry: OpencodeCommandConfigEntry): Promise<void> {
    const config = store?.config;
    if (!config) {
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      actionError = "Command name is required.";
      return;
    }
    if (entry.template.trim().length === 0) {
      actionError = "Template is required.";
      return;
    }
    let next = config;
    if (originalName && originalName !== trimmedName) {
      next = removeConfigCommand(next, originalName);
    }
    next = setConfigCommand(next, trimmedName, entry);
    editing = null;
    await persistConfig(next);
  }

  async function handleDelete(name: string): Promise<void> {
    const config = store?.config;
    if (!config) {
      return;
    }
    editing = null;
    await persistConfig(removeConfigCommand(config, name));
  }

  function handleReload(): void {
    if (workspaceRoot) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
  }
</script>

{#if !available}
  <section class="settings-section">
    <h3>Slash commands</h3>
    <p class="settings-section-note">
      Open a workspace folder with OpenCode enabled to manage slash commands.
    </p>
  </section>
{:else}
  <section class="settings-section">
    <h3>Slash commands</h3>
    <p class="settings-section-note">
      Config-defined slash commands are written to the <code>command:</code> key in
      <code>opencode.json</code>. MCP / skill commands are discovered automatically.
    </p>
    {#if store?.status === "loading"}
      <p class="settings-section-note">Loading commands…</p>
    {:else if store?.status === "error"}
      <p class="settings-section-note command-error">
        {store.lastErrorMessage ?? "Failed to load config."}
      </p>
      <button type="button" class="settings-action" onclick={handleReload}>Retry</button>
    {:else}
      {@const commands = commandsOf()}
      {#if Object.keys(commands).length === 0}
        <p class="settings-section-note">No config-defined commands. Click "New command" to create one.</p>
      {:else}
        <div class="connection-list">
          {#each Object.entries(commands) as [name, entry] (name)}
            <div class="connection-row command-row">
              <div class="command-row-main">
                <span class="command-row-name">/{name}</span>
                {#if entry.description}<span class="command-row-desc">{entry.description}</span>{/if}
                {#if entry.agent}<span class="command-row-meta">agent: {entry.agent}</span>{/if}
              </div>
              <button type="button" class="settings-action" onclick={() => startEdit(name, entry)}>
                Edit
              </button>
            </div>
          {/each}
        </div>
      {/if}
      {#if actionError}<p class="settings-section-note command-error">{actionError}</p>{/if}
      <div class="command-actions">
        <button type="button" class="settings-action" onclick={startCreate}>New command</button>
        <button type="button" class="settings-action" onclick={handleReload}>Refresh</button>
      </div>

      {#if editing}
        {@const draft = editing}
        <div class="settings-subsection command-editor">
          <h4>{draft.name ? `Edit /${draft.name}` : "New command"}</h4>
          <label class="settings-field">
            <span>Name</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="review"
              value={draft.name}
              oninput={(event) =>
                (editing = { ...draft, name: (event.currentTarget as HTMLInputElement).value })}
            />
          </label>
          <label class="settings-field">
            <span>Description</span>
            <input
              type="text"
              spellcheck="false"
              value={draft.entry.description ?? ""}
              oninput={(event) =>
                (editing = {
                  ...draft,
                  entry: {
                    ...draft.entry,
                    description: (event.currentTarget as HTMLInputElement).value,
                  },
                })}
            />
          </label>
          <label class="settings-field">
            <span>Agent (optional)</span>
            <input
              type="text"
              spellcheck="false"
              value={draft.entry.agent ?? ""}
              oninput={(event) =>
                (editing = {
                  ...draft,
                  entry: {
                    ...draft.entry,
                    agent: (event.currentTarget as HTMLInputElement).value,
                  },
                })}
            />
          </label>
          <label class="settings-field">
            <span>Template (markdown)</span>
            <textarea
              rows="6"
              spellcheck="false"
              placeholder="Review the selected code for bugs."
              value={draft.entry.template}
              oninput={(event) =>
                (editing = {
                  ...draft,
                  entry: {
                    ...draft.entry,
                    template: (event.currentTarget as HTMLTextAreaElement).value,
                  },
                })}
            ></textarea>
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={draft.entry.subtask ?? false}
              onchange={(event) =>
                (editing = {
                  ...draft,
                  entry: {
                    ...draft.entry,
                    subtask: (event.currentTarget as HTMLInputElement).checked,
                  },
                })}
            />
            Run as subtask
          </label>
          <div class="command-editor-actions">
            <button type="button" class="settings-action" onclick={() => (editing = null)}>Cancel</button>
            {#if draft.name}
              <button
                type="button"
                class="settings-action settings-action-danger"
                onclick={() => handleDelete(draft.name)}
              >
                Delete
              </button>
            {/if}
            <button
              type="button"
              class="settings-action"
              onclick={() => handleSave(draft.name, draft.name, draft.entry)}
            >
              Save
            </button>
          </div>
        </div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsFormMultiline.css";
  @import "../../styles/settingsDialogForm.css";
  @import "../../styles/settingsPanelLists.css";

  .command-row-main {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }

  .command-row-name {
    font-weight: 600;
    font-family: var(--font-mono, monospace);
  }

  .command-row-desc {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .command-row-meta {
    color: var(--color-text-secondary);
    font-size: 0.75rem;
  }

  .command-actions {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .command-editor {
    margin-top: var(--space-8);
    padding-top: var(--space-8);
    border-top: 1px solid var(--color-border-subtle);
  }

  .command-editor-actions {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .command-editor-actions .settings-action-danger {
    margin-right: auto;
  }

  .command-error {
    color: var(--color-text-danger);
  }
</style>
