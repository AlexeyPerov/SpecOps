<script lang="ts">
  import { message } from "@tauri-apps/plugin-dialog";
  import { reportGitError, formatGitErrorPrimaryMessage } from "../git/gitErrorUi";
  import {
    applyStash,
    checkoutBranch,
    createBranch,
    createStash,
    GitRefValidationError,
    GitStashApplyConflictError,
    isWorkingTreeDirty,
    queryBranches,
  } from "../git/gitService";
  import { validateGitRefName } from "../git/gitRefName";
  import type { BranchSummary } from "../git/types";
  import type { VersionControlMutationScope } from "../git/versionControlRefresh";
  import { promptEntryName } from "../services/entryNamePrompt";
  import { promptLocalChangesCheckout } from "../services/localChangesCheckoutPrompt";
  import type { SaveDocumentDeps } from "../services/documentSave";
  import { prepareWorkspaceForGitOperation } from "../services/preGitOperationGuard";
  import { shouldRunAutosaveBeforeGitOperations } from "../git/gitIntegrationGating";

  interface Props {
    repoRoot: string;
    workspaceRootPath: string;
    preGitSaveDeps?: SaveDocumentDeps | null;
    readOnly?: boolean;
    refreshToken?: number;
    onMutation?: (scope?: VersionControlMutationScope) => void | Promise<void>;
    notify?: (message: string) => void;
  }

  let {
    repoRoot,
    workspaceRootPath,
    preGitSaveDeps = null,
    readOnly = false,
    refreshToken = 0,
    onMutation = () => {},
    notify = () => {},
  }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let branches = $state<BranchSummary[]>([]);
  let loadError = $state<string | null>(null);
  let selectedBranch = $state<string | null>(null);
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);

  const selectedSummary = $derived(branches.find((branch) => branch.name === selectedBranch) ?? null);
  const canCheckout = $derived(
    selectedSummary !== null && !selectedSummary.isCurrent && !actionBusy && !readOnly,
  );

  async function loadBranches(root: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    branches = [];
    selectedBranch = null;

    try {
      const rows = await queryBranches(root);
      if (signal?.aborted) {
        return;
      }
      branches = rows;
      const current = rows.find((branch) => branch.isCurrent);
      selectedBranch = current?.name ?? rows[0]?.name ?? null;
      loadStatus = "ready";
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      loadStatus = "error";
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    const root = repoRoot;
    const token = refreshToken;
    void token;
    const controller = new AbortController();
    void loadBranches(root, controller.signal);
    return () => {
      controller.abort();
    };
  });

  function selectBranch(name: string): void {
    selectedBranch = name;
  }

  function handleRowKeydown(event: KeyboardEvent, name: string): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectBranch(name);
    }
  }

  async function handleCheckout(): Promise<void> {
    if (!selectedSummary || selectedSummary.isCurrent || actionBusy) {
      return;
    }

    actionBusy = true;
    actionError = null;

    const branchName = selectedSummary.name;
    let stashedRef: string | null = null;

    try {
      const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
        enabled: shouldRunAutosaveBeforeGitOperations(),
        deps: preGitSaveDeps,
      });
      if (!canProceed) {
        return;
      }

      const dirty = await isWorkingTreeDirty(repoRoot);
      if (dirty) {
        const choice = await promptLocalChangesCheckout({ branchName });
        if (!choice || choice.type === "cancel") {
          return;
        }
        if (choice.type === "block") {
          await message(
            "Checkout is blocked while the working tree has uncommitted changes. Commit, stash, or discard your changes first.",
            {
              title: "Working tree not clean",
              kind: "warning",
            },
          );
          return;
        }

        try {
          await createStash(repoRoot, `WIP before checkout to ${branchName}`);
          stashedRef = "stash@{0}";
        } catch (error) {
          actionError = reportGitError(error, { operation: "Stash", repoRoot, notify });
          return;
        }
      }

      try {
        await checkoutBranch(repoRoot, branchName);
      } catch (error) {
        actionError = reportGitError(error, { operation: "Checkout", repoRoot, notify });
        if (stashedRef) {
          notify(
            "Checkout failed. Your changes were stashed — apply the latest stash to restore them.",
          );
        }
        return;
      }

      if (stashedRef) {
        try {
          await applyStash(repoRoot, stashedRef, true);
        } catch (error) {
          const detail = formatGitErrorPrimaryMessage(error);
          if (error instanceof GitStashApplyConflictError) {
            notify(
              `Checked out ${branchName}, but stashed changes conflicted on apply. Resolve conflicts, then apply ${stashedRef} manually.`,
            );
          } else {
            notify(
              `Checked out ${branchName}, but could not restore stashed changes: ${detail}. Apply ${stashedRef} manually if needed.`,
            );
          }
        }
      }

      await loadBranches(repoRoot);
      await onMutation("checkout");
    } catch (error) {
      actionError = reportGitError(error, { operation: "Checkout", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleCreateBranch(): Promise<void> {
    if (actionBusy || readOnly) {
      return;
    }

    const name = await promptEntryName({
      title: "Create branch",
      defaultValue: "",
      confirmLabel: "Create",
    });
    if (!name) {
      return;
    }

    const validation = validateGitRefName(name);
    if (!validation.ok) {
      actionError = validation.message;
      return;
    }

    actionBusy = true;
    actionError = null;

    try {
      const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
        enabled: shouldRunAutosaveBeforeGitOperations(),
        deps: preGitSaveDeps,
      });
      if (!canProceed) {
        return;
      }

      await createBranch(repoRoot, name);
      selectedBranch = name.trim();
      await loadBranches(repoRoot);
      await onMutation("branch");
    } catch (error) {
      if (error instanceof GitRefValidationError) {
        actionError = error.message;
      } else {
        actionError = reportGitError(error, { operation: "Create branch", repoRoot, notify });
      }
    } finally {
      actionBusy = false;
    }
  }
</script>

<div class="git-branches-panel" aria-label="Local branches">
  <div class="git-branches-toolbar">
    <button
      type="button"
      class="git-branches-action"
      disabled={!canCheckout}
      title={selectedSummary?.isCurrent ? "Already on this branch" : "Checkout selected branch"}
      onclick={handleCheckout}
    >
      {actionBusy ? "Working…" : "Checkout"}
    </button>
    <button
      type="button"
      class="git-branches-action"
      disabled={actionBusy || readOnly}
      title={readOnly ? "Branch creation is unavailable for bare repositories" : "Create a new branch"}
      onclick={handleCreateBranch}
    >
      Create branch
    </button>
  </div>

  {#if actionError}
    <p class="git-branches-action-error" role="alert">{actionError}</p>
  {/if}

  {#if loadStatus === "loading"}
    <div class="git-branches-state" role="status" aria-live="polite">
      <p class="git-branches-state-title">Loading branches…</p>
    </div>
  {:else if loadStatus === "error"}
    <div class="git-branches-state" role="alert">
      <p class="git-branches-state-title">Could not load branches</p>
      {#if loadError}
        <p class="git-branches-state-detail">{loadError}</p>
      {/if}
    </div>
  {:else if branches.length === 0}
    <div class="git-branches-state" role="status">
      <p class="git-branches-state-title">No branches</p>
      <p class="git-branches-state-detail">Create a branch to get started.</p>
    </div>
  {:else}
    <ul class="git-branches-list" role="listbox" aria-label="Local branches">
      {#each branches as branch (branch.name)}
        <li class="git-branches-item">
          <button
            type="button"
            class="git-branches-row"
            class:git-branches-row-current={branch.isCurrent}
            class:git-branches-row-selected={selectedBranch === branch.name}
            role="option"
            aria-selected={selectedBranch === branch.name}
            onclick={() => selectBranch(branch.name)}
            onkeydown={(event) => handleRowKeydown(event, branch.name)}
          >
            <span class="git-branches-name" title={branch.name}>
              {#if branch.isCurrent}
                <span class="git-branches-current-marker" aria-hidden="true">●</span>
              {/if}
              {branch.name}
            </span>
            <span class="git-branches-meta">
              <span class="git-branches-head" title={branch.head}>{branch.head}</span>
              {#if branch.upstream}
                <span class="git-branches-upstream" title={branch.upstreamTrack ?? branch.upstream}>
                  ↑ {branch.upstream}
                </span>
              {/if}
            </span>
            {#if branch.subject}
              <span class="git-branches-subject" title={branch.subject}>{branch.subject}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .git-branches-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
    max-width: 36rem;
  }

  .git-branches-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .git-branches-action {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .git-branches-action:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .git-branches-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .git-branches-action-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .git-branches-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--color-text-secondary);
  }

  .git-branches-state-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-branches-state-detail {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .git-branches-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .git-branches-item + .git-branches-item {
    border-top: 1px solid var(--color-border-subtle);
  }

  .git-branches-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-4);
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .git-branches-row:hover {
    background: var(--color-surface-2);
  }

  .git-branches-row:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .git-branches-row-selected {
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
  }

  .git-branches-row-current {
    border-left-color: var(--color-accent);
  }

  .git-branches-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .git-branches-current-marker {
    color: var(--color-accent);
    font-size: 0.625rem;
  }

  .git-branches-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .git-branches-head {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-muted);
  }

  .git-branches-upstream {
    color: var(--color-text-muted);
  }

  .git-branches-subject {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
</style>
