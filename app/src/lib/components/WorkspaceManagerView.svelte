<script lang="ts">
  import { untrack } from "svelte";
  import type { ContextId, WorkspaceEntry } from "../domain/contracts";
  import {
    loadWorkspaceGitColumnCell,
    refreshWorkspaceGitColumnCells,
    subscribeWorkspaceGitColumnAutoRefresh,
    type WorkspaceGitColumnCell,
  } from "../git/workspaceManagerGitColumn";
  import { shouldLoadWorkspaceManagerGitColumn } from "../git/gitIntegrationGating";
  import { emptySet } from "../collections/emptyCollections";
  import EmptyState from "./EmptyState.svelte";

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
    hiddenRootPaths = emptySet<string>(),
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

  let gitCellsByPath = $state<Map<string, WorkspaceGitColumnCell>>(new Map());
  let gitRefreshBusy = $state(false);
  const showGitColumn = $derived(shouldLoadWorkspaceManagerGitColumn());

  function workspaceName(workspace: WorkspaceEntry): string {
    const normalized = workspace.rootPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || workspace.rootPath;
  }

  function isHidden(workspace: WorkspaceEntry): boolean {
    return hiddenRootPaths.has(workspace.rootPath);
  }

  function gitCellForWorkspace(workspace: WorkspaceEntry): WorkspaceGitColumnCell {
    return gitCellsByPath.get(workspace.rootPath) ?? { status: "loading" };
  }

  function gitCellDisplayText(cell: WorkspaceGitColumnCell): string {
    if (cell.status === "ready") {
      return cell.displayText;
    }
    if (cell.status === "loading") {
      return "…";
    }
    return cell.text;
  }

  function gitCellTitle(cell: WorkspaceGitColumnCell): string {
    if (cell.status === "ready") {
      const summary = cell.summary;
      const branch = summary.isDetached ? `Detached HEAD at ${summary.branchName}` : summary.branchName;
      const tracking = summary.aheadBehindError
        ? `Could not load tracking: ${summary.aheadBehindError}`
        : summary.aheadBehind && (summary.aheadBehind.ahead > 0 || summary.aheadBehind.behind > 0)
          ? `${summary.aheadBehind.ahead} ahead, ${summary.aheadBehind.behind} behind`
          : summary.aheadBehind
            ? "Up to date with upstream"
            : "No upstream";
      const tree = summary.isDirty ? "Working tree has uncommitted changes" : "Working tree clean";
      return `${branch} · ${tracking} · ${tree}`;
    }
    if (cell.status === "neutral") {
      return "Not a git repository";
    }
    if (cell.status === "error") {
      return cell.message;
    }
    return "Loading git status…";
  }

  async function loadGitCellsForWorkspaces(
    rows: WorkspaceEntry[],
    options?: { force?: boolean },
  ): Promise<void> {
    if (!showGitColumn) {
      gitCellsByPath = new Map();
      return;
    }
    if (rows.length === 0) {
      gitCellsByPath = new Map();
      return;
    }

    const pending = new Map(untrack(() => gitCellsByPath));
    for (const workspace of rows) {
      if (!options?.force && pending.has(workspace.rootPath)) {
        continue;
      }
      pending.set(workspace.rootPath, { status: "loading" });
    }
    gitCellsByPath = pending;

    const results = options?.force
      ? await refreshWorkspaceGitColumnCells(rows.map((workspace) => workspace.rootPath))
      : new Map(
          await Promise.all(
            rows.map(async (workspace) => {
              const cell = await loadWorkspaceGitColumnCell(workspace.rootPath);
              return [workspace.rootPath, cell] as const;
            }),
          ),
        );

    const next = new Map(untrack(() => gitCellsByPath));
    for (const [path, cell] of results) {
      next.set(path, cell);
    }
    gitCellsByPath = next;
  }

  async function handleRefreshGitColumn(): Promise<void> {
    if (gitRefreshBusy || workspaces.length === 0) {
      return;
    }

    gitRefreshBusy = true;
    try {
      await loadGitCellsForWorkspaces(workspaces, { force: true });
    } finally {
      gitRefreshBusy = false;
    }
  }

  async function refreshGitColumnCell(workspaceRootPath: string): Promise<void> {
    gitCellsByPath = new Map(gitCellsByPath).set(workspaceRootPath, { status: "loading" });
    const cell = await loadWorkspaceGitColumnCell(workspaceRootPath, { force: true });
    gitCellsByPath = new Map(gitCellsByPath).set(workspaceRootPath, cell);
  }

  $effect(() => {
    const paths = new Set(workspaces.map((workspace) => workspace.rootPath));
    return subscribeWorkspaceGitColumnAutoRefresh((workspaceRootPath) => {
      if (!paths.has(workspaceRootPath)) {
        return;
      }
      void refreshGitColumnCell(workspaceRootPath);
    });
  });

  $effect(() => {
    const rows = workspaces;
    void loadGitCellsForWorkspaces(rows);
  });
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
      {#if showGitColumn}
      <button
        type="button"
        class="btn btn-secondary"
        disabled={gitRefreshBusy || workspaces.length === 0}
        title="Refresh git status column"
        onclick={handleRefreshGitColumn}
      >
        {gitRefreshBusy ? "Refreshing…" : "Refresh git"}
      </button>
      {/if}
      <button type="button" class="btn btn-secondary" onclick={onAddWorkspace}>Add workspace</button>
      <button type="button" class="btn btn-secondary" onclick={onAddMultiple}>Add multiple…</button>
    </div>
  </header>

  {#if workspaces.length === 0}
    <EmptyState
      class="workspace-manager-empty"
      title="No workspaces open"
      description="No workspaces open in this window yet."
    >
      {#snippet actions()}
        <div class="workspace-manager-actions">
          <button type="button" class="btn btn-secondary" onclick={onAddWorkspace}>Add workspace</button>
          <button type="button" class="btn btn-secondary" onclick={onAddMultiple}>Add multiple…</button>
        </div>
      {/snippet}
    </EmptyState>
  {:else}
    <table class="workspace-manager-table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Path</th>
          {#if showGitColumn}
          <th scope="col">Git</th>
          {/if}
          <th scope="col" class="wm-action-col"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each workspaces as workspace (workspace.id)}
          {@const hidden = isHidden(workspace)}
          {@const gitCell = gitCellForWorkspace(workspace)}
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
            {#if showGitColumn}
            <td class="wm-git">
              <span
                class="wm-git-text"
                class:wm-git-dirty={gitCell.status === "ready" && gitCell.summary.isDirty}
                class:wm-git-clean={gitCell.status === "ready" && !gitCell.summary.isDirty}
                title={gitCellTitle(gitCell)}
              >
                {gitCellDisplayText(gitCell)}
              </span>
            </td>
            {/if}
            <td class="wm-action-col">
              <button
                type="button"
                class="btn btn-secondary btn-compact"
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
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /*
   * M2-2 — workspace-manager empty uses the shared EmptyState primitive. The
   * class is forwarded to EmptyState's root, so these overrides target it via
   * :global to escape Svelte's scoped-CSS boundary. The centered variant
   * fills the pane; here we keep the content left-aligned and reset EmptyState's
   * centered padding so it matches the view's own vertical rhythm.
   */
  :global(.workspace-manager-empty) {
    align-items: flex-start;
    text-align: left;
    padding: var(--space-12) 0;
    max-width: none;
    margin: 0;
  }

  :global(.workspace-manager-empty .workspace-manager-actions) {
    margin-top: var(--space-2);
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

  .wm-git {
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .wm-git-text {
    display: inline-block;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
  }

  .wm-git-dirty {
    color: var(--color-text);
  }

  .wm-git-clean {
    color: var(--color-text-secondary);
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
