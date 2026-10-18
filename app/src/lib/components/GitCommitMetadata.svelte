<script lang="ts">
  import { formatCommitTimestamp, formatShortSha } from "../git/gitHistoryFormat";
  import type { CommitDecorator, CommitDetail } from "../git/types";

  let { commit, refs = [], onNavigate, notify = () => {} }: {
    commit: CommitDetail;
    refs?: CommitDecorator[];
    onNavigate?: (sha: string) => void;
    notify?: (message: string) => void;
  } = $props();

  /** Machine-readable time, or undefined when the timestamp is out of range. */
  function isoTimestamp(unixSeconds: number): string | undefined {
    const date = new Date(unixSeconds * 1000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }

  async function copySha() {
    try { await navigator.clipboard.writeText(commit.sha); }
    catch { notify("Could not copy commit SHA"); }
  }
</script>

<div class="git-commit-metadata">
  <header class="git-commit-detail-header">
    <button type="button" class="git-commit-detail-sha" title={commit.sha} onclick={() => void copySha()}>Copy SHA {formatShortSha(commit.sha, 12)}</button>
    {#if commit.parents.length > 0}
      <p class="git-commit-detail-parents">
        <span class="git-commit-detail-label">Parents</span>
        {#each commit.parents as parent (parent)}
          <button type="button" class="git-commit-detail-parent" title={parent} disabled={!onNavigate} onclick={() => onNavigate?.(parent)}>{formatShortSha(parent)}</button>
        {/each}
      </p>
    {/if}
    {#if refs.length}
      <div class="git-commit-detail-parents" aria-label="Commit references">
        {#each refs as ref (ref.type + ref.name)}
          <span title={ref.type}>{ref.name}</span>
        {/each}
      </div>
    {/if}
  </header>

  <section class="git-commit-detail-section git-commit-detail-meta-section" aria-label="Commit message">
    <pre class="git-commit-detail-message">{commit.message.trim() || "(empty commit message)"}</pre>
  </section>

  <section class="git-commit-detail-section git-commit-detail-meta-section" aria-label="Author and committer">
    <dl class="git-commit-detail-meta">
      <div class="git-commit-detail-meta-row">
        <dt>Author</dt>
        <dd>
          {commit.authorName}
          {#if commit.authorEmail}
            <span class="git-commit-detail-email">&lt;{commit.authorEmail}&gt;</span>
          {/if}
          <time
            class="git-commit-detail-time"
            datetime={isoTimestamp(commit.authorTime)}
          >
            {formatCommitTimestamp(commit.authorTime)}
          </time>
        </dd>
      </div>
      <div class="git-commit-detail-meta-row">
        <dt>Committer</dt>
        <dd>
          {commit.committerName}
          {#if commit.committerEmail}
            <span class="git-commit-detail-email">&lt;{commit.committerEmail}&gt;</span>
          {/if}
          <time
            class="git-commit-detail-time"
            datetime={isoTimestamp(commit.committerTime)}
          >
            {formatCommitTimestamp(commit.committerTime)}
          </time>
        </dd>
      </div>
    </dl>
  </section>
</div>
<style>
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
  }
  .git-commit-detail-meta-section {
    padding-block: var(--space-4);
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
    gap: var(--space-3);
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
  .git-commit-metadata { height: 100%; overflow: auto; }
  button { color: inherit; border: 1px solid var(--color-border-subtle); cursor: pointer; }
  .git-commit-metadata { height: 100%; overflow: auto; }
</style>
