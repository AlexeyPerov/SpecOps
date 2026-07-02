<script lang="ts">
  import {
    formatCommitTimestamp,
    formatShortSha,
  } from "../git/gitHistoryFormat";
  import { queryCommitDetail } from "../git/gitService";
  import type { CommitDetail, CommitFileChange } from "../git/types";

  interface Props {
    repoRoot: string;
    sha?: string | null;
  }

  let { repoRoot, sha = null }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let detail = $state<CommitDetail | null>(null);
  let loadError = $state<string | null>(null);

  async function loadDetail(root: string, commitSha: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    detail = null;

    try {
      const result = await queryCommitDetail(root, commitSha);
      if (signal?.aborted) {
        return;
      }
      detail = result;
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
    const commitSha = sha;
    const controller = new AbortController();

    if (!commitSha) {
      loadStatus = "idle";
      loadError = null;
      detail = null;
      return () => {
        controller.abort();
      };
    }

    void loadDetail(root, commitSha, controller.signal);
    return () => {
      controller.abort();
    };
  });

  function fileStatusLabel(file: CommitFileChange): string {
    switch (file.status) {
      case "A":
        return "Added";
      case "M":
        return "Modified";
      case "D":
        return "Deleted";
      case "R":
        return "Renamed";
      case "C":
        return "Copied";
      case "T":
        return "Type changed";
      case "U":
        return "Unmerged";
      default:
        return file.status;
    }
  }

  function fileDisplayPath(file: CommitFileChange): string {
    if (file.previousPath && (file.status === "R" || file.status === "C")) {
      return `${file.previousPath} → ${file.path}`;
    }
    return file.path;
  }

  function fileStatusClass(status: CommitFileChange["status"]): string {
    switch (status) {
      case "A":
        return "git-commit-file-added";
      case "D":
        return "git-commit-file-deleted";
      case "R":
      case "C":
        return "git-commit-file-renamed";
      default:
        return "git-commit-file-modified";
    }
  }
</script>

<div class="git-commit-detail" aria-label="Commit detail">
  {#if !sha}
    <div class="git-commit-detail-state" role="status">
      <p class="git-commit-detail-state-title">Select a commit</p>
      <p class="git-commit-detail-state-detail">
        Choose a commit from the list to view metadata and changed files.
      </p>
    </div>
  {:else if loadStatus === "loading"}
    <div class="git-commit-detail-state" role="status" aria-live="polite">
      <p class="git-commit-detail-state-title">Loading commit…</p>
    </div>
  {:else if loadStatus === "error"}
    <div class="git-commit-detail-state" role="alert">
      <p class="git-commit-detail-state-title">Could not load commit</p>
      {#if loadError}
        <p class="git-commit-detail-state-detail">{loadError}</p>
      {/if}
    </div>
  {:else if detail}
    <header class="git-commit-detail-header">
      <p class="git-commit-detail-sha" title={detail.sha}>{formatShortSha(detail.sha, 12)}</p>
      {#if detail.parents.length > 0}
        <p class="git-commit-detail-parents">
          <span class="git-commit-detail-label">Parents</span>
          {#each detail.parents as parent (parent)}
            <code class="git-commit-detail-parent" title={parent}>{formatShortSha(parent)}</code>
          {/each}
        </p>
      {/if}
    </header>

    <section class="git-commit-detail-section" aria-label="Commit message">
      <pre class="git-commit-detail-message">{detail.message.trim() || "(empty commit message)"}</pre>
    </section>

    <section class="git-commit-detail-section" aria-label="Author and committer">
      <dl class="git-commit-detail-meta">
        <div class="git-commit-detail-meta-row">
          <dt>Author</dt>
          <dd>
            {detail.authorName}
            {#if detail.authorEmail}
              <span class="git-commit-detail-email">&lt;{detail.authorEmail}&gt;</span>
            {/if}
            <time
              class="git-commit-detail-time"
              datetime={new Date(detail.authorTime * 1000).toISOString()}
            >
              {formatCommitTimestamp(detail.authorTime)}
            </time>
          </dd>
        </div>
        <div class="git-commit-detail-meta-row">
          <dt>Committer</dt>
          <dd>
            {detail.committerName}
            {#if detail.committerEmail}
              <span class="git-commit-detail-email">&lt;{detail.committerEmail}&gt;</span>
            {/if}
            <time
              class="git-commit-detail-time"
              datetime={new Date(detail.committerTime * 1000).toISOString()}
            >
              {formatCommitTimestamp(detail.committerTime)}
            </time>
          </dd>
        </div>
      </dl>
    </section>

    <section class="git-commit-detail-section git-commit-detail-files" aria-label="Changed files">
      <h3 class="git-commit-detail-files-title">Changed files</h3>
      {#if detail.files.length === 0}
        <p class="git-commit-detail-empty-files">No file changes in this commit.</p>
      {:else}
        <ul class="git-commit-detail-file-list">
          {#each detail.files as file (`${file.status}:${file.path}:${file.previousPath ?? ""}`)}
            <li class="git-commit-detail-file-item">
              <span
                class="git-commit-detail-file-status {fileStatusClass(file.status)}"
                title={fileStatusLabel(file)}
              >
                {file.status}
              </span>
              <span class="git-commit-detail-file-path" title={fileDisplayPath(file)}>
                {fileDisplayPath(file)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .git-commit-detail {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-surface-1);
  }

  .git-commit-detail-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-10) var(--space-12);
    color: var(--color-text-secondary);
  }

  .git-commit-detail-state-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-commit-detail-state-detail {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .git-commit-detail-header {
    flex-shrink: 0;
    padding: var(--space-6) var(--space-12) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .git-commit-detail-sha {
    margin: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    color: var(--color-text-muted);
  }

  .git-commit-detail-parents {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .git-commit-detail-label {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .git-commit-detail-parent {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-text-muted) 10%, transparent);
    font-size: 0.75rem;
  }

  .git-commit-detail-section {
    flex-shrink: 0;
    padding: var(--space-6) var(--space-12);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .git-commit-detail-message {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font: inherit;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--color-text);
  }

  .git-commit-detail-meta {
    margin: 0;
    display: grid;
    gap: var(--space-4);
  }

  .git-commit-detail-meta-row {
    display: grid;
    grid-template-columns: 5.5rem 1fr;
    gap: var(--space-3);
    font-size: 0.8125rem;
  }

  .git-commit-detail-meta-row dt {
    margin: 0;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .git-commit-detail-meta-row dd {
    margin: 0;
    color: var(--color-text);
    line-height: 1.5;
  }

  .git-commit-detail-email {
    color: var(--color-text-secondary);
  }

  .git-commit-detail-time {
    display: block;
    margin-top: var(--space-1);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
  }

  .git-commit-detail-files {
    flex: 1;
    min-height: 0;
    border-bottom: none;
  }

  .git-commit-detail-files-title {
    margin: 0 0 var(--space-4);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .git-commit-detail-empty-files {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .git-commit-detail-file-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .git-commit-detail-file-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .git-commit-detail-file-status {
    flex-shrink: 0;
    width: 1.25rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-weight: 700;
    text-align: center;
  }

  .git-commit-detail-file-added {
    color: #2d8a4e;
  }

  .git-commit-detail-file-modified {
    color: var(--color-accent);
  }

  .git-commit-detail-file-deleted {
    color: var(--color-danger, #c0392b);
  }

  .git-commit-detail-file-renamed {
    color: #9b7b1f;
  }

  .git-commit-detail-file-path {
    min-width: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text);
    word-break: break-all;
  }
</style>
