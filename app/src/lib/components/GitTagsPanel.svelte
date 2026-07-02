<script lang="ts">
  import { confirm } from "@tauri-apps/plugin-dialog";
  import { reportGitError } from "../git/gitErrorUi";
  import {
    createTag,
    deleteLocalTag,
    GitRefValidationError,
    queryTags,
  } from "../git/gitService";
  import { validateGitRefName } from "../git/gitRefName";
  import type { VersionControlMutationScope } from "../git/versionControlRefresh";
  import { promptEntryName } from "../services/entryNamePrompt";

  interface Props {
    repoRoot: string;
    readOnly?: boolean;
    refreshToken?: number;
    onMutation?: (scope?: VersionControlMutationScope) => void | Promise<void>;
    notify?: (message: string) => void;
  }

  let {
    repoRoot,
    readOnly = false,
    refreshToken = 0,
    onMutation = () => {},
    notify = () => {},
  }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let tags = $state<string[]>([]);
  let loadError = $state<string | null>(null);
  let selectedTag = $state<string | null>(null);
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);

  const canDelete = $derived(selectedTag !== null && !actionBusy && !readOnly);

  async function loadTags(root: string, signal?: AbortSignal): Promise<void> {
    loadStatus = "loading";
    loadError = null;
    tags = [];
    selectedTag = null;

    try {
      const rows = await queryTags(root);
      if (signal?.aborted) {
        return;
      }
      tags = rows;
      selectedTag = rows[0] ?? null;
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
    void token;
    const controller = new AbortController();
    void loadTags(root, controller.signal);
    return () => {
      controller.abort();
    };
  });

  function selectTag(name: string): void {
    selectedTag = name;
  }

  function handleRowKeydown(event: KeyboardEvent, name: string): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectTag(name);
    }
  }

  async function handleCreateTag(): Promise<void> {
    if (actionBusy || readOnly) {
      return;
    }

    const name = await promptEntryName({
      title: "Create tag",
      defaultValue: "",
      confirmLabel: "Create",
    });
    if (!name) {
      return;
    }

    const validation = validateGitRefName(name);
    if (!validation.ok) {
      actionError = validation.message;
      return;
    }

    actionBusy = true;
    actionError = null;

    try {
      await createTag(repoRoot, name);
      selectedTag = name.trim();
      await loadTags(repoRoot);
      await onMutation("tag");
    } catch (error) {
      if (error instanceof GitRefValidationError) {
        actionError = error.message;
      } else {
        actionError = reportGitError(error, { operation: "Create tag", repoRoot, notify });
      }
    } finally {
      actionBusy = false;
    }
  }

  async function handleDeleteTag(): Promise<void> {
    if (!selectedTag || actionBusy) {
      return;
    }

    const confirmed = await confirm(
      `Delete local tag "${selectedTag}"? This removes the tag locally only; remote tags are not affected.`,
      {
        title: "Delete tag",
        okLabel: "Delete",
        cancelLabel: "Cancel",
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }

    actionBusy = true;
    actionError = null;

    try {
      await deleteLocalTag(repoRoot, selectedTag);
      await loadTags(repoRoot);
      await onMutation("tag");
    } catch (error) {
      actionError = reportGitError(error, { operation: "Delete tag", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }
</script>

<div class="git-tags-panel" aria-label="Tags">
  <div class="git-tags-toolbar">
    <button
      type="button"
      class="git-tags-action"
      disabled={actionBusy || readOnly}
      title={readOnly ? "Tag creation is unavailable for bare repositories" : "Create a new tag"}
      onclick={handleCreateTag}
    >
      {actionBusy ? "Working…" : "Create tag"}
    </button>
    <button
      type="button"
      class="git-tags-action"
      disabled={!canDelete}
      title={selectedTag ? `Delete ${selectedTag}` : "Select a tag to delete"}
      onclick={handleDeleteTag}
    >
      Delete tag
    </button>
  </div>

  {#if actionError}
    <p class="git-tags-action-error" role="alert">{actionError}</p>
  {/if}

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
      <p class="git-tags-state-detail">Create a tag at the current commit.</p>
    </div>
  {:else}
    <ul class="git-tags-list" role="listbox" aria-label="Tags">
      {#each tags as tag (tag)}
        <li class="git-tags-item">
          <button
            type="button"
            class="git-tags-row"
            class:git-tags-row-selected={selectedTag === tag}
            role="option"
            aria-selected={selectedTag === tag}
            onclick={() => selectTag(tag)}
            onkeydown={(event) => handleRowKeydown(event, tag)}
          >
            <span class="git-tags-name" title={tag}>{tag}</span>
          </button>
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
    cursor: pointer;
  }

  .git-tags-action:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .git-tags-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .git-tags-action-error {
    margin: 0;
    padding: 0 var(--space-12);
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
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
  }

  .git-tags-row {
    display: block;
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

  .git-tags-row:hover {
    background: var(--color-surface-2);
  }

  .git-tags-row:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .git-tags-row-selected {
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
    border-left-color: var(--color-accent);
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
