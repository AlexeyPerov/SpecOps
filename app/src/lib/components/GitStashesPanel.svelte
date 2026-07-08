<script lang="ts">
  import { message } from "@tauri-apps/plugin-dialog";
  import { reportGitError } from "../git/gitErrorUi";
  import {
    applyStash,
    createStash,
    dropStash,
    GitStashApplyConflictError,
    GitStashNothingToSaveError,
    isWorkingTreeDirty,
    queryStashes,
    type GitStashSummary,
  } from "../git/gitService";
  import type { VersionControlMutationScope } from "../git/versionControlRefresh";
  import { promptEntryName } from "../services/entryNamePrompt";
  import { promptLocalChangesStashApply } from "../services/localChangesStashApplyPrompt";
  import { promptStashDrop } from "../services/stashDropPrompt";
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
  let stashes = $state<GitStashSummary[]>([]);
  let loadError = $state<string | null>(null);
  let selectedRef = $state<string | null>(null);
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);

  const selectedSummary = $derived(stashes.find((stash) => stash.ref === selectedRef) ?? null);
  const canApply = $derived(selectedSummary !== null && !actionBusy && !readOnly);
  const canDrop = $derived(selectedSummary !== null && !actionBusy && !readOnly);
  const canCreate = $derived(!actionBusy && !readOnly);

  function formatStashDate(createdAt: number): string {
    return new Date(createdAt * 1000).toLocaleString();
  }

  function stashSummaryLine(stash: GitStashSummary): string {
    const firstLine = stash.message.split("\n")[0]?.trim() ?? "";
    return firstLine || stash.ref;
  }

  async function loadStashes(root: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    stashes = [];
    selectedRef = null;

    try {
      const rows = await queryStashes(root);
      if (signal?.aborted) {
        return;
      }
      stashes = rows;
      selectedRef = rows[0]?.ref ?? null;
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
    void loadStashes(root, controller.signal);
    return () => {
      controller.abort();
    };
  });

  function selectStash(ref: string): void {
    selectedRef = ref;
  }

  function handleRowKeydown(event: KeyboardEvent, ref: string): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectStash(ref);
    }
  }

  async function handleCreateStash(): Promise<void> {
    if (actionBusy || readOnly) {
      return;
    }

    const stashMessage = await promptEntryName({
      title: "Create stash",
      defaultValue: "WIP",
      confirmLabel: "Stash",
    });
    if (!stashMessage) {
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

      await createStash(repoRoot, stashMessage);
      await loadStashes(repoRoot);
      await onMutation("stash");
      notify("Working-tree changes stashed.");
    } catch (error) {
      if (error instanceof GitStashNothingToSaveError) {
        actionError = "No local changes to save.";
      } else {
        actionError = reportGitError(error, { operation: "Create stash", repoRoot, notify });
      }
    } finally {
      actionBusy = false;
    }
  }

  async function handleApplyStash(): Promise<void> {
    if (!selectedSummary || actionBusy || readOnly) {
      return;
    }

    actionBusy = true;
    actionError = null;

    const stashRef = selectedSummary.ref;

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
        const choice = await promptLocalChangesStashApply({ stashRef });
        if (!choice || choice.type === "cancel") {
          return;
        }
        if (choice.type === "block") {
          await message(
            "Apply is blocked while the working tree has uncommitted changes. Commit, stash, or discard your changes first.",
            {
              title: "Working tree not clean",
              kind: "warning",
            },
          );
          return;
        }

        try {
          await createStash(repoRoot, `WIP before applying ${stashRef}`);
        } catch (error) {
          actionError = reportGitError(error, { operation: "Stash", repoRoot, notify });
          return;
        }
      }

      try {
        await applyStash(repoRoot, stashRef);
      } catch (error) {
        if (error instanceof GitStashApplyConflictError) {
          actionError = reportGitError(error, { operation: "Apply stash", repoRoot, notify });
          notify(
            `Stash ${stashRef} conflicted on apply. Resolve conflicts in the working tree, then retry if needed.`,
          );
        } else {
          actionError = reportGitError(error, { operation: "Apply stash", repoRoot, notify });
        }
        await onMutation("stash");
        return;
      }

      await loadStashes(repoRoot);
      await onMutation("stash");
      notify(`Applied ${stashRef}.`);
    } catch (error) {
      actionError = reportGitError(error, { operation: "Apply stash", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleDropStash(): Promise<void> {
    if (!selectedSummary || actionBusy || readOnly) {
      return;
    }

    const stashRef = selectedSummary.ref;
    const result = await promptStashDrop({
      stashRef,
      message: stashSummaryLine(selectedSummary),
    });
    if (!result) {
      return;
    }

    actionBusy = true;
    actionError = null;

    try {
      await dropStash(repoRoot, stashRef);
      await loadStashes(repoRoot);
      await onMutation("stash");
      notify(`Dropped ${stashRef}.`);
    } catch (error) {
      actionError = reportGitError(error, { operation: "Drop stash", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }
</script>

<div class="git-stashes-panel" aria-label="Stashes">
  <div class="git-stashes-toolbar">
    <button
      type="button"
      class="git-stashes-action"
      disabled={!canCreate}
      title={readOnly ? "Stash operations are unavailable for bare repositories" : "Stash current changes"}
      onclick={handleCreateStash}
    >
      {actionBusy ? "Working…" : "Create stash"}
    </button>
    <button
      type="button"
      class="git-stashes-action"
      disabled={!canApply}
      title={selectedSummary ? `Apply ${selectedSummary.ref}` : "Select a stash to apply"}
      onclick={handleApplyStash}
    >
      Apply stash
    </button>
    <button
      type="button"
      class="git-stashes-action"
      disabled={!canDrop}
      title={selectedSummary ? `Drop ${selectedSummary.ref}` : "Select a stash to drop"}
      onclick={handleDropStash}
    >
      Drop stash
    </button>
  </div>

  {#if readOnly}
    <p class="git-stashes-readonly-hint" role="status">
      Bare repository — stash list is read-only; apply, drop, and create are disabled.
    </p>
  {/if}

  {#if actionError}
    <p class="git-stashes-action-error" role="alert">{actionError}</p>
  {/if}

  {#if loadStatus === "loading"}
    <div class="git-stashes-state" role="status" aria-live="polite">
      <p class="git-stashes-state-title">Loading stashes…</p>
    </div>
  {:else if loadStatus === "error"}
    <div class="git-stashes-state" role="alert">
      <p class="git-stashes-state-title">Could not load stashes</p>
      {#if loadError}
        <p class="git-stashes-state-detail">{loadError}</p>
      {/if}
    </div>
  {:else if stashes.length === 0}
    <div class="git-stashes-state" role="status">
      <p class="git-stashes-state-title">No stashes</p>
      <p class="git-stashes-state-detail">Create a stash from uncommitted changes, or use Stash and continue during checkout.</p>
    </div>
  {:else}
    <ul class="git-stashes-list" role="listbox" aria-label="Stashes">
      {#each stashes as stash (stash.ref)}
        <li class="git-stashes-item">
          <button
            type="button"
            class="git-stashes-row"
            class:git-stashes-row-selected={selectedRef === stash.ref}
            role="option"
            aria-selected={selectedRef === stash.ref}
            onclick={() => selectStash(stash.ref)}
            onkeydown={(event) => handleRowKeydown(event, stash.ref)}
          >
            <span class="git-stashes-ref" title={stash.ref}>{stash.ref}</span>
            <span class="git-stashes-meta">
              <span class="git-stashes-date" title={formatStashDate(stash.createdAt)}>
                {formatStashDate(stash.createdAt)}
              </span>
              <span class="git-stashes-sha" title={stash.sha}>{stash.sha.slice(0, 7)}</span>
            </span>
            <span class="git-stashes-message" title={stash.message}>{stashSummaryLine(stash)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .git-stashes-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .git-stashes-toolbar {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-12);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .git-stashes-action {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .git-stashes-action:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .git-stashes-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .git-stashes-readonly-hint {
    margin: 0;
    padding: 0 var(--space-12);
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .git-stashes-action-error {
    margin: 0;
    padding: 0 var(--space-12);
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .git-stashes-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-10) var(--space-12);
    color: var(--color-text-secondary);
  }

  .git-stashes-state-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-stashes-state-detail {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .git-stashes-list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: var(--space-2) 0;
    list-style: none;
    overflow-y: auto;
  }

  .git-stashes-item {
    margin: 0;
  }

  .git-stashes-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-4) var(--space-12);
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .git-stashes-row:hover {
    background: var(--color-surface-2);
  }

  .git-stashes-row:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .git-stashes-row-selected {
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
    border-left-color: var(--color-accent);
  }

  .git-stashes-ref {
    font-size: 0.875rem;
    font-weight: 600;
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .git-stashes-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .git-stashes-date {
    color: var(--color-text-muted);
  }

  .git-stashes-sha {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-muted);
  }

  .git-stashes-message {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
</style>
