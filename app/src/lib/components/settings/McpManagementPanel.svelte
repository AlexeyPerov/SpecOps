<script lang="ts">
  import { chatStore } from "../../state/chatStore";
  import {
    addMcpServer,
    connectMcpServer,
    disconnectMcpServer,
    getOpencodeConfigStore,
    isConfigStoreAvailable,
    loadOpencodeConfigStore,
  } from "../../ai/opencodeConfigStore";
  import type {
    OpencodeMcpConfig,
    OpencodeMcpStatusEntry,
  } from "../../ai/backends/workspaceAgentBackend";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const workspaceRoot = $derived(chatStore.getActiveWorkspaceRoot());
  const available = $derived(isConfigStoreAvailable(workspaceRoot));
  const store = $derived(
    workspaceRoot ? getOpencodeConfigStore(workspaceRoot) : null,
  );

  type AddMode = "local" | "remote";
  let adding = $state(false);
  let addMode = $state<AddMode>("local");
  let addName = $state("");
  let addCommand = $state(""); // local: space-separated command + args
  let addCwd = $state("");
  let addEnv = $state(""); // local: KEY=VALUE per line
  let addUrl = $state("");
  let addHeaders = $state(""); // remote: KEY: VALUE per line
  let addError = $state<string | null>(null);
  let addingServer = $state(false);
  let wasDialogOpen = false;

  $effect(() => {
    if (dialogOpen && !wasDialogOpen && workspaceRoot && available) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
    wasDialogOpen = dialogOpen;
  });

  function resetAddForm(): void {
    addName = "";
    addCommand = "";
    addCwd = "";
    addEnv = "";
    addUrl = "";
    addHeaders = "";
    addError = null;
  }

  function startAdd(mode: AddMode): void {
    resetAddForm();
    addMode = mode;
    adding = true;
  }

  function cancelAdd(): void {
    adding = false;
    resetAddForm();
  }

  function parseKeyValueLines(
    raw: string,
    separator: string,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const idx = trimmed.indexOf(separator);
      if (idx === -1) {
        continue;
      }
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + separator.length).trim();
      if (key.length > 0) {
        out[key] = value;
      }
    }
    return out;
  }

  async function handleAdd(): Promise<void> {
    if (!workspaceRoot) {
      return;
    }
    const name = addName.trim();
    if (name.length === 0) {
      addError = "Name is required.";
      return;
    }
    let config: OpencodeMcpConfig;
    if (addMode === "local") {
      const command = addCommand.trim().split(/\s+/).filter((part) => part.length > 0);
      if (command.length === 0) {
        addError = "Command is required for a local (stdio) server.";
        return;
      }
      const localConfig: OpencodeMcpConfig = { type: "local", command };
      if (addCwd.trim().length > 0) {
        localConfig.cwd = addCwd.trim();
      }
      const env = parseKeyValueLines(addEnv, "=");
      if (Object.keys(env).length > 0) {
        localConfig.environment = env;
      }
      config = localConfig;
    } else {
      const url = addUrl.trim();
      if (url.length === 0) {
        addError = "URL is required for a remote server.";
        return;
      }
      const remoteConfig: OpencodeMcpConfig = { type: "remote", url };
      const headers = parseKeyValueLines(addHeaders, ":");
      if (Object.keys(headers).length > 0) {
        remoteConfig.headers = headers;
      }
      config = remoteConfig;
    }

    addingServer = true;
    addError = null;
    const statuses = await addMcpServer(workspaceRoot, name, config);
    addingServer = false;
    if (statuses.length === 0) {
      addError = "Failed to add MCP server.";
      return;
    }
    adding = false;
    resetAddForm();
  }

  async function handleConnect(name: string): Promise<void> {
    if (workspaceRoot) {
      await connectMcpServer(workspaceRoot, name);
    }
  }

  async function handleDisconnect(name: string): Promise<void> {
    if (workspaceRoot) {
      await disconnectMcpServer(workspaceRoot, name);
    }
  }

  function handleReload(): void {
    if (workspaceRoot) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
  }

  function statusLabel(status: OpencodeMcpStatusEntry["status"]): string {
    switch (status) {
      case "connected":
        return "Connected";
      case "disabled":
        return "Disabled";
      case "failed":
        return "Failed";
      case "needs_auth":
        return "Needs auth";
      case "needs_client_registration":
        return "Needs registration";
      default:
        return status;
    }
  }
</script>

{#if !available}
  <section class="settings-section">
    <h3>MCP servers</h3>
    <p class="settings-section-note">
      Open a workspace folder with OpenCode enabled to manage MCP servers.
    </p>
  </section>
{:else}
  <section class="settings-section">
    <h3>MCP servers</h3>
    <p class="settings-section-note">
      Add local (stdio) or remote (HTTP/SSE) Model Context Protocol servers. Tools they contribute
      become available to workspace agents.
    </p>
    {#if store?.status === "loading"}
      <p class="settings-section-note">Loading MCP servers…</p>
    {:else if store?.status === "error"}
      <p class="settings-section-note mcp-error">
        {store.lastErrorMessage ?? "Failed to load MCP servers."}
      </p>
      <button type="button" class="settings-action" onclick={handleReload}>Retry</button>
    {:else}
      {#if (store?.mcpServers ?? []).length === 0}
        <p class="settings-section-note">No MCP servers configured.</p>
      {:else}
        <div class="connection-list">
          {#each store?.mcpServers ?? [] as server (server.name)}
            <div class="connection-row mcp-row">
              <div class="mcp-row-main">
                <span class="mcp-row-name">{server.name}</span>
                <span
                  class="mcp-badge"
                  class:mcp-badge-connected={server.status === "connected"}
                  class:mcp-badge-off={server.status === "disabled"}
                  class:mcp-badge-warn={server.status === "failed" || server.status === "needs_auth" || server.status === "needs_client_registration"}
                >
                  {statusLabel(server.status)}
                </span>
                {#if server.error}<span class="mcp-row-error">{server.error}</span>{/if}
              </div>
              <div class="mcp-row-actions">
                {#if server.status === "connected"}
                  <button type="button" class="settings-action" onclick={() => handleDisconnect(server.name)}>
                    Disconnect
                  </button>
                {:else if server.status !== "disabled"}
                  <button type="button" class="settings-action" onclick={() => handleConnect(server.name)}>
                    Connect
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if adding}
        <div class="settings-subsection mcp-add-form">
          <h4>Add {addMode === "local" ? "local (stdio)" : "remote (HTTP/SSE)"} server</h4>
          <label class="settings-field">
            <span>Name</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="my-mcp"
              value={addName}
              oninput={(event) => (addName = (event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          {#if addMode === "local"}
            <label class="settings-field">
              <span>Command + args (space separated)</span>
              <input
                type="text"
                spellcheck="false"
                placeholder="npx -y @modelcontextprotocol/server-filesystem ."
                value={addCommand}
                oninput={(event) => (addCommand = (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="settings-field">
              <span>Working directory (optional)</span>
              <input
                type="text"
                spellcheck="false"
                value={addCwd}
                oninput={(event) => (addCwd = (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="settings-field">
              <span>Environment (KEY=VALUE per line)</span>
              <textarea
                rows="2"
                spellcheck="false"
                value={addEnv}
                oninput={(event) => (addEnv = (event.currentTarget as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          {:else}
            <label class="settings-field">
              <span>URL</span>
              <input
                type="url"
                spellcheck="false"
                placeholder="https://mcp.example.com/sse"
                value={addUrl}
                oninput={(event) => (addUrl = (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="settings-field">
              <span>Headers (KEY: VALUE per line)</span>
              <textarea
                rows="2"
                spellcheck="false"
                value={addHeaders}
                oninput={(event) => (addHeaders = (event.currentTarget as HTMLTextAreaElement).value)}
              ></textarea>
            </label>
          {/if}
          {#if addError}<p class="settings-section-note mcp-error">{addError}</p>{/if}
          <div class="mcp-add-actions">
            <button type="button" class="settings-action" onclick={cancelAdd} disabled={addingServer}>Cancel</button>
            <button type="button" class="settings-action" onclick={handleAdd} disabled={addingServer}>
              {addingServer ? "Adding…" : "Add server"}
            </button>
          </div>
        </div>
      {:else}
        <div class="mcp-add-buttons">
          <button type="button" class="settings-action" onclick={() => startAdd("local")}>Add local server</button>
          <button type="button" class="settings-action" onclick={() => startAdd("remote")}>Add remote server</button>
        </div>
      {/if}
      <button type="button" class="settings-action" onclick={handleReload}>Refresh</button>
    {/if}
  </section>
{/if}

<style>
  .mcp-row {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
  }

  .mcp-row-main {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .mcp-row-name {
    font-weight: 600;
  }

  .mcp-row-error {
    color: var(--color-text-danger);
    font-size: 0.75rem;
  }

  .mcp-row-actions {
    display: flex;
    gap: var(--space-3);
  }

  .mcp-badge {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
  }

  .mcp-badge-connected {
    color: var(--color-text-success);
    border-color: var(--color-text-success);
  }

  .mcp-badge-off {
    color: var(--color-text-secondary);
  }

  .mcp-badge-warn {
    color: var(--color-text-warning);
    border-color: var(--color-text-warning);
  }

  .mcp-add-form {
    margin-top: var(--space-8);
    padding-top: var(--space-8);
    border-top: 1px solid var(--color-border-subtle);
  }

  .mcp-add-actions,
  .mcp-add-buttons {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .mcp-error {
    color: var(--color-text-danger);
  }
</style>
