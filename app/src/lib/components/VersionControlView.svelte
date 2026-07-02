<script lang="ts">
  import { confirm } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { gitInstallHint } from "../git/gitInstallHints";
  import { queryAheadBehind, queryCurrentBranch } from "../git/gitService";
  import type { AheadBehindCounts, CurrentBranchInfo } from "../git/types";
  import {
    initRepositoryAtWorkspaceRoot,
    probeVersionControlContext,
    workspaceUsesParentRepository,
  } from "../git/versionControlProbe";
  import { normalizeGitOutputPath } from "../git/types";

  /**
   * Per-workspace version control view, rendered as a chrome-less editor-pane
   * view tab (kind "version-control"). Opened from the workspace context menu;
   * the active workspace root path is passed in so phase 2/3 panels can scope
   * git operations to it.
   */
  let { workspaceRootPath }: { workspaceRootPath: string | null } = $props();

  type Section = "history" | "branches" | "tags" | "changes";
  type ProbeStatus =
    | "loading"
    | "noWorkspace"
    | "gitUnavailable"
    | "notARepository"
    | "ready"
    | "error";
  type BranchHeaderStatus = "idle" | "loading" | "ready" | "error";

  const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
    { id: "history", label: "History" },
    { id: "branches", label: "Branches" },
    { id: "tags", label: "Tags" },
    { id: "changes", label: "Changes" },
  ];

  let activeSection = $state<Section>("history");
  let probeStatus = $state<ProbeStatus>("loading");
  let repoRoot = $state<string | null>(null);
  let probeError = $state<string | null>(null);
  let initBusy = $state(false);
  let initError = $state<string | null>(null);
  let branchHeaderStatus = $state<BranchHeaderStatus>("idle");
  let currentBranch = $state<CurrentBranchInfo | null>(null);
  let aheadBehind = $state<AheadBehindCounts | null>(null);
  let branchHeaderError = $state<string | null>(null);

  const workspaceName = $derived.by(() => {
    if (!workspaceRootPath) {
      return "Workspace";
    }
    const normalized = workspaceRootPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? workspaceRootPath;
  });

  const installHint = $derived(gitInstallHint());

  const usesParentRepository = $derived.by(() => {
    if (probeStatus !== "ready" || !workspaceRootPath || !repoRoot) {
      return false;
    }
    return workspaceUsesParentRepository(workspaceRootPath, repoRoot);
  });

  const placeholderCopy = $derived.by(() => {
    if (activeSection === "changes") {
      return "Coming in phase 3.";
    }
    return "Coming in phase 2.";
  });

  const branchHeaderLabel = $derived.by(() => {
    if (currentBranch?.isDetached) {
      return "HEAD";
    }
    return "Branch";
  });

  const branchDisplayName = $derived.by(() => {
    if (branchHeaderStatus === "loading") {
      return "…";
    }
    if (branchHeaderStatus === "error") {
      return "—";
    }
    if (!currentBranch) {
      return "—";
    }
    return currentBranch.name;
  });

  const branchTitle = $derived.by(() => {
    if (!currentBranch) {
      return "Current branch";
    }
    if (currentBranch.isDetached) {
      return `Detached HEAD at ${currentBranch.name}`;
    }
    if (currentBranch.upstream) {
      return `${currentBranch.name} tracks ${currentBranch.upstream}`;
    }
    return currentBranch.name;
  });

  const trackingSummary = $derived.by(() => {
    if (branchHeaderStatus !== "ready" || !currentBranch || currentBranch.isDetached) {
      return null;
    }
    if (!currentBranch.upstream) {
      return "No upstream";
    }
    if (!aheadBehind) {
      return null;
    }
    const parts: string[] = [];
    if (aheadBehind.ahead > 0) {
      parts.push(`${aheadBehind.ahead} ahead`);
    }
    if (aheadBehind.behind > 0) {
      parts.push(`${aheadBehind.behind} behind`);
    }
    if (parts.length === 0) {
      return "Up to date";
    }
    return parts.join(" · ");
  });

  function resetBranchHeader(): void {
    branchHeaderStatus = "idle";
    currentBranch = null;
    aheadBehind = null;
    branchHeaderError = null;
  }

  async function refreshBranchHeader(root: string, signal?: AbortSignal): Promise<void> {
    branchHeaderStatus = "loading";
    branchHeaderError = null;
    currentBranch = null;
    aheadBehind = null;

    try {
      const branch = await queryCurrentBranch(root);
      if (signal?.aborted) {
        return;
      }

      currentBranch = branch;
      if (!branch.isDetached && branch.upstream) {
        aheadBehind = await queryAheadBehind(root);
        if (signal?.aborted) {
          return;
        }
      }

      branchHeaderStatus = "ready";
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      branchHeaderStatus = "error";
      branchHeaderError = error instanceof Error ? error.message : String(error);
    }
  }

  async function refreshProbe(signal?: AbortSignal): Promise<void> {
    const root = workspaceRootPath;
    if (!root) {
      probeStatus = "noWorkspace";
      repoRoot = null;
      probeError = null;
      initError = null;
      resetBranchHeader();
      return;
    }

    probeStatus = "loading";
    probeError = null;
    initError = null;
    resetBranchHeader();

    try {
      const result = await probeVersionControlContext(root);
      if (signal?.aborted) {
        return;
      }

      switch (result.kind) {
        case "noWorkspace":
          probeStatus = "noWorkspace";
          repoRoot = null;
          break;
        case "gitUnavailable":
          probeStatus = "gitUnavailable";
          repoRoot = null;
          probeError = result.error;
          break;
        case "notARepository":
          probeStatus = "notARepository";
          repoRoot = null;
          break;
        case "ready":
          probeStatus = "ready";
          repoRoot = result.repoRoot;
          await refreshBranchHeader(result.repoRoot, signal);
          break;
      }
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      probeStatus = "error";
      repoRoot = null;
      probeError = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    const root = workspaceRootPath;
    const controller = new AbortController();
    void refreshProbe(controller.signal);
    return () => {
      controller.abort();
    };
  });

  function selectSection(section: Section): void {
    activeSection = section;
  }

  async function openInstallLink(event: MouseEvent): Promise<void> {
    event.preventDefault();
    await openUrl(installHint.installUrl);
  }

  async function handleInitRepository(): Promise<void> {
    if (!workspaceRootPath || initBusy || probeStatus !== "notARepository") {
      return;
    }

    const confirmed = await confirm(
      `Initialize a new git repository at "${workspaceName}"? This creates a .git folder at the workspace root.`,
      {
        title: "Init repository",
        okLabel: "Init repository",
        cancelLabel: "Cancel",
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }

    initBusy = true;
    initError = null;

    try {
      const response = await initRepositoryAtWorkspaceRoot(workspaceRootPath);
      if (response.exitCode !== 0) {
        initError = response.stderr.trim() || `git init failed with exit code ${response.exitCode}`;
        return;
      }

      await refreshProbe();
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
    } finally {
      initBusy = false;
    }
  }

  function formatRepoRoot(path: string): string {
    return normalizeGitOutputPath(path);
  }
</script>

<div
  class="version-control-view"
  role="tabpanel"
  aria-label={`Version control — ${workspaceName}`}
>
  {#if probeStatus === "loading"}
    <div class="version-control-empty" role="status" aria-live="polite">
      <p class="version-control-empty-title">Checking git repository…</p>
    </div>
  {:else if probeStatus === "noWorkspace"}
    <div class="version-control-empty" role="status">
      <p class="version-control-empty-title">No workspace selected</p>
      <p class="version-control-empty-body">
        Open or select a workspace folder to use version control.
      </p>
    </div>
  {:else if probeStatus === "gitUnavailable"}
    <div class="version-control-empty" role="status">
      <p class="version-control-empty-title">{installHint.title}</p>
      <p class="version-control-empty-body">{installHint.body}</p>
      {#if probeError}
        <p class="version-control-empty-detail">{probeError}</p>
      {/if}
      <a
        class="version-control-empty-link"
        href={installHint.installUrl}
        onclick={openInstallLink}
      >
        {installHint.installLinkLabel}
      </a>
    </div>
  {:else if probeStatus === "notARepository"}
    <div class="version-control-empty" role="status">
      <p class="version-control-empty-title">Not a git repository</p>
      <p class="version-control-empty-body">
        This workspace folder is not inside a git repository. Initialize a repository here, or open a
        folder that is already tracked by git.
      </p>
      <button
        type="button"
        class="version-control-init-button"
        disabled={initBusy}
        onclick={handleInitRepository}
      >
        {initBusy ? "Initializing…" : "Init repository"}
      </button>
      {#if initError}
        <p class="version-control-empty-error">{initError}</p>
      {/if}
    </div>
  {:else if probeStatus === "error"}
    <div class="version-control-empty" role="alert">
      <p class="version-control-empty-title">Could not check repository</p>
      <p class="version-control-empty-body">
        Version control could not probe git for this workspace.
      </p>
      {#if probeError}
        <p class="version-control-empty-error">{probeError}</p>
      {/if}
    </div>
  {:else}
    <header class="version-control-header" aria-label="Version control toolbar">
      <div class="version-control-header-status">
        <span class="version-control-branch" title={branchTitle}>
          <span class="version-control-branch-label">{branchHeaderLabel}</span>
          <span class="version-control-branch-name">{branchDisplayName}</span>
          {#if currentBranch?.isDetached}
            <span class="version-control-detached-badge">Detached</span>
          {/if}
        </span>
        {#if trackingSummary}
          <span class="version-control-tracking" title="Upstream tracking">
            {trackingSummary}
          </span>
        {/if}
        {#if branchHeaderError}
          <span class="version-control-branch-error" role="alert">{branchHeaderError}</span>
        {/if}
      </div>
      <div class="version-control-header-actions">
        <button type="button" class="version-control-action" disabled title="Fetch (phase 3)">
          Fetch
        </button>
        <button type="button" class="version-control-action" disabled title="Pull (phase 3)">
          Pull
        </button>
        <button type="button" class="version-control-action" disabled title="Push (phase 3)">
          Push
        </button>
      </div>
    </header>

    {#if usesParentRepository && repoRoot}
      <p class="version-control-scope-note" role="note">
        This workspace folder is inside the git repository at
        <span class="version-control-scope-path">{formatRepoRoot(repoRoot)}</span>. Version control
        actions apply to that repository — you do not need to initialize a new repository here.
      </p>
    {/if}

    <div class="version-control-main">
      <div
        class="version-control-sidebar"
        role="tablist"
        aria-label="Version control sections"
      >
        <p class="version-control-title">{workspaceName}</p>
        {#each SECTIONS as section (section.id)}
          <button
            type="button"
            role="tab"
            class="version-control-tab"
            class:version-control-tab-active={activeSection === section.id}
            aria-selected={activeSection === section.id}
            onclick={() => selectSection(section.id)}
          >
            {section.label}
          </button>
        {/each}
      </div>

      <div
        class="version-control-body"
        role="tabpanel"
        aria-label={SECTIONS.find((section) => section.id === activeSection)?.label ?? "Section"}
      >
        <p class="version-control-placeholder">{placeholderCopy}</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .version-control-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .version-control-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-4);
    max-width: 32rem;
    margin: 0 auto;
    padding: var(--space-12) var(--space-10);
    color: var(--color-text-secondary);
  }

  .version-control-empty-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .version-control-empty-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .version-control-empty-detail {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
  }

  .version-control-empty-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .version-control-empty-link {
    align-self: flex-start;
    font-size: 0.875rem;
    color: var(--color-accent);
    text-decoration: none;
  }

  .version-control-empty-link:hover {
    text-decoration: underline;
  }

  .version-control-init-button {
    align-self: flex-start;
    padding: var(--space-2) var(--space-5);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .version-control-init-button:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .version-control-init-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .version-control-scope-note {
    flex-shrink: 0;
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-1));
  }

  .version-control-scope-path {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text);
  }

  .version-control-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .version-control-header-status {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    flex: 1;
  }

  .version-control-branch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    font-size: 0.875rem;
  }

  .version-control-branch-label {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-branch-name {
    color: var(--color-text);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-control-detached-badge {
    flex-shrink: 0;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-text-muted) 14%, transparent);
    color: var(--color-text-secondary);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-tracking {
    flex-shrink: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .version-control-branch-error {
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-control-header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .version-control-action {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: default;
  }

  .version-control-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .version-control-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .version-control-sidebar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4) var(--space-12);
    border-right: 1px solid var(--color-border-subtle);
    overflow-y: auto;
    width: 132px;
  }

  .version-control-title {
    margin: 0 0 var(--space-4);
    padding: 0 var(--space-4);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-control-tab {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .version-control-tab:hover {
    background: var(--color-surface-2);
  }

  .version-control-tab-active {
    background: var(--color-surface-2);
    font-weight: 600;
  }

  .version-control-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-10) var(--space-12) var(--space-12);
  }

  .version-control-placeholder {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }
</style>
