<script lang="ts">
  import type { CommitFileChange } from "../git/types";

  let { files, selectedPath = null, onSelect }: {
    files: CommitFileChange[];
    selectedPath?: string | null;
    onSelect: (path: string) => void;
  } = $props();
  let filter = $state("");
  let descending = $state(false);
  let tree = $state(false);
  const visibleFiles = $derived(files.filter(file =>
    `${file.path} ${file.previousPath ?? ""}`.toLowerCase().includes(filter.toLowerCase())
  ).sort((a, b) => (descending ? -1 : 1) * a.path.localeCompare(b.path)));
  const rows = $derived.by(() => {
    const directories = new Set<string>();
    const result: { key: string; label: string; depth: number; file?: CommitFileChange }[] = [];
    for (const file of visibleFiles) {
      const parts = file.path.split("/");
      if (tree) {
        for (let i = 1; i < parts.length; i++) {
          const directory = parts.slice(0, i).join("/");
          if (!directories.has(directory)) {
            directories.add(directory);
            result.push({ key: `directory:${directory}`, label: parts[i - 1], depth: i - 1 });
          }
        }
      }
      result.push({ key: `file:${file.path}`, label: tree && !file.previousPath ? parts.at(-1)! : fileDisplayPath(file), depth: tree ? parts.length - 1 : 0, file });
    }
    return result;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !visibleFiles.length) return;
    event.preventDefault();
    const index = visibleFiles.findIndex(file => file.path === selectedPath);
    const next = event.key === "Home" ? 0 : event.key === "End" ? visibleFiles.length - 1 :
      event.key === "ArrowDown" ? Math.min(index + 1, visibleFiles.length - 1) : Math.max(index - 1, 0);
    const path = visibleFiles[next].path;
    onSelect(path);
    const list = event.currentTarget as HTMLElement;
    Array.from(list.querySelectorAll<HTMLButtonElement>("[role=option]")).find(button => button.dataset.path === path)?.focus();
  }

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

<div class="git-commit-detail-file-pane">
  <h3 class="git-commit-detail-files-title">Changed files ({files.length})</h3>
  <div class="file-controls">
    <input aria-label="Filter changed files" placeholder="Filter files" bind:value={filter} />
    <button type="button" aria-label="Sort files by path" onclick={() => descending = !descending}>Path {descending ? "↓" : "↑"}</button>
    <button type="button" aria-label="Tree view" aria-pressed={tree} onclick={() => tree = !tree}>{tree ? "Tree" : "Flat"}</button>
  </div>
  {#if !visibleFiles.length}
    <p class="git-commit-detail-empty-files">{files.length ? "No matching files." : "No file changes in this commit."}</p>
  {:else}
    <ul class="git-commit-detail-file-list" role="listbox" aria-label="Changed files" tabindex="0" onkeydown={handleKeydown}>
      {#each rows as row (row.key)}
        <li role="presentation" style:padding-left={`${row.depth * 12}px`}>
          {#if row.file}
            {@const file = row.file}
            <button type="button" role="option" data-path={file.path}
              class="git-commit-detail-file-item"
              class:git-commit-detail-file-item-selected={selectedPath === file.path}
              aria-selected={selectedPath === file.path}
              tabindex={selectedPath === file.path ? 0 : -1}
              onclick={() => onSelect(file.path)}>
              <span class="git-commit-detail-file-status {fileStatusClass(file.status)}" title={fileStatusLabel(file)}>{file.status}</span>
              <span class="git-commit-detail-file-path" title={fileDisplayPath(file)}>{row.label}</span>
            </button>
          {:else}
            <span class="directory-label">{row.label}/</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .git-commit-detail-file-pane {
    height: 100%;
    box-sizing: border-box;
    flex-shrink: 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--color-border-subtle);
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
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
  .file-controls { display: flex; gap: 4px; margin-bottom: 6px; flex-wrap: wrap; }
  .file-controls input { flex: 1; min-width: 60px; width: 100px; }
  .file-controls input, .file-controls button { color: var(--color-text); background: var(--color-surface-2); border: 1px solid var(--color-border-subtle); font: inherit; font-size: 11px; }
  .directory-label { font-size: 12px; color: var(--color-text-secondary); }
</style>
