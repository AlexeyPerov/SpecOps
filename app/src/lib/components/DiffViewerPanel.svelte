<script lang="ts">
  import {
    getSessionDiffs,
    refreshSessionDiffs,
  } from "../ai/opencodeDiffStore";
  import {
    diffStatusBadgeLabel,
    filterSessionDiffs,
    parseSessionDiffs,
    splitDiffFilePath,
    summarizeSessionDiffs,
    type DiffStatusFilter,
  } from "../ai/chatDiffParser";
  import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";
  import DiffViewer from "./DiffViewer.svelte";

  /**
   * M5-T2 — session diff viewer. File list sidebar (filterable by
   * added/deleted/modified) + a unified/split diff view of the selected
   * file. Reads the reactive `session.diff` store; the parent (AppShell)
   * drives refresh.
   */
  interface Props {
    workspaceRootPath: string;
    sessionId: string;
    onOpenFile?: (filePath: string) => void;
  }

  let {
    workspaceRootPath,
    sessionId,
    onOpenFile,
  }: Props = $props();

  // Derive the store from the live props (a fresh Readable is returned per
  // workspace-root + session-id pair) and subscribe in a second `$derived`.
  // The previous `const store = …` captured the initial prop values and
  // tripped svelte-check's `state_referenced_locally` warning.
  const store = $derived(getSessionDiffs(workspaceRootPath, sessionId));
  const diffState = $derived($store);

  let statusFilter = $state<DiffStatusFilter>("all");
  let selectedFile = $state<string | null>(null);
  let view = $state<"unified" | "split">("unified");

  const filteredFiles = $derived(filterSessionDiffs(diffState.files, statusFilter));
  const totals = $derived(summarizeSessionDiffs(diffState.files));
  const parsed = $derived(parseSessionDiffs(filteredFiles));
  const selectedParsed = $derived(
    selectedFile ? parsed.find((entry) => entry.file.file === selectedFile) : parsed[0],
  );

  const FILTERS: ReadonlyArray<{ value: DiffStatusFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "modified", label: "Modified" },
    { value: "added", label: "Added" },
    { value: "deleted", label: "Deleted" },
  ];

  function statusClass(status: OpencodeFileChangeStatus): string {
    return `diff-file-status-${status}`;
  }

  function handleRefresh(): void {
    void refreshSessionDiffs({ workspaceRootPath, sessionId });
  }

  function handleSelect(file: string): void {
    selectedFile = file;
  }
</script>

<section class="diff-panel" aria-label="Session file changes">
  <header class="diff-header">
    <div class="diff-header-title">
      <h2>Changes</h2>
      {#if totals.files > 0}
        <span class="diff-totals" title={`${totals.additions} additions, ${totals.deletions} deletions`}>
          <span class="diff-totals-add">+{totals.additions}</span>
          <span class="diff-totals-del">−{totals.deletions}</span>
        </span>
      {/if}
    </div>
    <div class="diff-header-controls">
      <div class="diff-segmented" role="group" aria-label="Diff view mode">
        <button
          type="button"
          class:diff-segmented-active={view === "unified"}
          aria-pressed={view === "unified"}
          onclick={() => (view = "unified")}
        >Unified</button>
        <button
          type="button"
          class:diff-segmented-active={view === "split"}
          aria-pressed={view === "split"}
          onclick={() => (view = "split")}
        >Split</button>
      </div>
      <button
        type="button"
        class="toolbar-button diff-refresh"
        onclick={handleRefresh}
        disabled={diffState.status === "loading"}
      >
        {diffState.status === "loading" ? "Loading…" : "Refresh"}
      </button>
    </div>
  </header>

  <div class="diff-body">
    <aside class="diff-file-list" aria-label="Changed files">
      <div class="diff-filters">
        {#each FILTERS as filterOption (filterOption.value)}
          <button
            type="button"
            class="diff-filter"
            class:diff-filter-active={statusFilter === filterOption.value}
            aria-pressed={statusFilter === filterOption.value}
            onclick={() => (statusFilter = filterOption.value)}
          >{filterOption.label}</button>
        {/each}
      </div>

      {#if diffState.status === "error"}
        <p class="diff-empty diff-error" role="alert">{diffState.lastErrorMessage}</p>
      {:else if diffState.status === "loading" && diffState.files.length === 0}
        <p class="diff-empty">Loading changes…</p>
      {:else if filteredFiles.length === 0}
        <p class="diff-empty">
          {diffState.status === "loaded" ? "No file changes in this session." : ""}
        </p>
      {:else}
        <ul class="diff-files">
          {#each filteredFiles as file (file.file)}
            {@const parts = splitDiffFilePath(file.file)}
            <li>
              <button
                type="button"
                class={`diff-file ${selectedFile === file.file ? "diff-file-selected" : ""}`}
                onclick={() => handleSelect(file.file)}
                ondblclick={() => onOpenFile?.(file.file)}
                title={file.file}
              >
                <span class={`diff-file-badge ${statusClass(file.status)}`}>
                  {diffStatusBadgeLabel(file.status)}
                </span>
                <span class="diff-file-name">
                  <span class="diff-file-basename">{parts.basename || file.file}</span>
                  {#if parts.directory}
                    <span class="diff-file-dir">{parts.directory}</span>
                  {/if}
                </span>
                <span class="diff-file-counts">
                  <span class="diff-file-add">+{file.additions}</span>
                  <span class="diff-file-del">−{file.deletions}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <div class="diff-viewer">
      {#if selectedParsed}
        <div class="diff-viewer-filebar">
          <span class="diff-viewer-path" title={selectedParsed.file.file}>
            {selectedParsed.file.file || "(unknown file)"}
          </span>
          {#if onOpenFile}
            <button
              type="button"
              class="toolbar-button diff-viewer-open"
              onclick={() => onOpenFile(selectedParsed.file.file)}
              title="Open file"
            >Open</button>
          {/if}
        </div>
        <div class="diff-viewer-scroll">
          <DiffViewer rows={selectedParsed.rows} {view} />
        </div>
      {:else}
        <p class="diff-empty diff-viewer-empty">Select a file to view its diff.</p>
      {/if}
    </div>
  </div>
</section>

<style>
  .diff-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border-left: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .diff-header-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }

  .diff-header h2 {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
  }

  .diff-totals {
    display: inline-flex;
    gap: var(--space-3);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .diff-totals-add {
    color: var(--color-accent);
  }

  .diff-totals-del {
    color: var(--color-diff-removed);
  }

  .diff-header-controls {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }

  .diff-segmented {
    display: inline-flex;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .diff-segmented button {
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    padding: 2px var(--space-5);
    cursor: pointer;
  }

  .diff-segmented button.diff-segmented-active {
    background: var(--color-selection);
    color: var(--color-text-primary);
  }

  .diff-refresh {
    min-height: 24px;
    font-size: var(--font-size-sm);
  }

  .diff-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(200px, 280px) 1fr;
  }

  .diff-file-list {
    border-right: 1px solid var(--color-border-subtle);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .diff-filters {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    flex-wrap: wrap;
  }

  .diff-filter {
    border: 1px solid var(--color-border-subtle);
    background: transparent;
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-4);
    font-size: var(--font-size-xs);
    cursor: pointer;
  }

  .diff-filter-active {
    background: var(--color-selection);
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }

  .diff-empty {
    margin: 0;
    padding: var(--space-10) var(--space-4);
    text-align: center;
    color: var(--color-text-secondary);
    font-size: var(--font-size-md);
  }

  .diff-error {
    color: var(--color-error);
  }

  .diff-files {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .diff-file {
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
  }

  .diff-file:hover {
    background: var(--color-hover);
  }

  .diff-file-selected {
    background: var(--color-selection);
    border-color: var(--color-border-subtle);
  }

  .diff-file-badge {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-weight: 600;
    width: 16px;
    text-align: center;
  }

  .diff-file-status-added {
    color: var(--color-accent);
  }

  .diff-file-status-deleted {
    color: var(--color-diff-removed);
  }

  .diff-file-status-modified {
    color: var(--color-text-secondary);
  }

  .diff-file-name {
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .diff-file-basename {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-file-dir {
    font-size: 9px;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-file-counts {
    display: inline-flex;
    gap: var(--space-2);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 9px;
    flex-shrink: 0;
  }

  .diff-file-add {
    color: var(--color-accent);
  }

  .diff-file-del {
    color: var(--color-diff-removed);
  }

  .diff-viewer {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .diff-viewer-filebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .diff-viewer-path {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-viewer-open {
    min-height: 22px;
    font-size: var(--font-size-xs);
  }

  .diff-viewer-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-2) 0;
  }

  .diff-viewer-empty {
    padding: var(--space-12);
  }
</style>
