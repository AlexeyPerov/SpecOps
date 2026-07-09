<script lang="ts">
  import { reportGitError } from "../git/gitErrorUi";
  import { formatWorkingTreeDiffSubtitle, formatWorkingTreeDiffSubtitleHelp, formatWorkingTreeStatusCode } from "../git/gitStatusFormat";
  import {
    createCommit,
    GitCommitValidationError,
    GitDiffTooLargeError,
    isGitCommandCancelledError,
    isGitCommandTimedOutError,
    queryWorkingTreeFileDiff,
    queryWorkingTreeStatus,
    stageAll,
    stagePaths,
    unstagePaths,
  } from "../git/gitService";
  import type { ParsedTextDiff, WorkingTreeDiffSource, WorkingTreeFileEntry } from "../git/types";
  import type { VersionControlMutationScope } from "../git/versionControlRefresh";
  import {
    findWorkingTreeEntryForDiff,
    resolveWorkingTreeDiffSelection,
  } from "../git/workingTreeDiffSelection";
  import type { SaveDocumentDeps } from "../services/documentSave";
  import { prepareWorkspaceForGitOperation } from "../services/preGitOperationGuard";
  import { shouldRunAutosaveBeforeGitOperations } from "../git/gitIntegrationGating";
  import GitTextDiffView from "./GitTextDiffView.svelte";

  interface Props {
    repoRoot: string;
    workspaceRootPath: string;
    preGitSaveDeps?: SaveDocumentDeps | null;
    readOnly?: boolean;
    refreshToken?: number;
    onMutation?: (scope?: VersionControlMutationScope) => void | Promise<void>;
    onRemoteCommandChange?: (command: { id: string; label: string } | null) => void;
    notify?: (message: string) => void;
  }

  let {
    repoRoot,
    workspaceRootPath,
    preGitSaveDeps = null,
    readOnly = false,
    refreshToken = 0,
    onMutation = () => {},
    onRemoteCommandChange = () => {},
    notify = () => {},
  }: Props = $props();

  type LoadStatus = "idle" | "loading" | "ready" | "error";

  let loadStatus = $state<LoadStatus>("idle");
  let staged = $state<WorkingTreeFileEntry[]>([]);
  let unstaged = $state<WorkingTreeFileEntry[]>([]);
  let loadError = $state<string | null>(null);
  let selectedUnstaged = $state<Set<string>>(new Set());
  let selectedStaged = $state<Set<string>>(new Set());
  let commitMessage = $state("");
  let commitError = $state<string | null>(null);
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);
  let activeDiffPath = $state<string | null>(null);
  let activeDiffSource = $state<WorkingTreeDiffSource | null>(null);
  let fileDiff = $state<ParsedTextDiff | null>(null);
  let diffLoading = $state(false);
  let diffError = $state<string | null>(null);
  let statusVersion = $state(0);
  let lastLoadedRepoRoot = $state<string | null>(null);

  const hasStagedChanges = $derived(staged.length > 0);
  const activeDiffEntry = $derived.by(() => {
    if (!activeDiffPath || !activeDiffSource) {
      return null;
    }
    return findWorkingTreeEntryForDiff(activeDiffPath, activeDiffSource, unstaged, staged);
  });
  const activeDiffSubtitle = $derived.by(() => {
    if (!activeDiffSource) {
      return undefined;
    }
    return formatWorkingTreeDiffSubtitle(activeDiffSource, activeDiffEntry);
  });
  const activeDiffSubtitleHelp = $derived.by(() => {
    if (!activeDiffSource) {
      return undefined;
    }
    return formatWorkingTreeDiffSubtitleHelp(activeDiffSource, activeDiffEntry);
  });
  const canCommit = $derived(
    hasStagedChanges && !actionBusy && !readOnly && commitMessage.trim().length > 0,
  );
  const isClean = $derived(loadStatus === "ready" && staged.length === 0 && unstaged.length === 0);

  async function loadWorkingTreeStatus(
    root: string,
    options: { preserveDiffSelection?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<void> {
    const preserveDiffSelection = options.preserveDiffSelection ?? false;
    const priorPath = preserveDiffSelection ? activeDiffPath : null;
    const priorSource = preserveDiffSelection ? activeDiffSource : null;

    loadStatus = "loading";
    loadError = null;
    staged = [];
    unstaged = [];
    selectedUnstaged = new Set();
    selectedStaged = new Set();

    if (!preserveDiffSelection) {
      activeDiffPath = null;
      activeDiffSource = null;
      fileDiff = null;
      diffError = null;
      diffLoading = false;
    }

    try {
      const status = await queryWorkingTreeStatus(root);
      if (signal?.aborted) {
        return;
      }
      staged = status.staged;
      unstaged = status.unstaged;

      const resolved = resolveWorkingTreeDiffSelection({
        path: priorPath,
        source: priorSource,
        unstaged,
        staged,
      });
      activeDiffPath = resolved.path;
      activeDiffSource = resolved.source;
      loadStatus = "ready";
      statusVersion += 1;
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
    path: string,
    source: WorkingTreeDiffSource,
    signal?: AbortSignal,
  ): Promise<void> {
    diffLoading = true;
    diffError = null;
    fileDiff = null;

    try {
      const result = await queryWorkingTreeFileDiff(root, path, source);
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
          operation: "Load working tree diff",
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
    const token = refreshToken;
    void token;
    const preserveDiffSelection = lastLoadedRepoRoot === root;
    const controller = new AbortController();
    void loadWorkingTreeStatus(root, { preserveDiffSelection }, controller.signal).then(() => {
      if (!controller.signal.aborted) {
        lastLoadedRepoRoot = root;
      }
    });
    return () => {
      controller.abort();
    };
  });

  $effect(() => {
    const root = repoRoot;
    const path = activeDiffPath;
    const source = activeDiffSource;
    const version = statusVersion;
    void version;
    const controller = new AbortController();

    if (readOnly || loadStatus !== "ready" || !path || !source) {
      fileDiff = null;
      diffError = null;
      diffLoading = false;
      return () => {
        controller.abort();
      };
    }

    void loadFileDiff(root, path, source, controller.signal);
    return () => {
      controller.abort();
    };
  });

  async function refreshAfterAction(scope: VersionControlMutationScope = "stage"): Promise<void> {
    await onMutation(scope);
  }

  function toggleUnstaged(path: string, checked: boolean): void {
    const next = new Set(selectedUnstaged);
    if (checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    selectedUnstaged = next;
  }

  function toggleStaged(path: string, checked: boolean): void {
    const next = new Set(selectedStaged);
    if (checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    selectedStaged = next;
  }

  function selectForDiff(path: string, source: WorkingTreeDiffSource): void {
    activeDiffPath = path;
    activeDiffSource = source;
  }

  function isDiffRowActive(path: string, source: WorkingTreeDiffSource): boolean {
    return activeDiffPath === path && activeDiffSource === source;
  }

  async function handleStageSelected(): Promise<void> {
    if (selectedUnstaged.size === 0 || actionBusy || readOnly) {
      return;
    }
    actionBusy = true;
    actionError = null;
    try {
      const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
        enabled: shouldRunAutosaveBeforeGitOperations(),
        deps: preGitSaveDeps,
      });
      if (!canProceed) {
        return;
      }

      await stagePaths(repoRoot, [...selectedUnstaged]);
      await refreshAfterAction();
    } catch (error) {
      actionError = reportGitError(error, { operation: "Stage", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleStageAll(): Promise<void> {
    if (unstaged.length === 0 || actionBusy || readOnly) {
      return;
    }
    actionBusy = true;
    actionError = null;
    try {
      const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
        enabled: shouldRunAutosaveBeforeGitOperations(),
        deps: preGitSaveDeps,
      });
      if (!canProceed) {
        return;
      }

      await stageAll(repoRoot);
      await refreshAfterAction();
    } catch (error) {
      actionError = reportGitError(error, { operation: "Stage all", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleUnstageSelected(): Promise<void> {
    if (selectedStaged.size === 0 || actionBusy || readOnly) {
      return;
    }
    actionBusy = true;
    actionError = null;
    try {
      const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
        enabled: shouldRunAutosaveBeforeGitOperations(),
        deps: preGitSaveDeps,
      });
      if (!canProceed) {
        return;
      }

      await unstagePaths(repoRoot, [...selectedStaged]);
      await refreshAfterAction();
    } catch (error) {
      actionError = reportGitError(error, { operation: "Unstage", repoRoot, notify });
    } finally {
      actionBusy = false;
    }
  }

  async function handleCommit(): Promise<void> {
    commitError = null;
    const trimmed = commitMessage.trim();
    if (!trimmed) {
      commitError = "Commit message cannot be empty.";
      return;
    }
    if (!hasStagedChanges || actionBusy || readOnly) {
      return;
    }

    actionBusy = true;
    actionError = null;
    const commandId = crypto.randomUUID();
    onRemoteCommandChange({ id: commandId, label: "Commit" });

    try {
      const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
        enabled: shouldRunAutosaveBeforeGitOperations(),
        deps: preGitSaveDeps,
      });
      if (!canProceed) {
        return;
      }

      await createCommit(repoRoot, trimmed, { commandId });
      commitMessage = "";
      commitError = null;
      await refreshAfterAction("commit");
    } catch (error) {
      if (error instanceof GitCommitValidationError) {
        commitError = error.message;
      } else if (isGitCommandCancelledError(error)) {
        notify("Commit cancelled.");
      } else if (isGitCommandTimedOutError(error)) {
        actionError = reportGitError(error, { operation: "Commit", repoRoot, notify });
      } else {
        actionError = reportGitError(error, { operation: "Commit", repoRoot, notify });
      }
    } finally {
      actionBusy = false;
      onRemoteCommandChange(null);
    }
  }
</script>

<div class="git-changes-panel" aria-label="Working tree changes">
  {#if loadStatus === "loading"}
    <div class="git-changes-state" role="status" aria-live="polite">
      <p class="git-changes-state-title">Loading changes…</p>
    </div>
  {:else if loadStatus === "error"}
    <div class="git-changes-state" role="alert">
      <p class="git-changes-state-title">Could not load working tree status</p>
      {#if loadError}
        <p class="git-changes-state-detail">{loadError}</p>
      {/if}
    </div>
  {:else}
    {#if actionError}
      <p class="git-changes-action-error" role="alert">{actionError}</p>
    {/if}

    <div class="git-changes-main">
      <div class="git-changes-lists">
        <section class="git-changes-section" aria-labelledby="git-changes-unstaged-heading">
          <div class="git-changes-section-header">
            <h3
              id="git-changes-unstaged-heading"
              class="git-changes-section-title"
              title="Unstaged diffs compare the working tree to the last commit (HEAD), not the staging index."
            >
              Unstaged
            </h3>
            <div class="git-changes-section-actions">
              <button
                type="button"
                class="btn btn-secondary btn-compact"
                disabled={selectedUnstaged.size === 0 || actionBusy || readOnly}
                onclick={handleStageSelected}
              >
                Stage selected
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-compact"
                disabled={unstaged.length === 0 || actionBusy || readOnly}
                onclick={handleStageAll}
              >
                Stage all
              </button>
            </div>
          </div>
          {#if unstaged.length === 0}
            <p class="git-changes-empty">No unstaged changes.</p>
          {:else}
            <ul class="git-changes-list" role="list">
              {#each unstaged as entry (entry.path)}
                <li
                  class="git-changes-item"
                  class:git-changes-item-active={isDiffRowActive(entry.path, "unstaged")}
                >
                  <div
                    class="git-changes-row"
                    role="button"
                    tabindex="0"
                    onclick={() => selectForDiff(entry.path, "unstaged")}
                    onkeydown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectForDiff(entry.path, "unstaged");
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedUnstaged.has(entry.path)}
                      disabled={actionBusy || readOnly}
                      onclick={(event) => event.stopPropagation()}
                      onchange={(event) =>
                        toggleUnstaged(
                          entry.path,
                          (event.currentTarget as HTMLInputElement).checked,
                        )}
                    />
                    <span
                      class="git-changes-status"
                      title={formatWorkingTreeStatusCode(entry.statusCode)}
                    >
                      {entry.statusCode.trim() || "?"}
                    </span>
                    <span class="git-changes-path" title={entry.path}>{entry.path}</span>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="git-changes-section" aria-labelledby="git-changes-staged-heading">
          <div class="git-changes-section-header">
            <h3 id="git-changes-staged-heading" class="git-changes-section-title">Staged</h3>
            <div class="git-changes-section-actions">
              <button
                type="button"
                class="btn btn-secondary btn-compact"
                disabled={selectedStaged.size === 0 || actionBusy || readOnly}
                onclick={handleUnstageSelected}
              >
                Unstage selected
              </button>
            </div>
          </div>
          {#if staged.length === 0}
            <p class="git-changes-empty">No staged changes.</p>
          {:else}
            <ul class="git-changes-list" role="list">
              {#each staged as entry (entry.path)}
                <li
                  class="git-changes-item"
                  class:git-changes-item-active={isDiffRowActive(entry.path, "staged")}
                >
                  <div
                    class="git-changes-row"
                    role="button"
                    tabindex="0"
                    onclick={() => selectForDiff(entry.path, "staged")}
                    onkeydown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectForDiff(entry.path, "staged");
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedStaged.has(entry.path)}
                      disabled={actionBusy || readOnly}
                      onclick={(event) => event.stopPropagation()}
                      onchange={(event) =>
                        toggleStaged(entry.path, (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span
                      class="git-changes-status"
                      title={formatWorkingTreeStatusCode(entry.statusCode)}
                    >
                      {entry.statusCode.trim() || "?"}
                    </span>
                    <span class="git-changes-path" title={entry.path}>{entry.path}</span>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>

      <div class="git-changes-diff-pane" aria-label="File diff">
        {#if readOnly}
          <p class="git-changes-diff-readonly-banner" role="status">
            Diff preview is unavailable in read-only repositories.
          </p>
        {/if}
        <GitTextDiffView
          diff={readOnly ? null : fileDiff}
          title={activeDiffPath ?? undefined}
          subtitle={readOnly ? undefined : activeDiffSubtitle}
          subtitleHelp={readOnly ? undefined : activeDiffSubtitleHelp}
          loading={!readOnly && diffLoading}
          error={readOnly ? null : diffError}
        />
      </div>
    </div>

    <section class="git-changes-commit" aria-labelledby="git-changes-commit-heading">
      <h3 id="git-changes-commit-heading" class="git-changes-section-title">Commit</h3>
      {#if isClean}
        <p class="git-changes-clean-note" role="status">Working tree clean — nothing to commit.</p>
      {/if}
      <label class="git-changes-commit-label" for="git-changes-message">Message</label>
      <textarea
        id="git-changes-message"
        class="git-changes-message"
        class:git-changes-message-invalid={commitError !== null}
        bind:value={commitMessage}
        disabled={actionBusy || readOnly}
        rows={4}
        placeholder="Describe your changes…"
        aria-invalid={commitError !== null}
        aria-describedby={commitError ? "git-changes-commit-error" : undefined}
      ></textarea>
      {#if commitError}
        <p id="git-changes-commit-error" class="git-changes-commit-error" role="alert">
          {commitError}
        </p>
      {/if}
      <button
        type="button"
        class="btn btn-primary git-changes-commit-button"
        disabled={!canCommit}
        onclick={handleCommit}
      >
        {actionBusy ? "Committing…" : "Commit"}
      </button>
    </section>
  {/if}
</div>

<style>
  .git-changes-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: var(--space-6) var(--space-8);
    box-sizing: border-box;
  }

  .git-changes-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-3);
    color: var(--color-text-secondary);
  }

  .git-changes-state-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-changes-state-detail {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .git-changes-action-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .git-changes-main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(200px, 0.42fr) minmax(300px, 1fr);
    gap: var(--space-4);
    align-items: stretch;
  }

  @media (max-width: 720px) {
    .git-changes-main {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(240px, 1fr);
    }
  }

  .git-changes-lists {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    overflow-y: auto;
  }

  .git-changes-diff-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-1);
  }

  .git-changes-diff-readonly-banner {
    flex-shrink: 0;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-danger, #c0392b) 8%, var(--color-surface-1));
  }

  .git-changes-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .git-changes-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .git-changes-section-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .git-changes-section-actions {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .git-changes-empty {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .git-changes-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .git-changes-item + .git-changes-item {
    border-top: 1px solid var(--color-border-subtle);
  }

  .git-changes-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    font-size: 0.875rem;
    border: none;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .git-changes-row:hover {
    background: var(--color-surface-2);
  }

  .git-changes-item-active .git-changes-row {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  .git-changes-status {
    flex-shrink: 0;
    min-width: 1.5rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .git-changes-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
  }

  .git-changes-commit {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
  }

  .git-changes-clean-note {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .git-changes-commit-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .git-changes-message {
    width: 100%;
    min-height: 5rem;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text);
    font: inherit;
    resize: vertical;
  }

  .git-changes-message-invalid {
    border-color: var(--color-danger, #c0392b);
  }

  .git-changes-commit-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .git-changes-commit-button {
    align-self: flex-start;
    padding: var(--space-3) var(--space-6);
    font-size: 0.875rem;
  }
</style>
