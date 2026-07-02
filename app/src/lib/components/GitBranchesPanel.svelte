<script lang="ts">
  import { formatShortSha } from "../git/gitHistoryFormat";
  import { queryBranches } from "../git/gitService";
  import type { BranchSummary } from "../git/types";

  interface Props {
    repoRoot: string;
    refreshToken?: number;
  }

  let { repoRoot, refreshToken = 0 }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let branches = $state<BranchSummary[]>([]);
  let loadError = $state<string | null>(null);

  async function loadBranches(root: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    branches = [];

    try {
      const rows = await queryBranches(root);
      if (signal?.aborted) {
        return;
      }
      branches = rows;
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
    const controller = new AbortController();
    void loadBranches(root, controller.signal);
    return () => {
      controller.abort();
    };
  });

  function upstreamSummary(branch: BranchSummary): string | null {
    if (!branch.upstream) {
      return null;
    }
    if (branch.upstreamTrack) {
      return `${branch.upstream} (${branch.upstreamTrack})`;
    }
    return branch.upstream;
  }
</script>

<div class="git-branches-panel" aria-label="Local branches">
  <div class="git-branches-toolbar">
    <button type="button" class="git-branches-action" disabled title="Create branch (phase 3)">
      Create branch
    </button>
  </div>

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
      <p class="git-branches-state-title">No local branches</p>
      <p class="git-branches-state-detail">This repository has no local branch refs yet.</p>
    </div>
  {:else}
    <ul class="git-branches-list" role="list">
      {#each branches as branch (branch.name)}
        <li class="git-branches-item">
          <div
            class="git-branches-row"
            class:git-branches-row-current={branch.isCurrent}
            aria-current={branch.isCurrent ? "true" : undefined}
          >
            <div class="git-branches-row-main">
              <span class="git-branches-name" title={branch.name}>
                {#if branch.isCurrent}
                  <span class="git-branches-current-marker" aria-hidden="true">*</span>
                {/if}
                {branch.name}
                {#if branch.isCurrent}
                  <span class="git-branches-current-badge">Current</span>
                {/if}
              </span>
              <span class="git-branches-meta">
                <span class="git-branches-sha" title={branch.head}>{formatShortSha(branch.head)}</span>
                {#if branch.subject}
                  <span class="git-branches-meta-separator" aria-hidden="true">·</span>
                  <span class="git-branches-subject" title={branch.subject}>{branch.subject}</span>
                {/if}
              </span>
              {#if upstreamSummary(branch)}
                <span class="git-branches-upstream" title="Upstream tracking">
                  {upstreamSummary(branch)}
                </span>
              {/if}
            </div>
            <button
              type="button"
              class="git-branches-checkout"
              disabled
              title="Checkout branch (phase 3)"
            >
              Checkout
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .git-branches-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .git-branches-toolbar {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    padding: var(--space-4) var(--space-12);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .git-branches-action {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: not-allowed;
    opacity: 0.55;
  }

  .git-branches-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-10) var(--space-12);
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
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: var(--space-2) 0;
    list-style: none;
    overflow-y: auto;
  }

  .git-branches-item {
    margin: 0;
  }

  .git-branches-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-12);
    border-left: 2px solid transparent;
  }

  .git-branches-row-current {
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-1));
    border-left-color: var(--color-accent);
  }

  .git-branches-row-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    flex: 1;
  }

  .git-branches-name {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-branches-current-marker {
    color: var(--color-accent);
  }

  .git-branches-current-badge {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    color: var(--color-accent);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .git-branches-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .git-branches-sha {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-muted);
  }

  .git-branches-meta-separator {
    color: var(--color-text-muted);
  }

  .git-branches-subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .git-branches-upstream {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .git-branches-checkout {
    flex-shrink: 0;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.75rem;
    cursor: not-allowed;
    opacity: 0.55;
  }
</style>
