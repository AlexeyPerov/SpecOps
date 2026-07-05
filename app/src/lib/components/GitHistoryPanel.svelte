<script lang="ts">
  import { untrack } from "svelte";
  import GitCommitGraphColumn from "./GitCommitGraphColumn.svelte";
  import {
    ROW_HEIGHT,
    buildCommitGraphLayout,
    commitGraphColumnWidth,
    computeCurrentBranchCommitSet,
  } from "../git/commitGraphLayout";
  import {
    commitRefBadgeTitle,
    formatRelativeCommitDate,
    formatShortSha,
  } from "../git/gitHistoryFormat";
  import { queryCommits } from "../git/gitService";
  import {
    COMMIT_LOG_PAGE_SIZE,
    DEFAULT_COMMIT_LOG_LIMIT,
    DEFAULT_HISTORY_FILTER_MODE,
    MAX_COMMIT_LOG_LIMIT,
    type CommitDecorator,
    type CommitSummary,
    type HistoryFilterMode,
  } from "../git/types";
  import {
    HISTORY_FILTER_MODE_OPTIONS,
    readPersistedHistoryFilterMode,
    reconcileHistoryFilterMode,
    writePersistedHistoryFilterMode,
  } from "../git/versionControlHistoryFilter";

  interface Props {
    repoRoot: string;
    refreshToken?: number;
    selectedSha?: string | null;
    onSelectCommit?: (commit: CommitSummary) => void;
  }

  let {
    repoRoot,
    refreshToken = 0,
    selectedSha = null,
    onSelectCommit = () => {},
  }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let commits = $state<CommitSummary[]>([]);
  let loadError = $state<string | null>(null);
  let commitLimit = $state(DEFAULT_COMMIT_LOG_LIMIT);
  let loadingMore = $state(false);
  let filterMode = $state<HistoryFilterMode>(DEFAULT_HISTORY_FILTER_MODE);
  let filterModeReady = $state(false);
  let scrollContainer = $state<HTMLDivElement | null>(null);
  let scrollContainerSize = $state({ width: 0, height: 0 });

  const activeFilterOption = $derived(
    HISTORY_FILTER_MODE_OPTIONS.find((option) => option.value === filterMode) ??
      HISTORY_FILTER_MODE_OPTIONS[0],
  );

  /*
   * Graph/row alignment: each list row uses fixed ROW_HEIGHT (from commitGraphLayout)
   * matching SVG row centers (y = rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2). Graph and
   * rows share one vertical scroll parent (.git-history-scroll) so they stay aligned.
   * A future virtualized list must use the same ROW_HEIGHT for item height and
   * translateY offsets so dots remain centered on visible rows.
   */
  const currentBranchHeadSha = $derived.by(() => {
    for (const commit of commits) {
      if (commit.refs.some((ref) => ref.type === "currentBranchHead")) {
        return commit.sha;
      }
    }
    return commits[0]?.sha ?? null;
  });

  const highlightedShas = $derived.by(() => {
    if (!currentBranchHeadSha || commits.length === 0) {
      return undefined;
    }
    return computeCurrentBranchCommitSet(commits, currentBranchHeadSha);
  });

  const graphLayout = $derived(
    buildCommitGraphLayout(commits, { highlightedShas }),
  );
  const graphWidth = $derived.by(() => {
    void scrollContainerSize;
    return commitGraphColumnWidth(graphLayout.laneCount);
  });
  const graphHeight = $derived(commits.length * ROW_HEIGHT);
  const canLoadMore = $derived(
    loadStatus === "ready" &&
      !loadingMore &&
      commits.length >= commitLimit &&
      commitLimit < MAX_COMMIT_LOG_LIMIT,
  );

  $effect(() => {
    const container = scrollContainer;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      scrollContainerSize = {
        width: entry?.contentRect.width ?? 0,
        height: entry?.contentRect.height ?? 0,
      };
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  });

  function reconcileSelection(rows: CommitSummary[], previousSha: string | null): void {
    if (rows.length === 0) {
      return;
    }
    if (previousSha && rows.some((commit) => commit.sha === previousSha)) {
      return;
    }
    onSelectCommit(rows[0]!);
  }

  async function loadCommits(
    root: string,
    mode: HistoryFilterMode,
    limit: number,
    previousSha: string | null,
    signal?: AbortSignal,
  ): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    commits = [];

    try {
      const rows = await queryCommits(root, { filterMode: mode, limit });
      if (signal?.aborted) {
        return;
      }
      commits = rows;
      loadStatus = "ready";
      reconcileSelection(rows, previousSha);
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      loadStatus = "error";
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  async function handleLoadMore(): Promise<void> {
    if (!canLoadMore || loadingMore) {
      return;
    }

    const nextLimit = Math.min(commitLimit + COMMIT_LOG_PAGE_SIZE, MAX_COMMIT_LOG_LIMIT);
    if (nextLimit <= commitLimit) {
      return;
    }

    const savedScrollTop = scrollContainer?.scrollTop ?? 0;
    loadingMore = true;
    loadError = null;

    try {
      const rows = await queryCommits(repoRoot, { filterMode, limit: nextLimit });
      commits = rows;
      commitLimit = nextLimit;
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = savedScrollTop;
        }
      });
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loadingMore = false;
    }
  }

  $effect(() => {
    const root = repoRoot;
    const token = refreshToken;
    void token;
    const controller = new AbortController();
    filterModeReady = false;
    filterMode = DEFAULT_HISTORY_FILTER_MODE;

    void (async () => {
      const persisted = await readPersistedHistoryFilterMode(root);
      if (controller.signal.aborted) {
        return;
      }
      filterMode = reconcileHistoryFilterMode(persisted);
      filterModeReady = true;
    })();

    return () => {
      controller.abort();
    };
  });

  $effect(() => {
    const root = repoRoot;
    const token = refreshToken;
    void token;
    if (!filterModeReady) {
      return;
    }
    const mode = filterMode;
    const previousSha = untrack(() => selectedSha);
    const controller = new AbortController();
    commitLimit = DEFAULT_COMMIT_LOG_LIMIT;
    void loadCommits(root, mode, DEFAULT_COMMIT_LOG_LIMIT, previousSha, controller.signal);
    return () => {
      controller.abort();
    };
  });

  async function handleFilterModeChange(nextMode: HistoryFilterMode): Promise<void> {
    if (nextMode === filterMode) {
      return;
    }
    commitLimit = DEFAULT_COMMIT_LOG_LIMIT;
    filterMode = nextMode;
    try {
      await writePersistedHistoryFilterMode(repoRoot, nextMode);
    } catch {
      // Persistence failure should not block scope switching.
    }
  }

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

  function emptyStateDetail(mode: HistoryFilterMode): string {
    if (mode === "current-branch") {
      return "This repository has no commits on the current branch.";
    }
    if (mode === "all-branches") {
      return "This repository has no commits on any local branch.";
    }
    return "This repository has no commits in the selected history scope.";
  }
</script>

<div class="git-history-panel" aria-label="Commit history">
  <div class="git-history-toolbar">
    <div
      class="git-history-filter-segmented"
      role="radiogroup"
      aria-label="History scope"
    >
      {#each HISTORY_FILTER_MODE_OPTIONS as option (option.value)}
        <button
          type="button"
          class:git-history-filter-active={filterMode === option.value}
          aria-checked={filterMode === option.value}
          role="radio"
          title={option.title}
          disabled={loadStatus === "loading"}
          onclick={() => void handleFilterModeChange(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
    <span class="git-history-filter-caption" title={activeFilterOption.title}>
      {activeFilterOption.title}
    </span>
  </div>

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
      <p class="git-history-state-detail">{emptyStateDetail(filterMode)}</p>
    </div>
  {:else}
    <div class="git-history-scroll" bind:this={scrollContainer}>
      <div class="git-history-content">
        <div
          class="git-history-graph"
          style="width: {graphWidth}px; min-width: {graphWidth}px; height: {graphHeight}px"
        >
          <GitCommitGraphColumn
            layout={graphLayout}
            rowCount={commits.length}
            {selectedSha}
          />
        </div>
        <ul class="git-history-list" role="listbox" aria-label="Commits in history scope">
          {#each commits as commit (commit.sha)}
            <li class="git-history-item">
              <button
                type="button"
                class="git-history-row"
                class:git-history-row-selected={selectedSha === commit.sha}
                style="height: {ROW_HEIGHT}px"
                role="option"
                aria-selected={selectedSha === commit.sha}
                onclick={() => handleSelectCommit(commit)}
                onkeydown={(event) => handleRowKeydown(event, commit)}
              >
                <span class="git-history-subject" title={commit.subject}>{commit.subject}</span>
                {#if commit.refs.length > 0}
                  <span class="git-history-refs" aria-label="Refs on this commit">
                    {#each commit.refs as ref (ref.type + ref.name)}
                      <span class="git-history-ref {refBadgeClass(ref)}" title={commitRefBadgeTitle(ref)}>
                        {ref.name}
                      </span>
                    {/each}
                  </span>
                {/if}
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
              </button>
            </li>
          {/each}
        </ul>
        {#if canLoadMore || loadingMore}
          <div class="git-history-load-more">
            <button
              type="button"
              class="git-history-load-more-button"
              disabled={loadingMore}
              onclick={() => void handleLoadMore()}
            >
              {loadingMore ? "Loading more commits…" : "Load more commits"}
            </button>
          </div>
        {/if}
      </div>
    </div>
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

  .git-history-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
  }

  .git-history-filter-segmented {
    display: inline-flex;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .git-history-filter-segmented button {
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.6875rem;
    line-height: 1.2;
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    white-space: nowrap;
  }

  .git-history-filter-segmented button:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  .git-history-filter-segmented button.git-history-filter-active {
    background: var(--color-selection);
    color: var(--color-text-primary);
  }

  .git-history-filter-caption {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
    color: var(--color-text-muted);
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

  .git-history-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .git-history-content {
    display: flex;
    align-items: flex-start;
    min-width: min-content;
  }

  .git-history-graph {
    position: sticky;
    left: 0;
    flex-shrink: 0;
    z-index: 1;
    pointer-events: none;
    background: var(--color-surface-1);
    overflow: visible;
  }

  .git-history-list {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .git-history-item {
    margin: 0;
  }

  .git-history-row {
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 0 var(--space-12) 0 var(--space-2);
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    font: inherit;
    overflow: hidden;
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
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.8125rem;
    font-weight: 500;
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .git-history-meta {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: var(--space-2);
    font-size: 0.6875rem;
    line-height: 1;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .git-history-sha {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-muted);
  }

  .git-history-meta-separator {
    color: var(--color-text-muted);
  }

  .git-history-refs {
    flex: 0 1 auto;
    display: flex;
    flex-wrap: nowrap;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
  }

  .git-history-ref {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: 0.625rem;
    font-weight: 600;
    line-height: 1.4;
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

  .git-history-load-more {
    display: flex;
    justify-content: center;
    padding: var(--space-4) var(--space-12);
  }

  .git-history-load-more-button {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    line-height: 1.2;
    padding: var(--space-2) var(--space-6);
    cursor: pointer;
  }

  .git-history-load-more-button:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
    color: var(--color-text-primary);
  }

  .git-history-load-more-button:disabled {
    cursor: wait;
    opacity: 0.75;
  }
</style>
