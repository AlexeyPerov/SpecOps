<script lang="ts">
  import { chatStore } from "../../state/chatStore";
  import {
    getOpencodeConfigStore,
    isConfigStoreAvailable,
    loadOpencodeConfigStore,
    savePermissionConfig,
  } from "../../ai/opencodeConfigStore";
  import {
    PERMISSION_ACTIONS,
    PERMISSION_TOOLS,
    addPermissionRule,
    buildPermissionMap,
    getConfigPermissionRules,
    getGlobalPermissionAction,
    removePermissionRule,
    updatePermissionRule,
  } from "../../ai/backends/opencodeConfig";
  import type {
    OpencodePermissionRule,
  } from "../../ai/backends/workspaceAgentBackend";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const workspaceRoot = $derived(chatStore.getActiveWorkspaceRoot());
  const available = $derived(isConfigStoreAvailable(workspaceRoot));
  const store = $derived(
    workspaceRoot ? getOpencodeConfigStore(workspaceRoot) : null,
  );

  let rules = $state<OpencodePermissionRule[]>([]);
  let dirty = $state(false);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let wasDialogOpen = false;

  // Seed rules from the loaded config.
  $effect(() => {
    void store?.loadedAt;
    if (store?.config) {
      rules = getConfigPermissionRules(store.config);
      dirty = false;
    }
  });

  $effect(() => {
    if (dialogOpen && !wasDialogOpen && workspaceRoot && available) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
    wasDialogOpen = dialogOpen;
  });

  const globalAction = $derived(store?.config ? getGlobalPermissionAction(store.config) : "ask");

  function handleAdd(): void {
    rules = addPermissionRule(rules);
    dirty = true;
  }

  function handleUpdate(index: number, patch: Partial<OpencodePermissionRule>): void {
    rules = updatePermissionRule(rules, index, patch);
    dirty = true;
  }

  function handleRemove(index: number): void {
    rules = removePermissionRule(rules, index);
    dirty = true;
  }

  async function handleSave(): Promise<void> {
    if (!workspaceRoot) {
      return;
    }
    saving = true;
    saveError = null;
    const permission = buildPermissionMap(rules);
    const ok = await savePermissionConfig(workspaceRoot, permission);
    saving = false;
    if (ok) {
      dirty = false;
    } else {
      saveError = "Failed to save permission rules.";
    }
  }

  function handleReload(): void {
    if (workspaceRoot) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
  }
</script>

{#if !available}
  <section class="settings-section">
    <h3>Permission rules</h3>
    <p class="settings-section-note">
      Open a workspace folder with OpenCode enabled to edit permission rules.
    </p>
  </section>
{:else if store?.status === "error"}
  <section class="settings-section">
    <h3>Permission rules</h3>
    <p class="settings-section-note permission-error">
      {store.lastErrorMessage ?? "Failed to load config."}
    </p>
    <button type="button" class="btn btn-sm" onclick={handleReload}>Retry</button>
  </section>
{:else}
  <section class="settings-section">
    <h3>Permission rules</h3>
    <p class="settings-section-note">
      Control which tool actions are allowed, denied, or require confirmation. Rules without a pattern
      fall back to the global default (<strong>{globalAction}</strong>).
    </p>
    {#if store?.status === "loading"}
      <p class="settings-section-note">Loading…</p>
    {:else}
      <div class="connection-list">
        {#each rules as rule, index (`${rule.permission}-${rule.pattern}-${index}`)}
          <div class="connection-row permission-row">
            <select
              class="permission-tool-select"
              value={rule.permission}
              onchange={(event) =>
                handleUpdate(index, {
                  permission: (event.currentTarget as HTMLSelectElement).value,
                })}
            >
              {#each PERMISSION_TOOLS as tool (tool)}
                <option value={tool}>{tool}</option>
              {/each}
            </select>
            <input
              class="permission-pattern-input"
              type="text"
              spellcheck="false"
              placeholder="glob pattern (e.g. src/**)"
              value={rule.pattern}
              oninput={(event) =>
                handleUpdate(index, {
                  pattern: (event.currentTarget as HTMLInputElement).value,
                })}
            />
            <select
              class="permission-action-select"
              value={rule.action}
              onchange={(event) =>
                handleUpdate(index, {
                  action: (event.currentTarget as HTMLSelectElement).value as OpencodePermissionRule["action"],
                })}
            >
              {#each PERMISSION_ACTIONS as action (action)}
                <option value={action}>{action}</option>
              {/each}
            </select>
            <button
              type="button"
              class="btn btn-sm btn-sm-danger"
              onclick={() => handleRemove(index)}
            >
              Remove
            </button>
          </div>
        {:else}
          <p class="settings-section-note">
            No per-pattern rules. The global default ({globalAction}) applies to every tool.
          </p>
        {/each}
      </div>
      {#if saveError}<p class="settings-section-note permission-error">{saveError}</p>{/if}
      <div class="permission-actions">
        <button type="button" class="btn btn-sm" onclick={handleAdd}>Add rule</button>
        <button type="button" class="btn btn-sm" onclick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" class="btn btn-sm" onclick={handleReload}>Reload</button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .permission-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .permission-tool-select,
  .permission-action-select {
    min-height: 28px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
  }

  .permission-tool-select {
    flex-shrink: 0;
  }

  .permission-pattern-input {
    flex: 1;
    min-width: 160px;
    min-height: 28px;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 0.8125rem;
  }

  .permission-actions {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .permission-error {
    color: var(--color-text-danger);
  }
</style>
