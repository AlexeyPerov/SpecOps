<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { formatShortSha } from "../git/gitHistoryFormat";
  import { reportGitError } from "../git/gitErrorUi";
  import { GitDiffTooLargeError, queryCommitDetail, queryCommitFileDiff } from "../git/gitService";
  import type { CommitDecorator, CommitDetail, ParsedTextDiff } from "../git/types";
  import GitCommitFiles from "./GitCommitFiles.svelte";
  import GitCommitMetadata from "./GitCommitMetadata.svelte";
  import GitTextDiffView from "./GitTextDiffView.svelte";
  import GitWorkspaceSplit from "./GitWorkspaceSplit.svelte";

  import { readGitWorkspaceViewState, saveGitWorkspaceViewState } from "../git/gitWorkspaceViewState";

  interface Props {
    repoRoot: string;
    layoutScope?: string;
    sha?: string | null;
    refs?: CommitDecorator[];
    refreshToken?: number;
    onNavigate?: (sha: string) => void;
    notify?: (message: string) => void;
  }
  let { repoRoot, sha = null, refs = [], refreshToken = 0, onNavigate,
    notify = () => {}, layoutScope = repoRoot }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";
  let loadStatus = $state<LoadStatus>("idle");
  let detail = $state<CommitDetail | null>(null);
  let loadError = $state<string | null>(null);
  let selectedFilePath = $state<string | null>(null);
  let fileDiff = $state<ParsedTextDiff | null>(null);
  let diffLoading = $state(false);
  let diffError = $state<string | null>(null);
  let metadataCollapsed = $state(false);
  let loadedIdentity: string | null = null;
  const ownedLayoutScope = untrack(() => layoutScope);
  untrack(() => {
    const restored = readGitWorkspaceViewState(ownedLayoutScope)?.inspector;
    if (restored) { loadedIdentity = `${repoRoot}\0${restored.sha}`; selectedFilePath = restored.path; metadataCollapsed = restored.metadataCollapsed; }
  });
  onDestroy(() => saveGitWorkspaceViewState(ownedLayoutScope, { inspector: { sha, path: selectedFilePath, metadataCollapsed } }));
  const selectedFile = $derived(detail?.files.find(file => file.path === selectedFilePath));

  async function loadDetail(root: string, commitSha: string, signal: AbortSignal) {
    const identity = `${root}\0${commitSha}`;
    const previousPath = loadedIdentity === identity ? selectedFilePath : null;
    loadedIdentity = identity;
    loadStatus = "loading";
    loadError = null;
    detail = null;
    selectedFilePath = previousPath;
    fileDiff = null;
    diffError = null;
    diffLoading = false;
    try {
      const result = await queryCommitDetail(root, commitSha);
      if (signal.aborted || root !== repoRoot || commitSha !== sha) return;
      detail = result;
      loadStatus = "ready";
      selectedFilePath = result.files.some(file => file.path === previousPath)
        ? previousPath : [...result.files].sort((a, b) => a.path.localeCompare(b.path))[0]?.path ?? null;
    } catch (error) {
      if (signal.aborted || root !== repoRoot || commitSha !== sha) return;
      loadStatus = "error";
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadFileDiff(root: string, commitSha: string, path: string,
    parentSha: string | undefined, signal: AbortSignal) {
    const isCurrent = () => !signal.aborted && root === repoRoot && commitSha === sha && path === selectedFilePath;
    diffLoading = true;
    diffError = null;
    fileDiff = null;
    try {
      const result = await queryCommitFileDiff(root, commitSha, path, parentSha);
      if (isCurrent()) fileDiff = result;
    } catch (error) {
      if (!isCurrent()) return;
      diffError = error instanceof GitDiffTooLargeError
        ? "This diff exceeds the inline display limit."
        : reportGitError(error, { operation: "Load file diff", repoRoot: root, notify });
    } finally {
      if (isCurrent()) diffLoading = false;
    }
  }

  $effect(() => {
    const root = repoRoot;
    const commitSha = sha;
    const token = refreshToken;
    const controller = new AbortController();
    untrack(() => {
      if (commitSha) void loadDetail(root, commitSha, controller.signal);
      else {
        loadedIdentity = null;
        loadStatus = "idle";
        detail = null;
        selectedFilePath = null;
        loadError = null;
        fileDiff = null;
        diffError = null;
        diffLoading = false;
      }
    });
    return () => controller.abort();
  });

  $effect(() => {
    const root = repoRoot;
    const commitSha = sha;
    const path = selectedFilePath;
    const parentSha = detail?.parents[0];
    const ready = loadStatus === "ready";
    const controller = new AbortController();
    if (commitSha && path && ready) void loadFileDiff(root, commitSha, path, parentSha, controller.signal);
    else { fileDiff = null; diffError = null; diffLoading = false; }
    return () => controller.abort();
  });
</script>

<div class="git-commit-detail" aria-label="Commit detail">
  <GitWorkspaceSplit storageKey={`${layoutScope}:files`} label="Resize files and diff"
    initial={0.38} minFirst={160} minSecond={220}>
    {#snippet first()}
      <div class="git-commit-detail-file-column">
        <button type="button" class="git-metadata-toggle" aria-expanded={!metadataCollapsed}
          onclick={() => metadataCollapsed = !metadataCollapsed}>Commit metadata</button>
        <GitWorkspaceSplit storageKey={`${layoutScope}:metadata`} label="Resize files and metadata"
          vertical initial={0.55} minFirst={90} minSecond={90}
          collapsed={metadataCollapsed} collapseSecond>
          {#snippet first()}
            {#if detail}
              <GitCommitFiles files={detail.files} selectedPath={selectedFilePath}
                onSelect={path => selectedFilePath = path} />
            {:else}
              <div class="git-commit-detail-state" role={loadError ? "alert" : "status"}>
                <p class="git-commit-detail-state-title">{loadStatus === "loading" ? "Loading commit…" : loadError ? "Could not load commit" : "Select a commit"}</p>
                {#if loadError}<p>{loadError}</p>{/if}
              </div>
            {/if}
          {/snippet}
          {#snippet second()}
            {#if detail}
              <GitCommitMetadata commit={detail} {refs} {onNavigate} {notify} />
            {:else}
              <div class="git-commit-detail-state" role="status">Commit metadata unavailable</div>
            {/if}
          {/snippet}
        </GitWorkspaceSplit>
      </div>
    {/snippet}
    {#snippet second()}
      <div class="git-commit-detail-diff-pane">
        {#if detail && detail.parents.length > 1}
          <p class="comparison-base">Merge comparison: first parent {formatShortSha(detail.parents[0])}</p>
        {/if}
        <GitTextDiffView diff={fileDiff} title={selectedFilePath ?? undefined}
          subtitle={selectedFile?.status === "D" ? "Deleted file" : undefined}
          loading={diffLoading} error={diffError} />
      </div>
    {/snippet}
  </GitWorkspaceSplit>
</div>

<style>
  .git-commit-detail { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--color-surface-1); }
  .git-commit-detail-file-column { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .git-commit-detail-file-column > :global(.workspace-split) { flex: 1; height: auto; }
  .git-metadata-toggle { flex-shrink: 0; text-align: left; background: var(--color-surface-2); color: var(--color-text); border: 0; padding: 4px 8px; cursor: pointer; }
  .git-commit-detail-diff-pane { height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .git-commit-detail-state { height: 100%; overflow: auto; box-sizing: border-box; padding: 12px; color: var(--color-text-secondary); }
  .git-commit-detail-state-title { font-size: 0.875rem; color: var(--color-text); }
  .comparison-base { flex-shrink: 0; margin: 0; padding: 4px 8px; font-size: 12px; border-bottom: 1px solid var(--color-border-subtle); }
</style>
