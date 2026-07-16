<script lang="ts">
  import {
    formatCommitTimestamp,
    formatShortSha,
  } from "../git/gitHistoryFormat";
  import { reportGitError } from "../git/gitErrorUi";
  import {
    GitDiffTooLargeError,
    queryCommitDetail,
    queryCommitFileDiff,
  } from "../git/gitService";
  import type { CommitDetail, CommitFileChange, ParsedTextDiff } from "../git/types";
  import GitTextDiffView from "./GitTextDiffView.svelte";

  interface Props {
    repoRoot: string;
    sha?: string | null;
    refreshToken?: number;
    notify?: (message: string) => void;
  }

  let { repoRoot, sha = null, refreshToken = 0, notify = () => {} }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let detail = $state<CommitDetail | null>(null);
  let loadError = $state<string | null>(null);
  let selectedFilePath = $state<string | null>(null);
  let fileDiff = $state<ParsedTextDiff | null>(null);
  let diffLoading = $state(false);
  let diffError = $state<string | null>(null);
  let fileListWidthPx = $state(240);
  let isResizingFileList = $state(false);

  const MIN_FILE_LIST_WIDTH_PX = 160;
  const MAX_FILE_LIST_WIDTH_PX = 480;

  async function loadDetail(root: string, commitSha: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    detail = null;
    selectedFilePath = null;
    fileDiff = null;
    diffError = null;
    diffLoading = false;

    try {
      const result = await queryCommitDetail(root, commitSha);
      if (signal?.aborted) {
        return;
      }
      detail = result;
      loadStatus = "ready";
      selectedFilePath = result.files[0]?.path ?? null;
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      loadStatus = "error";
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadFileDiff(
    root: string,
    commitSha: string,
    path: string,
    parentSha: string | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    diffLoading = true;
    diffError = null;
    fileDiff = null;

    try {
      const result = await queryCommitFileDiff(root, commitSha, path, parentSha);
      if (signal?.aborted) {
        return;
      }
      fileDiff = result;
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      if (error instanceof GitDiffTooLargeError) {
        diffError =
          "This diff is too large to display inline. Use an external diff tool to review it.";
      } else {
        diffError = reportGitError(error, {
          operation: "Load file diff",
          repoRoot: root,
          notify,
        });
      }
    } finally {
      if (!signal?.aborted) {
        diffLoading = false;
      }
    }
  }

  $effect(() => {
    const root = repoRoot;
    const commitSha = sha;
    const token = refreshToken;
    const controller = new AbortController();

    if (!commitSha) {
      loadStatus = "idle";
      loadError = null;
      detail = null;
      selectedFilePath = null;
      fileDiff = null;
      diffError = null;
      diffLoading = false;
      return () => {
        controller.abort();
      };
    }

    void loadDetail(root, commitSha, controller.signal);
    return () => {
      controller.abort();
    };
  });

  $effect(() => {
    const root = repoRoot;
    const commitSha = sha;
    const path = selectedFilePath;
    const parentSha = detail?.parents[0];
    const controller = new AbortController();

    if (!commitSha || !path || loadStatus !== "ready") {
      fileDiff = null;
      diffError = null;
      diffLoading = false;
      return () => {
        controller.abort();
      };
    }

    void loadFileDiff(root, commitSha, path, parentSha, controller.signal);
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

  function selectFile(path: string): void {
    selectedFilePath = path;
  }

  function handleFileListKeydown(event: KeyboardEvent): void {
    if (!detail || detail.files.length === 0) {
      return;
    }

    const currentIndex = detail.files.findIndex((file) => file.path === selectedFilePath);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex =
        currentIndex < 0 ? 0 : Math.min(currentIndex + 1, detail.files.length - 1);
      selectedFilePath = detail.files[nextIndex]?.path ?? null;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex =
        currentIndex < 0 ? detail.files.length - 1 : Math.max(currentIndex - 1, 0);
      selectedFilePath = detail.files[nextIndex]?.path ?? null;
    }
  }

  function handleFileListResizeStart(event: PointerEvent): void {
    event.preventDefault();
    isResizingFileList = true;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = fileListWidthPx;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    function handleMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const delta = moveEvent.clientX - startX;
      fileListWidthPx = Math.max(
        MIN_FILE_LIST_WIDTH_PX,
        Math.min(MAX_FILE_LIST_WIDTH_PX, startWidth + delta),
      );
    }

    function handleUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      isResizingFileList = false;
      target?.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
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

    <section class="git-commit-detail-section git-commit-detail-meta-section" aria-label="Commit message">
      <pre class="git-commit-detail-message">{detail.message.trim() || "(empty commit message)"}</pre>
    </section>

    <section class="git-commit-detail-section git-commit-detail-meta-section" aria-label="Author and committer">
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

    <section
      class="git-commit-detail-changes"
      class:git-commit-detail-changes-resizing={isResizingFileList}
      aria-label="Changed files and diff"
    >
      <div
        class="git-commit-detail-file-pane"
        style={`width: ${fileListWidthPx}px`}
      >
        <h3 class="git-commit-detail-files-title">Changed files</h3>
        {#if detail.files.length === 0}
          <p class="git-commit-detail-empty-files">No file changes in this commit.</p>
        {:else}
          <ul
            class="git-commit-detail-file-list"
            role="listbox"
            aria-label="Changed files"
            tabindex="0"
            onkeydown={handleFileListKeydown}
          >
            {#each detail.files as file (`${file.status}:${file.path}:${file.previousPath ?? ""}`)}
              <li role="presentation">
                <button
                  type="button"
                  role="option"
                  class="git-commit-detail-file-item"
                  class:git-commit-detail-file-item-selected={selectedFilePath === file.path}
                  aria-selected={selectedFilePath === file.path}
                  onclick={() => selectFile(file.path)}
                >
                  <span
                    class="git-commit-detail-file-status {fileStatusClass(file.status)}"
                    title={fileStatusLabel(file)}
                  >
                    {file.status}
                  </span>
                  <span class="git-commit-detail-file-path" title={fileDisplayPath(file)}>
                    {fileDisplayPath(file)}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div
        class="git-commit-detail-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file list"
        onpointerdown={handleFileListResizeStart}
      ></div>

      <div class="git-commit-detail-diff-pane">
        <GitTextDiffView
          diff={fileDiff}
          title={selectedFilePath ?? undefined}
          loading={diffLoading}
          error={diffError}
        />
      </div>
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
    overflow: hidden;
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

  .git-commit-detail-changes {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: stretch;
    border-top: 1px solid var(--color-border-subtle);
  }

  .git-commit-detail-changes-resizing {
    user-select: none;
  }

  .git-commit-detail-file-pane {
    flex-shrink: 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--color-border-subtle);
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
  }

  .git-commit-detail-splitter {
    flex-shrink: 0;
    width: 4px;
    margin: 0 -2px;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
    position: relative;
    z-index: 1;
  }

  .git-commit-detail-splitter:hover,
  .git-commit-detail-changes-resizing .git-commit-detail-splitter {
    background: color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .git-commit-detail-diff-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .git-commit-detail-files-title {
    margin: 0 0 var(--space-3);
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
    gap: var(--space-1);
    overflow-y: auto;
    min-height: 0;
    flex: 1;
    outline: none;
  }

  .git-commit-detail-file-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
    font: inherit;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: inherit;
    cursor: pointer;
  }

  .git-commit-detail-file-item:hover {
    background: var(--color-hover);
  }

  .git-commit-detail-file-item-selected {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  .git-commit-detail-file-status {
    flex-shrink: 0;
    width: 1.25rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-weight: 700;
    text-align: center;
  }

  .git-commit-detail-file-added {
    color: var(--color-diff-added);
  }

  .git-commit-detail-file-modified {
    color: var(--color-accent);
  }

  .git-commit-detail-file-deleted {
    color: var(--color-danger);
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
