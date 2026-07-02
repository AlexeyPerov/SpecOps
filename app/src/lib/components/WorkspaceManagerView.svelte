<script lang="ts">
  import type { ContextId, WorkspaceEntry } from "../domain/contracts";

  /**
   * Workspace Manager — a chrome-less editor-pane view tab (kind
   * "workspace-manager"). Lists every workspace in the current window session
   * (name + path), lets the user switch to one by clicking a row, open
   * per-workspace settings, add a single workspace, or bulk-add the immediate
   * subfolders of a parent directory.
   *
   * The list source is the same `contexts.workspaces` the activity rail uses
   * (decision 1). Hidden-from-rail workspaces (decision 3) are still listed
   * here with a subtle hint.
   */
  let {
    workspaces = [],
    activeContextId = "notepad",
    hiddenRootPaths = new Set<string>(),
    onAddWorkspace = () => {},
    onAddMultiple = () => {},
    onSelectWorkspace = (_workspaceId: ContextId) => {},
    onOpenWorkspaceSettings = (_workspaceId: ContextId) => {},
  }: {
    workspaces?: WorkspaceEntry[];
    activeContextId?: ContextId;
    /** Normalized root paths currently hidden from the activity rail. */
    hiddenRootPaths?: Set<string>;
    onAddWorkspace?: () => void;
    onAddMultiple?: () => void;
    onSelectWorkspace?: (workspaceId: ContextId) => void;
    onOpenWorkspaceSettings?: (workspaceId: ContextId) => void;
  } = $props();

  function workspaceName(workspace: WorkspaceEntry): string {
    const normalized = workspace.rootPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || workspace.rootPath;
  }

  function isHidden(workspace: WorkspaceEntry): boolean {
    return hiddenRootPaths.has(workspace.rootPath);
  }
</script>

<div class="workspace-manager-view" role="tabpanel" aria-label="Workspace Manager">
  <header class="workspace-manager-header">
    <div class="workspace-manager-heading">
      <h2>Workspaces</h2>
      <p class="workspace-manager-subtitle">
        All workspaces open in this window. Click a row to switch.
      </p>
    </div>
    <div class="workspace-manager-actions">
      <button type="button" class="wm-button" onclick={onAddWorkspace}>Add workspace</button>
      <button type="button" class="wm-button" onclick={onAddMultiple}>Add multiple…</button>
    </div>
  </header>

  {#if workspaces.length === 0}
    <div class="workspace-manager-empty">
      <p>No workspaces open in this window yet.</p>
      <div class="workspace-manager-actions">
        <button type="button" class="wm-button" onclick={onAddWorkspace}>Add workspace</button>
        <button type="button" class="wm-button" onclick={onAddMultiple}>Add multiple…</button>
      </div>
    </div>
  {:else}
    <table class="workspace-manager-table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Path</th>
          <th scope="col" class="wm-action-col"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each workspaces as workspace (workspace.id)}
          {@const hidden = isHidden(workspace)}
          <tr
            class="wm-row"
            class:wm-row-active={activeContextId === workspace.id}
            class:wm-row-hidden={hidden}
            onclick={() => onSelectWorkspace(workspace.id)}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectWorkspace(workspace.id);
              }
            }}
            tabindex="0"
          >
            <td class="wm-name">{workspaceName(workspace)}</td>
            <td class="wm-path">
              <span class="wm-path-text" title={workspace.rootPath}>{workspace.rootPath}</span>
              {#if hidden}
                <span class="wm-hidden-hint">(hidden from sidebar)</span>
              {/if}
            </td>
            <td class="wm-action-col">
              <button
                type="button"
                class="wm-button wm-button-secondary"
                title="Workspace settings"
                onclick={(event) => {
                  event.stopPropagation();
                  onOpenWorkspaceSettings(workspace.id);
                }}
              >
                ⚙ Settings
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .workspace-manager-view {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-10) var(--space-12) var(--space-12);
    background: var(--color-surface-1);
  }

  .workspace-manager-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-6);
    margin-bottom: var(--space-8);
  }

  .workspace-manager-heading h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .workspace-manager-subtitle {
    margin: var(--space-1) 0 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .workspace-manager-actions {
    display: flex;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  .wm-button {
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--easing-standard);
  }

  .wm-button:hover {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .wm-button-secondary {
    padding: var(--space-1) var(--space-4);
    font-size: 0.8125rem;
  }

  .workspace-manager-empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-6);
    padding: var(--space-12) 0;
    color: var(--color-text-secondary);
  }

  .workspace-manager-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .workspace-manager-table th {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .wm-row {
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--easing-standard);
  }

  .wm-row:hover {
    background: var(--color-hover);
  }

  .wm-row:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  .wm-row-active {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }

  .wm-row-hidden {
    opacity: 0.7;
  }

  .wm-row td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    vertical-align: middle;
  }

  .wm-name {
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
  }

  .wm-path {
    color: var(--color-text-secondary);
  }

  .wm-path-text {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wm-hidden-hint {
    margin-left: var(--space-2);
    font-size: 0.75rem;
    font-style: italic;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .wm-action-col {
    text-align: right;
    white-space: nowrap;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
