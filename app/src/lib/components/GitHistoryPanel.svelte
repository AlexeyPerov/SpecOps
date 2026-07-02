<script lang="ts">
  import {
    commitRefBadgeTitle,
    formatRelativeCommitDate,
    formatShortSha,
  } from "../git/gitHistoryFormat";
  import { queryCommits } from "../git/gitService";
  import type { CommitDecorator, CommitSummary } from "../git/types";

  interface Props {
    repoRoot: string;
    selectedSha?: string | null;
    onSelectCommit?: (commit: CommitSummary) => void;
  }

  let { repoRoot, selectedSha = null, onSelectCommit = () => {} }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let commits = $state<CommitSummary[]>([]);
  let loadError = $state<string | null>(null);

  async function loadCommits(root: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    commits = [];

    try {
      const rows = await queryCommits(root);
      if (signal?.aborted) {
        return;
      }
      commits = rows;
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
    const controller = new AbortController();
    void loadCommits(root, controller.signal);
    return () => {
      controller.abort();
    };
  });

  function handleSelectCommit(commit: CommitSummary): void {
    onSelectCommit(commit);
  }

  function handleRowKeydown(event: KeyboardEvent, commit: CommitSummary): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelectCommit(commit);
    }
  }

  function refBadgeClass(ref: CommitDecorator): string {
    if (ref.type === "tag") {
      return "git-history-ref-tag";
    }
    if (ref.type === "currentBranchHead" || ref.type === "currentCommitHead") {
      return "git-history-ref-current";
    }
    if (ref.type === "remoteBranchHead") {
      return "git-history-ref-remote";
    }
    return "git-history-ref-branch";
  }
</script>

<div class="git-history-panel" aria-label="Commit history">
  {#if loadStatus === "loading"}
    <div class="git-history-state" role="status" aria-live="polite">
      <p class="git-history-state-title">Loading commits…</p>
    </div>
  {:else if loadStatus === "error"}
    <div class="git-history-state" role="alert">
      <p class="git-history-state-title">Could not load commit history</p>
      {#if loadError}
        <p class="git-history-state-detail">{loadError}</p>
      {/if}
    </div>
  {:else if commits.length === 0}
    <div class="git-history-state" role="status">
      <p class="git-history-state-title">No commits yet</p>
      <p class="git-history-state-detail">
        This repository has no commits on the current branch.
      </p>
    </div>
  {:else}
    <ul class="git-history-list" role="listbox" aria-label="Commits on current branch">
      {#each commits as commit (commit.sha)}
        <li class="git-history-item">
          <button
            type="button"
            class="git-history-row"
            class:git-history-row-selected={selectedSha === commit.sha}
            role="option"
            aria-selected={selectedSha === commit.sha}
            onclick={() => handleSelectCommit(commit)}
            onkeydown={(event) => handleRowKeydown(event, commit)}
          >
            <span class="git-history-subject" title={commit.subject}>{commit.subject}</span>
            <span class="git-history-meta">
              <span class="git-history-sha" title={commit.sha}>{formatShortSha(commit.sha)}</span>
              <span class="git-history-meta-separator" aria-hidden="true">·</span>
              <span class="git-history-author" title={commit.authorEmail}>{commit.authorName}</span>
              <span class="git-history-meta-separator" aria-hidden="true">·</span>
              <time
                class="git-history-date"
                datetime={new Date(commit.authorTime * 1000).toISOString()}
                title={new Date(commit.authorTime * 1000).toLocaleString()}
              >
                {formatRelativeCommitDate(commit.authorTime)}
              </time>
            </span>
            {#if commit.refs.length > 0}
              <span class="git-history-refs" aria-label="Refs on this commit">
                {#each commit.refs as ref (ref.type + ref.name)}
                  <span class="git-history-ref {refBadgeClass(ref)}" title={commitRefBadgeTitle(ref)}>
                    {ref.name}
                  </span>
                {/each}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .git-history-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .git-history-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-10) var(--space-12);
    color: var(--color-text-secondary);
  }

  .git-history-state-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-history-state-detail {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .git-history-list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: var(--space-2) 0;
    list-style: none;
    overflow-y: auto;
  }

  .git-history-item {
    margin: 0;
  }

  .git-history-row {
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

  .git-history-row:hover {
    background: var(--color-surface-2);
  }

  .git-history-row:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .git-history-row-selected {
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-1));
    border-left-color: var(--color-accent);
  }

  .git-history-subject {
    width: 100%;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .git-history-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .git-history-sha {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-muted);
  }

  .git-history-meta-separator {
    color: var(--color-text-muted);
  }

  .git-history-refs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .git-history-ref {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1.6;
    white-space: nowrap;
  }

  .git-history-ref-current {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    color: var(--color-accent);
  }

  .git-history-ref-branch {
    background: color-mix(in srgb, var(--color-text-muted) 14%, transparent);
    color: var(--color-text-secondary);
  }

  .git-history-ref-remote {
    background: color-mix(in srgb, var(--color-text-muted) 10%, transparent);
    color: var(--color-text-muted);
  }

  .git-history-ref-tag {
    background: color-mix(in srgb, #c9a227 18%, transparent);
    color: color-mix(in srgb, #c9a227 85%, var(--color-text));
  }
</style>
