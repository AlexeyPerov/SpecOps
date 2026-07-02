<script lang="ts">
  import { queryTags } from "../git/gitService";

  interface Props {
    repoRoot: string;
    refreshToken?: number;
  }

  let { repoRoot, refreshToken = 0 }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let tags = $state<string[]>([]);
  let loadError = $state<string | null>(null);

  async function loadTags(root: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    tags = [];

    try {
      const rows = await queryTags(root);
      if (signal?.aborted) {
        return;
      }
      tags = rows;
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
    void loadTags(root, controller.signal);
    return () => {
      controller.abort();
    };
  });
</script>

<div class="git-tags-panel" aria-label="Tags">
  <div class="git-tags-toolbar">
    <button type="button" class="git-tags-action" disabled title="Create tag (phase 3)">
      Create tag
    </button>
    <button type="button" class="git-tags-action" disabled title="Delete tag (phase 3)">
      Delete tag
    </button>
  </div>

  {#if loadStatus === "loading"}
    <div class="git-tags-state" role="status" aria-live="polite">
      <p class="git-tags-state-title">Loading tags…</p>
    </div>
  {:else if loadStatus === "error"}
    <div class="git-tags-state" role="alert">
      <p class="git-tags-state-title">Could not load tags</p>
      {#if loadError}
        <p class="git-tags-state-detail">{loadError}</p>
      {/if}
    </div>
  {:else if tags.length === 0}
    <div class="git-tags-state" role="status">
      <p class="git-tags-state-title">No tags yet</p>
      <p class="git-tags-state-detail">This repository has no tags.</p>
    </div>
  {:else}
    <ul class="git-tags-list" role="list">
      {#each tags as tag (tag)}
        <li class="git-tags-item">
          <span class="git-tags-name" title={tag}>{tag}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .git-tags-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .git-tags-toolbar {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-12);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .git-tags-action {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: not-allowed;
    opacity: 0.55;
  }

  .git-tags-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-10) var(--space-12);
    color: var(--color-text-secondary);
  }

  .git-tags-state-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-tags-state-detail {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .git-tags-list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: var(--space-2) 0;
    list-style: none;
    overflow-y: auto;
  }

  .git-tags-item {
    margin: 0;
    padding: var(--space-4) var(--space-12);
    border-left: 2px solid transparent;
  }

  .git-tags-name {
    display: inline-block;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, #c9a227 18%, transparent);
    color: color-mix(in srgb, #c9a227 85%, var(--color-text));
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.5;
  }
</style>
