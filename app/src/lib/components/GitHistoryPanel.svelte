<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import GitCommitGraphColumn from "./GitCommitGraphColumn.svelte";
  import {
    ROW_HEIGHT,
    applyGraphHighlighting,
    buildCommitGraphStructure,
    commitGraphColumnWidth,
    computeCurrentBranchCommitSet,
  } from "../git/commitGraphLayout";
  import {
    commitRefBadgeTitle,
    formatRelativeCommitDate,
    formatShortSha,
  } from "../git/gitHistoryFormat";
  import { queryCommits, resolveHistoryCommit } from "../git/gitService";
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

  import { readGitWorkspaceViewState, saveGitWorkspaceViewState } from "../git/gitWorkspaceViewState";

  interface Props {
    stateKey?: string;
    repoRoot: string;
    refreshToken?: number;
    revision?: string | null;
    selectedSha?: string | null;
    onClearSelection?: () => void;
    onOpenChanges?: () => void;
    hasUncommittedChanges?: boolean;
    uncommittedSelected?: boolean;
    onSelectCommit?: (commit: CommitSummary) => void;
    onRefreshSelection?: (commit: CommitSummary) => void;
  }

  let {
    repoRoot,
    stateKey,
    refreshToken = 0,
    revision = null,
    selectedSha = null,
    onClearSelection = () => {},
    onOpenChanges = () => {},
    hasUncommittedChanges = false,
    uncommittedSelected = false,
    onSelectCommit = () => {},
    onRefreshSelection = () => {},
  }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let compact = $state(true);
  const rowHeight = $derived(compact ? 24 : ROW_HEIGHT);
  let order = $state<"date" | "topological">("topological");
  let includeRemotes = $state(false);
  let jumpQuery = $state("");
  let jumpRevision = $state<string | null>(null);
  let jumpError = $state<string | null>(null);
  let jumpBusy = $state(false);
  let jumpGeneration = 0;
  let widths = $state([90, 380, 100, 150, 140]);
  const columns = ["Graph", "Description", "Commit", "Author", "Date"];

  let resize = $state<{ index: number; x: number; width: number } | null>(null);
  function resizeMove(event: PointerEvent) {
    if (resize) widths[resize.index] = Math.max(resize.index === 1 ? 180 : 65, resize.width + event.clientX - resize.x);
  }
  export async function jumpTo(query = jumpQuery) {
    const generation = ++jumpGeneration;
    const root = repoRoot;
    jumpBusy = true; jumpError = null;
    try {
      const sha = await resolveHistoryCommit(root, query);
      if (generation !== jumpGeneration || root !== repoRoot) return;
      const index = commits.findIndex(c => c.sha === sha);
      if (index >= 0) { handleSelectCommit(commits[index]); await focusRow(index); }
      else jumpRevision = sha;
    } catch (error) {
      if (generation === jumpGeneration && root === repoRoot) jumpError = error instanceof Error ? error.message : String(error);
    } finally { if (generation === jumpGeneration) jumpBusy = false; }
  }
  async function focusRow(index: number) {
    if (scrollContainer) {
      const top = (index + (hasUncommittedChanges ? 1 : 0)) * rowHeight;
      if (top < scrollContainer.scrollTop || top + rowHeight > scrollContainer.scrollTop + scrollContainer.clientHeight - 28) scrollContainer.scrollTop = top;
      historyScrollTop = scrollContainer.scrollTop;
    }
    await tick();
    scrollContainer?.querySelector<HTMLButtonElement>(`[data-sha="${commits[index]?.sha}"]`)?.focus({ preventScroll: true });
  }
  function changeDensity(next: boolean) {
    const oldHeight = rowHeight;
    const top = scrollContainer?.scrollTop ?? 0;
    compact = next;
    void tick().then(() => { if (scrollContainer) { scrollContainer.scrollTop = top / oldHeight * rowHeight; historyScrollTop = scrollContainer.scrollTop; } });
  }
  let lastScope = "";
  let restorePending = true;
  let loadStatus = $state<LoadStatus>("idle");
  let commits = $state<CommitSummary[]>([]);
  let loadError = $state<string | null>(null);
  // Loaded query depth is retained on refresh and used as the next page offset.
  let commitLimit = $state(DEFAULT_COMMIT_LOG_LIMIT);
  // F36 (M4): separately track whether the backend history is exhausted. A
  // short page is the real "no more commits" signal; `commitLimit` can outrun
  // `commits.length` when boundary dedup drops rows, which previously hid the
  // "Load more" button even though more history existed. This flag is set only
  // by an actual short page and is what `canLoadMore` keys off.
  let historyExhausted = $state(false);
  let loadingMore = $state(false);
  let filterMode = $state<HistoryFilterMode>(DEFAULT_HISTORY_FILTER_MODE);
  let filterModeReady = $state(false);
  let scrollContainer = $state<HTMLDivElement | null>(null);
  let scrollContainerSize = $state({ width: 0, height: 0 });

  // Virtualization state for the commit list. Without windowing, a 5000-row
  // history rendered every `<li>` (plus a `new Date().toISOString()` +
  // `toLocaleString()` pair per row per render) on every change — the panel
  // stalled for seconds after each load-more (M13). Rows are a fixed
  // ROW_HEIGHT, so the window math is exact.
  const HISTORY_VIRTUALIZE_THRESHOLD = 200;
  const HISTORY_OVERSCAN_ROWS = 12;
  let historyScrollTop = $state(0);

  // AbortController for an in-flight "load more" fetch. A new load-more, a
  // scope/filter change, or a repo/refresh-token change aborts the previous
  // one so a late response from the older page can never overwrite the panel
  // state with stale rows. Without this guard the load-more handler refetched
  // the whole window and its result landed whenever it landed (M4).
  let loadMoreController: AbortController | null = null;

  function abortInFlightLoadMore(): void {
    if (loadMoreController) {
      loadMoreController.abort();
      loadMoreController = null;
    }
  }

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

  // F32 (M13 sub-item): split the O(commits) lane assignment from the cheap
  // highlighting pass. The structure only depends on the commit list, so Svelte
  // recomputes it when `commits` changes (history load) — not when the
  // current-branch highlight set changes. Highlighting is reapplied on top.
  const graphStructure = $derived(buildCommitGraphStructure(commits));
  const graphLayout = $derived.by(() => {
    const highlighted = applyGraphHighlighting(
      graphStructure.dots,
      graphStructure.segments,
      graphStructure.curves,
      highlightedShas,
    );
    return {
      dots: highlighted.dots,
      segments: highlighted.segments,
      curves: highlighted.curves,
      laneCount: graphStructure.laneCount,
      rowHeight: graphStructure.rowHeight,
    };
  });
  const graphWidth = $derived.by(() => {
    void scrollContainerSize;
    return commitGraphColumnWidth(graphLayout.laneCount);
  });
  const columnTemplate = $derived(`${Math.max(widths[0], graphWidth)}px ${widths.slice(1).map(w => `${w}px`).join(" ")}`);
  const graphHeight = $derived(commits.length * rowHeight);

  // Precompute each commit's rendered date strings once per `commits` change
  // rather than re-running `new Date().toISOString()` + `toLocaleString()`
  // per row per render (M13). Both are pure functions of `authorTime`, so the
  // memo is stable across scroll/selection re-renders.
  const commitDateMeta = $derived.by(() => {
    void commits;
    return commits.map((commit) => {
      const ms = commit.authorTime * 1000;
      const date = new Date(ms);
      return {
        iso: date.toISOString(),
        local: date.toLocaleString(),
      };
    });
  });

  // Window the rendered rows against the scroll viewport. The graph column
  // (SVG) stays full-height so curve segments spanning off-screen rows still
  // paint when scrolled into view; only the heavy `<li>` list is windowed.
  const historyVisibleRange = $derived.by(() => {
    const total = commits.length;
    if (total <= HISTORY_VIRTUALIZE_THRESHOLD) {
      return { start: 0, end: total };
    }
    const viewport = scrollContainerSize.height || scrollContainer?.clientHeight || 0;
    if (viewport <= 0) {
      return { start: 0, end: Math.min(total, HISTORY_VIRTUALIZE_THRESHOLD) };
    }
    const start = Math.max(0, Math.floor(Math.max(0, historyScrollTop - (hasUncommittedChanges ? rowHeight : 0) - 28) / rowHeight) - HISTORY_OVERSCAN_ROWS);
    const end = Math.min(
      total,
      Math.ceil((historyScrollTop + viewport) / rowHeight) + HISTORY_OVERSCAN_ROWS,
    );
    return { start, end };
  });
  const historyTopPadPx = $derived(historyVisibleRange.start * rowHeight);
  const historyBottomPadPx = $derived(
    Math.max(0, (commits.length - historyVisibleRange.end) * rowHeight),
  );
  const canLoadMore = $derived(
    loadStatus === "ready" &&
      !loadingMore &&
      !historyExhausted &&
      commitLimit < MAX_COMMIT_LOG_LIMIT,
  );

  $effect(() => {
    const container = scrollContainer;
    if (!container) {
      return;
    }

    const measure = (): void => {
      scrollContainerSize = { width: container.clientWidth, height: container.clientHeight };
    };
    const onScroll = (): void => {
      historyScrollTop = container.scrollTop;
    };
    measure();
    onScroll();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", onScroll);
    };
  });

  function reconcileSelection(rows: CommitSummary[], previousSha: string | null): void {
    if (rows.length === 0) {
      onClearSelection();
      return;
    }
    if (uncommittedSelected) return;
    const selected = rows.find(commit => commit.sha === previousSha);
    if (selected) {
      onRefreshSelection(selected);
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
    ref?: string | null,
  ): Promise<void> {
    loadStatus = "loading";
    loadError = null;


    try {
      const rows = await queryCommits(root, { filterMode: mode, limit, revision: ref ?? undefined, order, includeRemotes });
      if (signal?.aborted) {
        return;
      }
      commits = rows;
      // A short initial page means the backend history fits in one page;
      // mark it exhausted so the "Load more" button does not appear.
      if (rows.length < limit) {
        historyExhausted = true;
      }
      loadStatus = "ready";
      reconcileSelection(rows, previousSha);
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      loadStatus = "error";
      loadError = error instanceof Error ? error.message : String(error);
      commits = []; onClearSelection();
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

    // Capture the scope the in-flight fetch belongs to. If repoRoot/filterMode
    // change before the response lands, the loadCommits effect aborts this
    // controller and we drop the result rather than stamping it over the new
    // scope's data.
    const root = repoRoot;
    const mode = filterMode;
    const ref = jumpRevision ?? revision;
    const skip = commitLimit;
    const controller = new AbortController();
    abortInFlightLoadMore();
    loadMoreController = controller;

    const savedScrollTop = scrollContainer?.scrollTop ?? 0;
    loadingMore = true;
    loadError = null;

    try {
      // Paginate: fetch only the next page rather than re-running `git log`
      // from scratch with a larger N. `--skip=N -PAGE` returns commits
      // (N+1)..(N+PAGE) in newest-first order, which we append to the tail.
      const rows = await queryCommits(root, {
        filterMode: mode,
        limit: COMMIT_LOG_PAGE_SIZE,
        skip,
        revision: ref ?? undefined,
        order, includeRemotes,
      });
      if (controller.signal.aborted) {
        return;
      }

      // Deduplicate at the page boundary in case the history moved under us
      // (a fetch landed, a rebase happened, etc.) and the same SHA now appears
      // on both sides of the skip offset.
      const existing = new Set(commits.map((commit) => commit.sha));
      const appended: CommitSummary[] = [];
      for (const row of rows) {
        if (!existing.has(row.sha)) {
          appended.push(row);
        }
      }

      commits = [...commits, ...appended];
      // F36: a short page from the backend is the authoritative "no more
      // commits" signal — set `historyExhausted` regardless of how many rows
      // survived boundary dedup. Otherwise advance the offset by the full page
      // size so `--skip` stays aligned.
      if (rows.length < COMMIT_LOG_PAGE_SIZE) {
        historyExhausted = true;
        commitLimit = skip + rows.length;
      } else {
        commitLimit = nextLimit;
      }

      requestAnimationFrame(() => {
        if (scrollContainer && !controller.signal.aborted) {
          scrollContainer.scrollTop = savedScrollTop;
        }
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      if (loadMoreController === controller) {
        loadMoreController = null;
      }
      if (!controller.signal.aborted) {
        loadingMore = false;
      }
    }
  }

  const ownedStateKey = untrack(() => stateKey);
  onDestroy(() => {
    saveGitWorkspaceViewState(ownedStateKey, { history: { limit: commitLimit, scroll: scrollContainer?.scrollTop ?? historyScrollTop, compact, order, includeRemotes, widths: [...widths], filter: filterMode, jump: jumpRevision } });
  });

  $effect(() => {
    void revision;
    untrack(() => { jumpRevision = null; jumpGeneration++; jumpBusy = false; });
  });

  $effect(() => {
    const root = repoRoot;
    commits = []; loadStatus = "loading"; historyScrollTop = 0; lastScope = ""; restorePending = true;
    const saved = untrack(() => readGitWorkspaceViewState(stateKey)?.history);
    if (!saved) untrack(onClearSelection);
    jumpGeneration++; jumpBusy = false; jumpQuery = ""; jumpError = null; jumpRevision = null;
    compact = saved?.compact ?? true; order = saved?.order ?? "topological"; includeRemotes = saved?.includeRemotes ?? false; widths = saved?.widths ?? [90, 380, 100, 150, 140];
    jumpRevision = saved?.jump ?? null;
    const controller = new AbortController();
    filterModeReady = false;
    filterMode = DEFAULT_HISTORY_FILTER_MODE;

    void (async () => {
      // The prefs read is best-effort: a transient FS failure (or any future
      // regression in `readPersistedHistoryFilterMode`'s own error handling)
      // must not strand the panel. Without this guard an unhandled rejection
      // would leave `filterModeReady` false forever, which gates the page-1
      // load effect — so the panel would render the empty "No commits yet"
      // state for a repo that actually has history (M10).
      let persisted: HistoryFilterMode | null;
      try {
        persisted = await readPersistedHistoryFilterMode(root);
      } catch {
        persisted = null;
      }
      if (controller.signal.aborted) {
        return;
      }
      filterMode = saved?.filter ?? reconcileHistoryFilterMode(persisted);
      filterModeReady = true;
    })();

    return () => {
      controller.abort();
      jumpGeneration++;
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
    const ref = jumpRevision ?? revision;
    void order; void includeRemotes;
    const scope = `${root}:${mode}:${ref}:${order}:${includeRemotes}`;
    const sameScope = scope === lastScope;
    lastScope = scope;
    jumpGeneration++; jumpBusy = false;
    const restored = restorePending ? untrack(() => readGitWorkspaceViewState(stateKey)?.history) : undefined;
    restorePending = false;
    const savedScroll = sameScope ? untrack(() => scrollContainer?.scrollTop ?? historyScrollTop) : restored?.scroll ?? 0;
    const limit = sameScope ? untrack(() => commitLimit) : restored?.limit ?? DEFAULT_COMMIT_LOG_LIMIT;
    if (!sameScope) { commits = []; historyScrollTop = 0; if (!restored) onClearSelection(); }
    const previousSha = untrack(() => selectedSha);
    const controller = new AbortController();
    // A new page-1 load supersedes any in-flight "load more": its result would
    // be appended to a stale `commits` array otherwise.
    abortInFlightLoadMore();
    loadingMore = false;
    commitLimit = limit;
    historyExhausted = false;
    void loadCommits(root, mode, limit, previousSha, controller.signal, ref).then(async () => {
      await tick();
      if (!controller.signal.aborted && scrollContainer) { scrollContainer.scrollTop = savedScroll; historyScrollTop = savedScroll; }
    });
    return () => {
      abortInFlightLoadMore();
      controller.abort();
    };
  });

  async function handleFilterModeChange(nextMode: HistoryFilterMode): Promise<void> {
    if (nextMode === filterMode) {
      return;
    }
    commitLimit = DEFAULT_COMMIT_LOG_LIMIT;
    historyExhausted = false;
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); void navigator.clipboard.writeText(commit.sha).catch(() => { jumpError = "Could not copy commit SHA"; }); return; }
    const index = commits.findIndex(c => c.sha === commit.sha);
    const target = event.key === "Home" ? 0 : event.key === "End" ? commits.length - 1 : event.key === "ArrowDown" ? Math.min(commits.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : -1;
    if (target >= 0) { event.preventDefault(); handleSelectCommit(commits[target]); void focusRow(target); return; }

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

<svelte:window onpointermove={resizeMove} onpointerup={() => resize = null} onpointercancel={() => resize = null} />
<div class="git-history-panel" aria-label="Commit history">
  <div class="git-history-toolbar">
    <div role="radiogroup" aria-label="History scope">
      {#each HISTORY_FILTER_MODE_OPTIONS as option (option.value)}
        <button role="radio" aria-checked={filterMode === option.value} disabled={revision !== null || jumpRevision !== null} onclick={() => void handleFilterModeChange(option.value)} title={option.title}>{option.label}</button>
      {/each}
    </div>
    <label><input type="checkbox" bind:checked={includeRemotes} disabled={revision !== null || jumpRevision !== null} /> Remote refs</label>
    <select aria-label="History order" bind:value={order}><option value="topological">Topological order</option><option value="date">Date order</option></select>
    <label><input type="checkbox" checked={compact} onchange={event => changeDensity(event.currentTarget.checked)} /> Compact</label>
    <form onsubmit={event => { event.preventDefault(); void jumpTo(); }}><input aria-label="Jump to SHA or ref" placeholder="SHA or ref" bind:value={jumpQuery} /><button disabled={jumpBusy || !jumpQuery.trim()}>Jump to</button></form>
    {#if jumpRevision}<button onclick={() => jumpRevision = null}>Back to scope</button>{/if}
  </div>
  {#if jumpRevision || revision}<div class="git-history-caption">History: {jumpRevision ?? revision}</div>{/if}
  {#if jumpError}<div role="alert">{jumpError}</div>{/if}
  {#if loadError}<div role="alert">{loadError}</div>{/if}
  {#if loadStatus === "loading"}<div role="status">Loading commits…</div>{/if}
  <div class="git-history-scroll" bind:this={scrollContainer}>
    <div class="git-history-table" style="--columns: {columnTemplate}; --row-height: {rowHeight}px">
      <div class="git-history-header">
        {#each columns as column, index (column)}
          <div>{column}<button class="column-resize" aria-label="Resize {column} column" onpointerdown={event => { event.preventDefault(); resize = { index, x: event.clientX, width: widths[index] }; }} onkeydown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); widths[index] = Math.max(65, widths[index] + (event.key === "ArrowRight" ? 16 : -16)); } }}>↔</button></div>
        {/each}
      </div>
      {#if hasUncommittedChanges}
        <button class="git-history-uncommitted" class:git-history-row-selected={uncommittedSelected} aria-pressed={uncommittedSelected} onclick={onOpenChanges}><span>◉</span><span>Uncommitted changes</span><span>—</span><span></span><span></span></button>
      {/if}
      <div class="git-history-body" style="height: {graphHeight}px">
        <div class="git-history-graph" style="width: {Math.max(widths[0], graphWidth)}px"><GitCommitGraphColumn layout={graphLayout} rowCount={commits.length} {rowHeight} {selectedSha} /></div>
        <div role="listbox" aria-label="Commits in history scope">
          {#if historyTopPadPx > 0}<div style="height: {historyTopPadPx}px" aria-hidden="true"></div>{/if}
          {#each commits.slice(historyVisibleRange.start, historyVisibleRange.end) as commit, i (commit.sha)}
            {@const meta = commitDateMeta[historyVisibleRange.start + i]}
            <div class="git-history-item" class:git-history-row-selected={selectedSha === commit.sha}>
              <button class="git-history-row" data-sha={commit.sha} role="option" aria-selected={selectedSha === commit.sha} tabindex={selectedSha === commit.sha || (!selectedSha && i === 0) ? 0 : -1} onclick={() => handleSelectCommit(commit)} onkeydown={event => handleRowKeydown(event, commit)}>
                <span></span><span class="git-history-description" title={commit.subject}>
                  {#each commit.refs as ref (ref.type + ref.name)}<span class="git-history-ref {refBadgeClass(ref)}" title={commitRefBadgeTitle(ref)}>{ref.name}</span>{/each}
                  {commit.subject}
                </span>
                <span class="git-history-sha" title={commit.sha}>{formatShortSha(commit.sha)}</span>
                <span title={commit.authorEmail}>{commit.authorName}</span>
                <time datetime={meta?.iso} title={meta?.local}>{formatRelativeCommitDate(commit.authorTime)}</time>
              </button>
              {#if selectedSha === commit.sha && commit.refs.length}<select class="ref-jump" aria-label="Jump to reference" onchange={event => { if (event.currentTarget.value) void jumpTo(event.currentTarget.value); event.currentTarget.value = ""; }}><option value="">Ref…</option>{#each commit.refs as ref (ref.type + ref.name)}<option value={ref.name}>{ref.name}</option>{/each}</select>{/if}
              {#if selectedSha === commit.sha && commit.parents.length}<button class="parent-jump" aria-label="Jump to first parent" title="Jump to first parent" onclick={() => void jumpTo(commit.parents[0])}>↑</button>{/if}
            </div>
          {/each}
          {#if historyBottomPadPx > 0}<div style="height: {historyBottomPadPx}px" aria-hidden="true"></div>{/if}
        </div>
      </div>
    </div>
    {#if loadStatus === "ready" && commits.length === 0}<p role="status">No commits yet. {emptyStateDetail(filterMode)}</p>{/if}
    {#if canLoadMore}<button onclick={() => void handleLoadMore()}>Load more commits</button>{/if}
    {#if loadingMore}<p role="status">Loading more commits…</p>{/if}
    {#if !historyExhausted && commitLimit >= MAX_COMMIT_LOG_LIMIT}<p role="status">Showing the first 5000 commits. Jump to a SHA or reference to view older history. The graph covers these loaded commits.</p>{/if}
  </div>
</div>

<style>
.git-history-panel { display:flex; flex-direction:column; min-height:0; height:100%; font-size:12px; }
.git-history-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:5px 8px; border-bottom:1px solid var(--color-border-subtle); }
.git-history-toolbar label, form { display:flex; align-items:center; gap:4px; }
.git-history-toolbar input:not([type=checkbox]) { width:130px; }
.git-history-toolbar button, select, input { font-size:11px; }
.git-history-caption { padding:3px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.git-history-scroll { flex:1; min-height:0; overflow:auto; overflow-anchor:none; }
.git-history-table { width:max-content; min-width:100%; }
.git-history-header, .git-history-row, .git-history-uncommitted { display:grid; grid-template-columns:var(--columns); width:100%; box-sizing:border-box; }
.git-history-header { position:sticky; top:0; z-index:4; height:28px; background:var(--color-surface-1); border-bottom:1px solid var(--color-border-subtle); font-weight:600; }
.git-history-header > div { position:relative; padding:5px 8px; border-right:1px solid var(--color-border-subtle); }
.column-resize { position:absolute; right:0; top:0; height:100%; width:12px; cursor:col-resize; padding:0; background:transparent; border:0; color:var(--color-text-muted); touch-action:none; }
.git-history-body { position:relative; }
.git-history-graph { position:absolute; top:0; left:0; pointer-events:none; z-index:2; overflow:hidden; height:100%; }
.git-history-item { height:var(--row-height); position:relative; }
.git-history-row, .git-history-uncommitted { height:var(--row-height); border:0; border-radius:0; padding:0; text-align:left; background:transparent; color:inherit; font-size:12px; align-items:center; }
.git-history-row > span, .git-history-row > time, .git-history-uncommitted > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 8px; }
.git-history-row:hover { background:var(--color-surface-2); }
.git-history-row-selected { background:color-mix(in srgb,var(--color-accent) 20%, transparent); }
.git-history-row:focus-visible { outline:1px solid var(--color-accent); outline-offset:-1px; }
.git-history-sha { font-family:var(--font-mono); }
.git-history-ref { display:inline-block; padding:1px 4px; margin-right:5px; border-radius:3px; background:var(--color-surface-2); border:1px solid var(--color-border-subtle); font-size:10px; vertical-align:middle; }
.git-history-ref-current { border-color:var(--color-accent); color:var(--color-accent); }
.git-history-ref-tag { color:#bc8b2e; }.git-history-ref-remote { color:#548dbb; }
.ref-jump { position:absolute; right:26px; top:0; max-width:90px; height:100%; font-size:10px; }
.parent-jump { position:absolute; right:0; top:0; height:100%; }
</style>
