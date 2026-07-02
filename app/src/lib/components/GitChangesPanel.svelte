<script lang="ts">
  import { reportGitError } from "../git/gitErrorUi";
  import {
    createCommit,
    GitCommitValidationError,
    queryWorkingTreeStatus,
    stageAll,
    stagePaths,
    unstagePaths,
  } from "../git/gitService";
  import { formatWorkingTreeStatusCode } from "../git/gitStatusFormat";
  import type { WorkingTreeFileEntry } from "../git/types";
  import type { VersionControlMutationScope } from "../git/versionControlRefresh";

  interface Props {
    repoRoot: string;
    readOnly?: boolean;
    refreshToken?: number;
    onMutation?: (scope?: VersionControlMutationScope) => void | Promise<void>;
    notify?: (message: string) => void;
  }

  let {
    repoRoot,
    readOnly = false,
    refreshToken = 0,
    onMutation = () => {},
    notify = () => {},
  }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let staged = $state<WorkingTreeFileEntry[]>([]);
  let unstaged = $state<WorkingTreeFileEntry[]>([]);
  let loadError = $state<string | null>(null);
  let selectedUnstaged = $state<Set<string>>(new Set());
  let selectedStaged = $state<Set<string>>(new Set());
  let commitMessage = $state("");
  let commitError = $state<string | null>(null);
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);

  const hasStagedChanges = $derived(staged.length > 0);
  const canCommit = $derived(
    hasStagedChanges && !actionBusy && !readOnly && commitMessage.trim().length > 0,
  );
  const isClean = $derived(loadStatus === "ready" && staged.length === 0 && unstaged.length === 0);

  async function loadWorkingTreeStatus(root: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    staged = [];
    unstaged = [];
    selectedUnstaged = new Set();
    selectedStaged = new Set();

    try {
      const status = await queryWorkingTreeStatus(root);
      if (signal?.aborted) {
        return;
      }
      staged = status.staged;
      unstaged = status.unstaged;
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
    void loadWorkingTreeStatus(root, controller.signal);
    return () => {
      controller.abort();
    };
  });

  async function refreshAfterAction(scope: VersionControlMutationScope = "stage"): Promise<void> {
    await loadWorkingTreeStatus(repoRoot);
    await onMutation(scope);
  }

  function toggleUnstaged(path: string, checked: boolean): void {
    const next = new Set(selectedUnstaged);
    if (checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    selectedUnstaged = next;
  }

  function toggleStaged(path: string, checked: boolean): void {
    const next = new Set(selectedStaged);
    if (checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    selectedStaged = next;
  }

  async function handleStageSelected(): Promise<void> {
    if (selectedUnstaged.size === 0 || actionBusy || readOnly) {
      return;
    }
    actionBusy = true;
    actionError = null;
    try {
      await stagePaths(repoRoot, [...selectedUnstaged]);
      await refreshAfterAction();
    } catch (error) {
      actionError = reportGitError(error, { operation: "Stage", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleStageAll(): Promise<void> {
    if (unstaged.length === 0 || actionBusy || readOnly) {
      return;
    }
    actionBusy = true;
    actionError = null;
    try {
      await stageAll(repoRoot);
      await refreshAfterAction();
    } catch (error) {
      actionError = reportGitError(error, { operation: "Stage all", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleUnstageSelected(): Promise<void> {
    if (selectedStaged.size === 0 || actionBusy || readOnly) {
      return;
    }
    actionBusy = true;
    actionError = null;
    try {
      await unstagePaths(repoRoot, [...selectedStaged]);
      await refreshAfterAction();
    } catch (error) {
      actionError = reportGitError(error, { operation: "Unstage", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleCommit(): Promise<void> {
    commitError = null;
    const trimmed = commitMessage.trim();
    if (!trimmed) {
      commitError = "Commit message cannot be empty.";
      return;
    }
    if (!hasStagedChanges || actionBusy || readOnly) {
      return;
    }

    actionBusy = true;
    actionError = null;
    try {
      await createCommit(repoRoot, trimmed);
      commitMessage = "";
      commitError = null;
      await refreshAfterAction("commit");
    } catch (error) {
      if (error instanceof GitCommitValidationError) {
        commitError = error.message;
      } else {
        actionError = reportGitError(error, { operation: "Commit", repoRoot, notify });
      }
    } finally {
      actionBusy = false;
    }
  }
</script>

<div class="git-changes-panel" aria-label="Working tree changes">
  {#if loadStatus === "loading"}
    <div class="git-changes-state" role="status" aria-live="polite">
      <p class="git-changes-state-title">Loading changes…</p>
    </div>
  {:else if loadStatus === "error"}
    <div class="git-changes-state" role="alert">
      <p class="git-changes-state-title">Could not load working tree status</p>
      {#if loadError}
        <p class="git-changes-state-detail">{loadError}</p>
      {/if}
    </div>
  {:else if isClean}
    <div class="git-changes-state" role="status">
      <p class="git-changes-state-title">Working tree clean</p>
      <p class="git-changes-state-detail">No staged or unstaged changes.</p>
    </div>
  {:else}
    {#if actionError}
      <p class="git-changes-action-error" role="alert">{actionError}</p>
    {/if}

    <section class="git-changes-section" aria-labelledby="git-changes-unstaged-heading">
      <div class="git-changes-section-header">
        <h3 id="git-changes-unstaged-heading" class="git-changes-section-title">Unstaged</h3>
        <div class="git-changes-section-actions">
          <button
            type="button"
            class="git-changes-action-button"
            disabled={selectedUnstaged.size === 0 || actionBusy || readOnly}
            onclick={handleStageSelected}
          >
            Stage selected
          </button>
          <button
            type="button"
            class="git-changes-action-button"
            disabled={unstaged.length === 0 || actionBusy || readOnly}
            onclick={handleStageAll}
          >
            Stage all
          </button>
        </div>
      </div>
      {#if unstaged.length === 0}
        <p class="git-changes-empty">No unstaged changes.</p>
      {:else}
        <ul class="git-changes-list" role="list">
          {#each unstaged as entry (entry.path)}
            <li class="git-changes-item">
              <label class="git-changes-row">
                <input
                  type="checkbox"
                  checked={selectedUnstaged.has(entry.path)}
                  disabled={actionBusy || readOnly}
                  onchange={(event) =>
                    toggleUnstaged(entry.path, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span class="git-changes-status" title={formatWorkingTreeStatusCode(entry.statusCode)}>
                  {entry.statusCode.trim() || "?"}
                </span>
                <span class="git-changes-path" title={entry.path}>{entry.path}</span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="git-changes-section" aria-labelledby="git-changes-staged-heading">
      <div class="git-changes-section-header">
        <h3 id="git-changes-staged-heading" class="git-changes-section-title">Staged</h3>
        <div class="git-changes-section-actions">
          <button
            type="button"
            class="git-changes-action-button"
            disabled={selectedStaged.size === 0 || actionBusy || readOnly}
            onclick={handleUnstageSelected}
          >
            Unstage selected
          </button>
        </div>
      </div>
      {#if staged.length === 0}
        <p class="git-changes-empty">No staged changes.</p>
      {:else}
        <ul class="git-changes-list" role="list">
          {#each staged as entry (entry.path)}
            <li class="git-changes-item">
              <label class="git-changes-row">
                <input
                  type="checkbox"
                  checked={selectedStaged.has(entry.path)}
                  disabled={actionBusy || readOnly}
                  onchange={(event) =>
                    toggleStaged(entry.path, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span class="git-changes-status" title={formatWorkingTreeStatusCode(entry.statusCode)}>
                  {entry.statusCode.trim() || "?"}
                </span>
                <span class="git-changes-path" title={entry.path}>{entry.path}</span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="git-changes-commit" aria-labelledby="git-changes-commit-heading">
      <h3 id="git-changes-commit-heading" class="git-changes-section-title">Commit</h3>
      <label class="git-changes-commit-label" for="git-changes-message">Message</label>
      <textarea
        id="git-changes-message"
        class="git-changes-message"
        class:git-changes-message-invalid={commitError !== null}
        bind:value={commitMessage}
        disabled={actionBusy || readOnly}
        rows={4}
        placeholder="Describe your changes…"
        aria-invalid={commitError !== null}
        aria-describedby={commitError ? "git-changes-commit-error" : undefined}
      ></textarea>
      {#if commitError}
        <p id="git-changes-commit-error" class="git-changes-commit-error" role="alert">
          {commitError}
        </p>
      {/if}
      <button
        type="button"
        class="git-changes-commit-button"
        disabled={!canCommit}
        onclick={handleCommit}
      >
        {actionBusy ? "Committing…" : "Commit"}
      </button>
    </section>
  {/if}
</div>

<style>
  .git-changes-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    width: 100%;
    max-width: 40rem;
  }

  .git-changes-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--color-text-secondary);
  }

  .git-changes-state-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-changes-state-detail {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .git-changes-action-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .git-changes-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .git-changes-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .git-changes-section-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .git-changes-section-actions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .git-changes-action-button {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .git-changes-action-button:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .git-changes-action-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .git-changes-empty {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .git-changes-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .git-changes-item + .git-changes-item {
    border-top: 1px solid var(--color-border-subtle);
  }

  .git-changes-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    font-size: 0.875rem;
  }

  .git-changes-row:hover {
    background: var(--color-surface-2);
  }

  .git-changes-status {
    flex-shrink: 0;
    min-width: 1.5rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .git-changes-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
  }

  .git-changes-commit {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
  }

  .git-changes-commit-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .git-changes-message {
    width: 100%;
    min-height: 5rem;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text);
    font: inherit;
    resize: vertical;
  }

  .git-changes-message-invalid {
    border-color: var(--color-danger, #c0392b);
  }

  .git-changes-commit-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .git-changes-commit-button {
    align-self: flex-start;
    padding: var(--space-3) var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-accent);
    color: var(--color-on-accent, #fff);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .git-changes-commit-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
