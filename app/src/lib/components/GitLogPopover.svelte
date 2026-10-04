<script lang="ts">
  import { onDestroy } from "svelte";
  import type { CommitSummary } from "../git/types";
  import { formatRelativeCommitDate, formatShortSha } from "../git/gitHistoryFormat";
  import {
    loadPathGitLog,
    PATH_GIT_LOG_PAGE_SIZE,
    workspaceRootForPath,
    type PathGitLogResult,
  } from "../services/pathGitLog";
  import { clampFixedOverlayPosition } from "./clampFixedOverlayPosition";

  /**
   * "Git Log" popup shown at the click point from the project-tree and tab
   * context menus: the recent commits touching one file or folder, with a
   * jump into Version Control for a commit. Read-only — it never runs a git
   * command that changes the repository.
   */

  interface Props {
    /** Opens Version Control for `repoRoot`, selecting `sha`. */
    onOpenCommit?: (sha: string, repoRoot: string) => void;
  }

  let { onOpenCommit }: Props = $props();

  interface GitLogTarget {
    path: string;
    isFile: boolean;
    label: string;
  }

  let popover = $state<{ x: number; y: number; target: GitLogTarget } | null>(null);
  let popoverEl = $state<HTMLDivElement | null>(null);
  let commits = $state<CommitSummary[]>([]);
  let repoRoot = $state<string | null>(null);
  let hasMore = $state(false);
  let loading = $state(false);
  let loadingMore = $state(false);
  let message = $state<string | null>(null);
  /** Guards against a slow response for a target the user already dismissed. */
  let requestId = 0;

  export function openGitLog(event: MouseEvent, target: GitLogTarget): void {
    event.preventDefault();
    closeGitLog();
    popover = { x: event.clientX, y: event.clientY, target };
    window.addEventListener("pointerdown", handlePointerDownOutside, true);
    window.addEventListener("keydown", handleKeyDown, true);
    void load(target);
  }

  export function closeGitLog(): void {
    popover = null;
    commits = [];
    repoRoot = null;
    hasMore = false;
    loading = false;
    loadingMore = false;
    message = null;
    requestId += 1;
    window.removeEventListener("pointerdown", handlePointerDownOutside, true);
    window.removeEventListener("keydown", handleKeyDown, true);
  }

  function describeFailure(result: Exclude<PathGitLogResult, { kind: "commits" }>): string {
    switch (result.kind) {
      case "disabled":
        return "Git integration is disabled in Settings → Version Control.";
      case "not_a_repository":
        return "Not inside a git repository.";
      default:
        return result.reason;
    }
  }

  async function load(target: GitLogTarget): Promise<void> {
    const workspaceRoot = workspaceRootForPath(target.path);
    if (!workspaceRoot) {
      message = "Open the containing workspace to read its history.";
      return;
    }
    const id = ++requestId;
    loading = true;
    message = null;
    const result = await loadPathGitLog({
      path: target.path,
      workspaceRoot,
      isFile: target.isFile,
    });
    if (id !== requestId) {
      return;
    }
    loading = false;
    if (result.kind !== "commits") {
      message = describeFailure(result);
      return;
    }
    commits = result.commits;
    repoRoot = result.repoRoot;
    hasMore = result.hasMore;
    if (commits.length === 0) {
      message = "No commits touch this path yet.";
    }
  }

  async function loadMore(): Promise<void> {
    const target = popover?.target;
    if (!target || loadingMore) {
      return;
    }
    const workspaceRoot = workspaceRootForPath(target.path);
    if (!workspaceRoot) {
      return;
    }
    const id = requestId;
    loadingMore = true;
    const result = await loadPathGitLog({
      path: target.path,
      workspaceRoot,
      isFile: target.isFile,
      skip: commits.length,
      limit: PATH_GIT_LOG_PAGE_SIZE,
    });
    if (id !== requestId) {
      return;
    }
    loadingMore = false;
    if (result.kind !== "commits") {
      message = describeFailure(result);
      return;
    }
    commits = [...commits, ...result.commits];
    hasMore = result.hasMore;
  }

  function handlePointerDownOutside(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Node && popoverEl?.contains(target)) {
      return;
    }
    closeGitLog();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (popover && event.key === "Escape") {
      event.preventDefault();
      closeGitLog();
    }
  }

  function handleSelectCommit(commit: CommitSummary): void {
    if (!repoRoot) {
      return;
    }
    onOpenCommit?.(commit.sha, repoRoot);
    closeGitLog();
  }

  onDestroy(() => {
    closeGitLog();
  });

  // Measure after mount and clamp so the popup stays inside the viewport.
  $effect(() => {
    const open = popover;
    const el = popoverEl;
    if (!open || !el) {
      return;
    }
    void commits;
    void message;
    const rect = el.getBoundingClientRect();
    const next = clampFixedOverlayPosition(open.x, open.y, rect.width, rect.height);
    if (next.x !== open.x || next.y !== open.y) {
      popover = { ...open, x: next.x, y: next.y };
    }
  });
</script>

{#if popover}
  <div
    bind:this={popoverEl}
    class="git-log-popover"
    style={`left:${popover.x}px; top:${popover.y}px;`}
    role="dialog"
    aria-label={`Git log for ${popover.target.label}`}
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    <header class="git-log-popover-header" title={popover.target.path}>
      <span class="git-log-popover-title">{popover.target.label}</span>
      <button
        class="git-log-popover-close"
        type="button"
        aria-label="Close git log"
        onclick={closeGitLog}
      >×</button>
    </header>

    {#if loading}
      <p class="git-log-popover-status">Loading history…</p>
    {:else if message}
      <p class="git-log-popover-status">{message}</p>
    {/if}

    {#if commits.length > 0}
      <ul class="git-log-popover-list">
        {#each commits as commit (commit.sha)}
          <li>
            <button
              class="git-log-popover-commit"
              type="button"
              title={`${commit.subject}\n${commit.authorName} · ${commit.sha}`}
              onclick={() => handleSelectCommit(commit)}
            >
              <span class="git-log-popover-subject">{commit.subject}</span>
              <span class="git-log-popover-meta">
                <span class="git-log-popover-sha">{formatShortSha(commit.sha)}</span>
                <span>{commit.authorName}</span>
                <span>{formatRelativeCommitDate(commit.authorTime)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if hasMore}
        <button
          class="git-log-popover-more"
          type="button"
          disabled={loadingMore}
          onclick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .git-log-popover {
    position: fixed;
    z-index: 1100;
    width: 360px;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-overlay);
  }

  .git-log-popover-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .git-log-popover-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .git-log-popover-close {
    flex: 0 0 auto;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    line-height: 1;
    padding: 0 var(--space-2);
    cursor: pointer;
  }

  .git-log-popover-close:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .git-log-popover-status {
    margin: 0;
    padding: var(--space-4) var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
  }

  .git-log-popover-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
  }

  .git-log-popover-commit {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
  }

  .git-log-popover-commit:hover {
    background: var(--color-hover);
  }

  .git-log-popover-subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .git-log-popover-meta {
    display: flex;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
  }

  .git-log-popover-meta > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .git-log-popover-sha {
    flex: 0 0 auto;
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .git-log-popover-more {
    flex: 0 0 auto;
    margin-top: var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-status);
    padding: var(--space-2);
    cursor: pointer;
  }

  .git-log-popover-more:hover:not(:disabled) {
    background: var(--color-hover);
  }

  .git-log-popover-more:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
