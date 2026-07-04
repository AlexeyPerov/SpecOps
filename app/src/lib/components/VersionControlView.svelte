<script lang="ts">
  import { confirm, message } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import GitCommitDetailPanel from "./GitCommitDetailPanel.svelte";
  import GitBranchesPanel from "./GitBranchesPanel.svelte";
  import GitChangesPanel from "./GitChangesPanel.svelte";
  import GitHistoryPanel from "./GitHistoryPanel.svelte";
  import GitTagsPanel from "./GitTagsPanel.svelte";
  import { notifyGitCancellation, reportGitError, isGitCancellationError } from "../git/gitErrorUi";
  import { gitInstallHint } from "../git/gitInstallHints";
  import {
    cancelGitCommand,
    fetchRemote,
    isWorkingTreeDirty,
    pullRemote,
    pushRemote,
    queryAheadBehind,
    queryCurrentBranch,
    queryRemotes,
    type RemoteOperationTarget,
  } from "../git/gitService";
  import type { AheadBehindCounts, CommitSummary, CurrentBranchInfo, GitRemote } from "../git/types";
  import { normalizeGitOutputPath } from "../git/types";
  import {
    mutationChangesHead,
    type VersionControlMutationScope,
  } from "../git/versionControlRefresh";
  import {
    canStartRemoteGitOperation,
    isRemoteGitOperationBusy,
    isVersionControlToolbarBusy,
  } from "../git/versionControlRemoteOps";
  import {
    initRepositoryAtWorkspaceRoot,
    probeVersionControlContext,
    workspaceUsesParentRepository,
  } from "../git/versionControlProbe";
  import {
    emptyRemoteSelection,
    readPersistedRemoteSelection,
    reconcileRemoteSelection,
    remoteOperationTarget,
    writePersistedRemoteSelection,
    type VersionControlRemoteSelection,
  } from "../git/versionControlRemoteSelection";
  import type { SaveDocumentDeps } from "../services/documentSave";
  import { prepareWorkspaceForGitOperation } from "../services/preGitOperationGuard";

  /**
   * Per-workspace version control view, rendered as a chrome-less editor-pane
   * view tab (kind "version-control"). Opened from the workspace context menu;
   * the active workspace root path is passed in so phase 2/3 panels can scope
   * git operations to it.
   */
  let {
    workspaceRootPath,
    windowId = "main",
    notify = () => {},
  }: {
    workspaceRootPath: string | null;
    windowId?: string;
    notify?: (message: string) => void;
  } = $props();

  const preGitSaveDeps = $derived.by((): SaveDocumentDeps | null => {
    if (!workspaceRootPath) {
      return null;
    }
    return { getWindowId: () => windowId, notify };
  });

  type Section = "history" | "branches" | "tags" | "changes";
  type ProbeStatus =
    | "loading"
    | "noWorkspace"
    | "gitUnavailable"
    | "notARepository"
    | "ready"
    | "error";
  type BranchHeaderStatus = "idle" | "loading" | "ready" | "error";

  const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
    { id: "history", label: "History" },
    { id: "branches", label: "Branches" },
    { id: "tags", label: "Tags" },
    { id: "changes", label: "Changes" },
  ];

  const REFRESH_DEBOUNCE_MS = 500;

  let activeSection = $state<Section>("history");
  let probeStatus = $state<ProbeStatus>("loading");
  let repoRoot = $state<string | null>(null);
  let isBareRepository = $state(false);
  let probeError = $state<string | null>(null);
  let initBusy = $state(false);
  let initError = $state<string | null>(null);
  let branchHeaderStatus = $state<BranchHeaderStatus>("idle");
  let currentBranch = $state<CurrentBranchInfo | null>(null);
  let aheadBehind = $state<AheadBehindCounts | null>(null);
  let branchHeaderError = $state<string | null>(null);
  let selectedCommitSha = $state<string | null>(null);
  let refreshBusy = $state(false);
  let fetchBusy = $state(false);
  let pullBusy = $state(false);
  let pushBusy = $state(false);
  let activeRemoteCommandId = $state<string | null>(null);
  let panelRemoteCommand = $state<{ id: string; label: string } | null>(null);
  let remoteCancelRequested = $state(false);
  let remotesLoading = $state(false);
  let remotes = $state<GitRemote[]>([]);
  let remoteSelection = $state<VersionControlRemoteSelection>(emptyRemoteSelection());
  let panelRefreshToken = $state(0);
  let lastRefreshAt = 0;

  const workspaceName = $derived.by(() => {
    if (!workspaceRootPath) {
      return "Workspace";
    }
    const normalized = workspaceRootPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? workspaceRootPath;
  });

  const installHint = $derived(gitInstallHint());

  const usesParentRepository = $derived.by(() => {
    if (probeStatus !== "ready" || !workspaceRootPath || !repoRoot) {
      return false;
    }
    return workspaceUsesParentRepository(workspaceRootPath, repoRoot);
  });

  const toolbarBusy = $derived(
    isVersionControlToolbarBusy({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading }),
  );

  const remoteOperationBusy = $derived(
    isRemoteGitOperationBusy({ fetchBusy, pullBusy, pushBusy }) || panelRemoteCommand !== null,
  );

  const cancellableRemoteCommandId = $derived(
    activeRemoteCommandId ?? panelRemoteCommand?.id ?? null,
  );

  const activeRemoteOperationLabel = $derived.by(() => {
    if (fetchBusy) {
      return "Fetch";
    }
    if (pullBusy) {
      return "Pull";
    }
    if (pushBusy) {
      return "Push";
    }
    if (panelRemoteCommand) {
      return panelRemoteCommand.label;
    }
    return "Remote operation";
  });

  const isReadOnlyRepository = $derived(isBareRepository);

  const selectedRemoteName = $derived(
    reconcileRemoteSelection(remoteSelection, remotes).remoteName,
  );

  const showRemotePicker = $derived(!isReadOnlyRepository && remotes.length > 0);

  const remoteActionsDisabled = $derived(
    toolbarBusy || remotesLoading || remotes.length === 0,
  );

  const remotePickerTitle = $derived.by(() => {
    if (remotesLoading) {
      return "Loading remotes…";
    }
    if (remotes.length === 0) {
      return "No remotes configured";
    }
    return "Remote for fetch, pull, and push";
  });

  const placeholderCopy = $derived.by(() => {
    return "Select a section.";
  });

  const branchHeaderLabel = $derived.by(() => {
    if (currentBranch?.isDetached) {
      return "HEAD";
    }
    return "Branch";
  });

  const branchDisplayName = $derived.by(() => {
    if (branchHeaderStatus === "loading") {
      return "…";
    }
    if (branchHeaderStatus === "error") {
      return "—";
    }
    if (!currentBranch) {
      return "—";
    }
    return currentBranch.name;
  });

  const branchTitle = $derived.by(() => {
    if (!currentBranch) {
      return "Current branch";
    }
    if (currentBranch.isDetached) {
      return `Detached HEAD at ${currentBranch.name}`;
    }
    if (currentBranch.upstream) {
      return `${currentBranch.name} tracks ${currentBranch.upstream}`;
    }
    return currentBranch.name;
  });

  const trackingSummary = $derived.by(() => {
    if (branchHeaderStatus !== "ready" || !currentBranch || currentBranch.isDetached) {
      return null;
    }
    if (!currentBranch.upstream) {
      return "No upstream";
    }
    if (!aheadBehind) {
      return null;
    }
    const parts: string[] = [];
    if (aheadBehind.ahead > 0) {
      parts.push(`${aheadBehind.ahead} ahead`);
    }
    if (aheadBehind.behind > 0) {
      parts.push(`${aheadBehind.behind} behind`);
    }
    if (parts.length === 0) {
      return "Up to date";
    }
    return parts.join(" · ");
  });

  function resetBranchHeader(): void {
    branchHeaderStatus = "idle";
    currentBranch = null;
    aheadBehind = null;
    branchHeaderError = null;
    selectedCommitSha = null;
  }

  function resetRemotePicker(): void {
    remotesLoading = false;
    remotes = [];
    remoteSelection = emptyRemoteSelection();
  }

  function buildRemoteOperationTarget(): RemoteOperationTarget | undefined {
    const target = remoteOperationTarget(remoteSelection, remotes);
    if (!target) {
      return undefined;
    }
    return {
      remoteName: target.remoteName,
      branchName: target.remoteBranch,
    };
  }

  async function loadRemotePicker(root: string, signal?: AbortSignal): Promise<void> {
    remotesLoading = true;
    try {
      const [remoteRows, persisted] = await Promise.all([
        queryRemotes(root),
        readPersistedRemoteSelection(root),
      ]);
      if (signal?.aborted) {
        return;
      }

      remotes = remoteRows;
      remoteSelection = reconcileRemoteSelection(persisted, remoteRows);
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      remotes = [];
      remoteSelection = emptyRemoteSelection();
      reportGitError(error, { operation: "Load remotes", repoRoot: root, notify });
    } finally {
      if (!signal?.aborted) {
        remotesLoading = false;
      }
    }
  }

  async function handleRemoteSelectionChange(event: Event): Promise<void> {
    const select = event.currentTarget as HTMLSelectElement;
    const nextRemoteName = select.value.trim() || null;
    if (nextRemoteName === selectedRemoteName) {
      return;
    }

    const nextSelection: VersionControlRemoteSelection = {
      remoteName: nextRemoteName,
      remoteBranch: null,
    };
    remoteSelection = nextSelection;

    if (!repoRoot) {
      return;
    }

    try {
      await writePersistedRemoteSelection(repoRoot, nextSelection);
    } catch (error) {
      reportGitError(error, {
        operation: "Save remote selection",
        repoRoot,
        notify,
      });
    }
  }

  function handleSelectCommit(commit: CommitSummary): void {
    selectedCommitSha = commit.sha;
  }

  async function refreshBranchHeader(root: string, signal?: AbortSignal): Promise<void> {
    branchHeaderStatus = "loading";
    branchHeaderError = null;
    currentBranch = null;
    aheadBehind = null;

    try {
      const branch = await queryCurrentBranch(root);
      if (signal?.aborted) {
        return;
      }

      currentBranch = branch;
      if (!branch.isDetached && branch.upstream) {
        aheadBehind = await queryAheadBehind(root);
        if (signal?.aborted) {
          return;
        }
      }

      branchHeaderStatus = "ready";
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      branchHeaderStatus = "error";
      branchHeaderError = error instanceof Error ? error.message : String(error);
    }
  }

  async function refreshProbe(
    signal?: AbortSignal,
    options?: { silent?: boolean; refreshBranchHeader?: boolean },
  ): Promise<void> {
    const root = workspaceRootPath;
    if (!root) {
      probeStatus = "noWorkspace";
      repoRoot = null;
      isBareRepository = false;
      probeError = null;
      initError = null;
      resetBranchHeader();
      resetRemotePicker();
      return;
    }

    const silent = options?.silent ?? false;
    const shouldRefreshBranchHeader = options?.refreshBranchHeader ?? !silent;

    if (!silent) {
      probeStatus = "loading";
      probeError = null;
      initError = null;
      resetBranchHeader();
    } else {
      probeError = null;
      initError = null;
    }

    try {
      const result = await probeVersionControlContext(root);
      if (signal?.aborted) {
        return;
      }

      switch (result.kind) {
        case "noWorkspace":
          probeStatus = "noWorkspace";
          repoRoot = null;
          isBareRepository = false;
          break;
        case "gitUnavailable":
          probeStatus = "gitUnavailable";
          repoRoot = null;
          isBareRepository = false;
          probeError = result.error;
          resetBranchHeader();
          resetRemotePicker();
          break;
        case "notARepository":
          probeStatus = "notARepository";
          repoRoot = null;
          isBareRepository = false;
          resetBranchHeader();
          resetRemotePicker();
          break;
        case "ready":
          probeStatus = "ready";
          repoRoot = result.repoRoot;
          isBareRepository = result.isBareRepository;
          await loadRemotePicker(result.repoRoot, signal);
          if (signal?.aborted) {
            return;
          }
          if (shouldRefreshBranchHeader) {
            await refreshBranchHeader(result.repoRoot, signal);
          }
          break;
      }
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      probeStatus = "error";
      repoRoot = null;
      isBareRepository = false;
      probeError = error instanceof Error ? error.message : String(error);
      resetBranchHeader();
      resetRemotePicker();
    }
  }

  $effect(() => {
    const root = workspaceRootPath;
    const controller = new AbortController();
    void refreshProbe(controller.signal);
    return () => {
      controller.abort();
    };
  });

  function selectSection(section: Section): void {
    activeSection = section;
  }

  async function openInstallLink(event: MouseEvent): Promise<void> {
    event.preventDefault();
    await openUrl(installHint.installUrl);
  }

  async function handleInitRepository(): Promise<void> {
    if (!workspaceRootPath || initBusy || probeStatus !== "notARepository") {
      return;
    }

    const confirmed = await confirm(
      `Initialize a new git repository at "${workspaceName}"? This creates a .git folder at the workspace root.`,
      {
        title: "Init repository",
        okLabel: "Init repository",
        cancelLabel: "Cancel",
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }

    initBusy = true;
    initError = null;

    try {
      const response = await initRepositoryAtWorkspaceRoot(workspaceRootPath);
      if (response.exitCode !== 0) {
        initError = response.stderr.trim() || `git init failed with exit code ${response.exitCode}`;
        return;
      }

      await refreshProbe();
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
    } finally {
      initBusy = false;
    }
  }

  async function refreshAfterMutation(
    scope: VersionControlMutationScope = "stage",
  ): Promise<void> {
    if (!repoRoot) {
      return;
    }
    if (mutationChangesHead(scope)) {
      selectedCommitSha = null;
    }
    panelRefreshToken += 1;
    await refreshBranchHeader(repoRoot);
  }

  function formatRepoRoot(path: string): string {
    return normalizeGitOutputPath(path);
  }

  function createGitCommandId(): string {
    return crypto.randomUUID();
  }

  function registerPanelRemoteCommand(command: { id: string; label: string } | null): void {
    panelRemoteCommand = command;
  }

  async function handleCancelRemoteOperation(): Promise<void> {
    if (!cancellableRemoteCommandId || remoteCancelRequested) {
      return;
    }

    remoteCancelRequested = true;
    try {
      const response = await cancelGitCommand(cancellableRemoteCommandId);
      if (response.outcome === "cancelled") {
        notifyGitCancellation(activeRemoteOperationLabel, {
          repoRoot: repoRoot ?? undefined,
          notify,
        });
      }
    } catch (error) {
      remoteCancelRequested = false;
      reportGitError(error, {
        operation: "Cancel",
        repoRoot: repoRoot ?? undefined,
        notify,
      });
    }
  }

  function handleRemoteOperationError(operation: string, error: unknown): void {
    if (isGitCancellationError(error)) {
      if (!remoteCancelRequested) {
        notifyGitCancellation(operation, { repoRoot: repoRoot ?? undefined, notify });
      }
      return;
    }
    reportGitError(error, { operation, repoRoot: repoRoot ?? undefined, notify });
  }

  async function handleFetch(): Promise<void> {
    if (
      !repoRoot ||
      !canStartRemoteGitOperation({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading })
    ) {
      return;
    }

    const commandId = createGitCommandId();
    activeRemoteCommandId = commandId;
    remoteCancelRequested = false;
    fetchBusy = true;

    try {
      await fetchRemote(repoRoot, buildRemoteOperationTarget(), { commandId });
      await refreshAfterMutation("fetch");
    } catch (error) {
      handleRemoteOperationError("Fetch", error);
    } finally {
      fetchBusy = false;
      activeRemoteCommandId = null;
      remoteCancelRequested = false;
    }
  }

  async function handlePull(): Promise<void> {
    if (
      !repoRoot ||
      !canStartRemoteGitOperation({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading })
    ) {
      return;
    }

    const commandId = createGitCommandId();
    activeRemoteCommandId = commandId;
    remoteCancelRequested = false;
    pullBusy = true;

    try {
      if (workspaceRootPath) {
        const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
          deps: preGitSaveDeps,
        });
        if (!canProceed) {
          return;
        }
      }

      const dirty = await isWorkingTreeDirty(repoRoot);
      if (dirty) {
        await message(
          "Pull is blocked while the working tree has uncommitted changes. Commit, stash, or discard your changes first.",
          {
            title: "Working tree not clean",
            kind: "warning",
          },
        );
        return;
      }

      await pullRemote(repoRoot, buildRemoteOperationTarget(), { commandId });
      await refreshAfterMutation("pull");
    } catch (error) {
      handleRemoteOperationError("Pull", error);
    } finally {
      pullBusy = false;
      activeRemoteCommandId = null;
      remoteCancelRequested = false;
    }
  }

  async function handlePush(): Promise<void> {
    if (
      !repoRoot ||
      !canStartRemoteGitOperation({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading })
    ) {
      return;
    }

    const commandId = createGitCommandId();
    activeRemoteCommandId = commandId;
    remoteCancelRequested = false;
    pushBusy = true;

    try {
      await pushRemote(repoRoot, buildRemoteOperationTarget(), { commandId });
      await refreshAfterMutation("push");
    } catch (error) {
      handleRemoteOperationError("Push", error);
    } finally {
      pushBusy = false;
      activeRemoteCommandId = null;
      remoteCancelRequested = false;
    }
  }

  async function handleRefresh(): Promise<void> {
    if (!workspaceRootPath || toolbarBusy) {
      return;
    }

    const now = Date.now();
    if (now - lastRefreshAt < REFRESH_DEBOUNCE_MS) {
      return;
    }
    lastRefreshAt = now;
    refreshBusy = true;

    const controller = new AbortController();
    try {
      await refreshProbe(controller.signal, { silent: true, refreshBranchHeader: false });
      if (controller.signal.aborted) {
        return;
      }

      if (probeStatus === "ready" && repoRoot) {
        panelRefreshToken += 1;
        await Promise.all([
          refreshBranchHeader(repoRoot, controller.signal),
          loadRemotePicker(repoRoot, controller.signal),
        ]);
      }
    } finally {
      refreshBusy = false;
    }
  }
</script>

<div
  class="version-control-view"
  role="tabpanel"
  aria-label={`Version control — ${workspaceName}`}
>
  {#if probeStatus === "loading"}
    <div class="version-control-empty" role="status" aria-live="polite">
      <p class="version-control-empty-title">Checking git repository…</p>
    </div>
  {:else if probeStatus === "noWorkspace"}
    <div class="version-control-empty" role="status">
      <p class="version-control-empty-title">No workspace selected</p>
      <p class="version-control-empty-body">
        Open or select a workspace folder to use version control.
      </p>
    </div>
  {:else if probeStatus === "gitUnavailable"}
    <div class="version-control-empty" role="status">
      <p class="version-control-empty-title">{installHint.title}</p>
      <p class="version-control-empty-body">{installHint.body}</p>
      {#if probeError}
        <p class="version-control-empty-detail">{probeError}</p>
      {/if}
      <a
        class="version-control-empty-link"
        href={installHint.installUrl}
        onclick={openInstallLink}
      >
        {installHint.installLinkLabel}
      </a>
    </div>
  {:else if probeStatus === "notARepository"}
    <div class="version-control-empty" role="status">
      <p class="version-control-empty-title">Not a git repository</p>
      <p class="version-control-empty-body">
        This workspace folder is not inside a git repository. Initialize a repository here, or open a
        folder that is already tracked by git.
      </p>
      <button
        type="button"
        class="version-control-init-button"
        disabled={initBusy}
        onclick={handleInitRepository}
      >
        {initBusy ? "Initializing…" : "Init repository"}
      </button>
      {#if initError}
        <p class="version-control-empty-error">{initError}</p>
      {/if}
    </div>
  {:else if probeStatus === "error"}
    <div class="version-control-empty" role="alert">
      <p class="version-control-empty-title">Could not check repository</p>
      <p class="version-control-empty-body">
        Version control could not probe git for this workspace.
      </p>
      {#if probeError}
        <p class="version-control-empty-error">{probeError}</p>
      {/if}
    </div>
  {:else}
    <header class="version-control-header" aria-label="Version control toolbar">
      <div class="version-control-header-status">
        <span class="version-control-branch" title={branchTitle}>
          <span class="version-control-branch-label">{branchHeaderLabel}</span>
          <span class="version-control-branch-name">{branchDisplayName}</span>
          {#if currentBranch?.isDetached}
            <span class="version-control-detached-badge">Detached</span>
          {/if}
        </span>
        {#if trackingSummary}
          <span class="version-control-tracking" title="Upstream tracking">
            {trackingSummary}
          </span>
        {/if}
        {#if branchHeaderError}
          <span class="version-control-branch-error" role="alert">{branchHeaderError}</span>
        {/if}
      </div>
      <div class="version-control-header-actions">
        {#if showRemotePicker}
          <label class="version-control-remote-picker">
            <span class="version-control-remote-picker-label">Remote</span>
            <select
              class="version-control-remote-select"
              disabled={toolbarBusy || remotesLoading}
              title={remotePickerTitle}
              value={selectedRemoteName ?? ""}
              onchange={handleRemoteSelectionChange}
            >
              {#each remotes as remote (remote.name)}
                <option value={remote.name}>{remote.name}</option>
              {/each}
            </select>
          </label>
        {:else if probeStatus === "ready" && !isReadOnlyRepository}
          <span class="version-control-remote-hint" title={remotePickerTitle}>No remotes</span>
        {/if}
        <button
          type="button"
          class="version-control-action"
          disabled={toolbarBusy}
          title="Refresh repository state"
          onclick={handleRefresh}
        >
          {refreshBusy ? "Refreshing…" : "Refresh"}
        </button>
        <button
          type="button"
          class="version-control-action"
          disabled={remoteActionsDisabled}
          title={remotes.length === 0 ? "Fetch (no remotes configured)" : "Fetch from selected remote"}
          onclick={handleFetch}
        >
          {fetchBusy ? "Fetching…" : "Fetch"}
        </button>
        <button
          type="button"
          class="version-control-action"
          disabled={remoteActionsDisabled || isReadOnlyRepository}
          title={isReadOnlyRepository
            ? "Pull is unavailable for bare repositories"
            : remotes.length === 0
              ? "Pull (no remotes configured)"
              : "Pull from selected remote"}
          onclick={handlePull}
        >
          {pullBusy ? "Pulling…" : "Pull"}
        </button>
        <button
          type="button"
          class="version-control-action"
          disabled={remoteActionsDisabled}
          title={remotes.length === 0 ? "Push (no remotes configured)" : "Push to selected remote"}
          onclick={handlePush}
        >
          {pushBusy ? "Pushing…" : "Push"}
        </button>
        {#if remoteOperationBusy}
          <button
            type="button"
            class="version-control-action version-control-action-cancel"
            disabled={remoteCancelRequested}
            title={`Cancel ${activeRemoteOperationLabel.toLowerCase()}`}
            onclick={handleCancelRemoteOperation}
          >
            {remoteCancelRequested ? "Cancelling…" : "Cancel"}
          </button>
        {/if}
      </div>
    </header>

    {#if usesParentRepository && repoRoot}
      <p class="version-control-scope-note" role="note">
        This workspace folder is inside the git repository at
        <span class="version-control-scope-path">{formatRepoRoot(repoRoot)}</span>. Version control
        actions apply to that repository — you do not need to initialize a new repository here.
      </p>
    {/if}

    {#if isBareRepository}
      <p class="version-control-scope-note version-control-readonly-note" role="note">
        This is a bare repository with no working tree. History and fetch are available; staging,
        committing, and other write actions are disabled.
      </p>
    {/if}

    {#if currentBranch?.isDetached}
      <p class="version-control-scope-note version-control-detached-note" role="note">
        You are in a detached HEAD state at
        <span class="version-control-scope-path">{currentBranch.name}</span>. You can browse history
        and check out a branch when the working tree is clean.
      </p>
    {/if}

    <div class="version-control-main">
      <div
        class="version-control-sidebar"
        role="tablist"
        aria-label="Version control sections"
      >
        <p class="version-control-title">{workspaceName}</p>
        {#each SECTIONS as section (section.id)}
          <button
            type="button"
            role="tab"
            class="version-control-tab"
            class:version-control-tab-active={activeSection === section.id}
            aria-selected={activeSection === section.id}
            onclick={() => selectSection(section.id)}
          >
            {section.label}
          </button>
        {/each}
      </div>

      <div
        class="version-control-body"
        class:version-control-body-flush={
          activeSection === "history" ||
          activeSection === "branches" ||
          activeSection === "tags" ||
          activeSection === "changes"
        }
        role="tabpanel"
        aria-label={SECTIONS.find((section) => section.id === activeSection)?.label ?? "Section"}
      >
        {#if activeSection === "history" && repoRoot}
          <div class="version-control-history-layout">
            <div class="version-control-history-list">
              <GitHistoryPanel
                repoRoot={repoRoot}
                refreshToken={panelRefreshToken}
                selectedSha={selectedCommitSha}
                onSelectCommit={handleSelectCommit}
              />
            </div>
            <div class="version-control-history-detail">
              <GitCommitDetailPanel
                repoRoot={repoRoot}
                sha={selectedCommitSha}
                refreshToken={panelRefreshToken}
                {notify}
              />
            </div>
          </div>
        {:else if activeSection === "branches" && repoRoot && workspaceRootPath}
          <GitBranchesPanel
            repoRoot={repoRoot}
            workspaceRootPath={workspaceRootPath}
            preGitSaveDeps={preGitSaveDeps}
            readOnly={isReadOnlyRepository}
            refreshToken={panelRefreshToken}
            onMutation={refreshAfterMutation}
            {notify}
          />
        {:else if activeSection === "tags" && repoRoot}
          <GitTagsPanel
            repoRoot={repoRoot}
            readOnly={isReadOnlyRepository}
            remoteOpBusy={toolbarBusy}
            refreshToken={panelRefreshToken}
            onMutation={refreshAfterMutation}
            onRemoteCommandChange={registerPanelRemoteCommand}
            {notify}
          />
        {:else if activeSection === "changes" && repoRoot && workspaceRootPath}
          <GitChangesPanel
            repoRoot={repoRoot}
            workspaceRootPath={workspaceRootPath}
            preGitSaveDeps={preGitSaveDeps}
            readOnly={isReadOnlyRepository}
            refreshToken={panelRefreshToken}
            onMutation={refreshAfterMutation}
            {notify}
          />
        {:else}
          <p class="version-control-placeholder">{placeholderCopy}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .version-control-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .version-control-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-4);
    max-width: 32rem;
    margin: 0 auto;
    padding: var(--space-12) var(--space-10);
    color: var(--color-text-secondary);
  }

  .version-control-empty-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .version-control-empty-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .version-control-empty-detail {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
  }

  .version-control-empty-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
  }

  .version-control-empty-link {
    align-self: flex-start;
    font-size: 0.875rem;
    color: var(--color-accent);
    text-decoration: none;
  }

  .version-control-empty-link:hover {
    text-decoration: underline;
  }

  .version-control-init-button {
    align-self: flex-start;
    padding: var(--space-2) var(--space-5);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .version-control-init-button:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .version-control-init-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .version-control-scope-note {
    flex-shrink: 0;
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-1));
  }

  .version-control-scope-path {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text);
  }

  .version-control-readonly-note {
    background: color-mix(in srgb, var(--color-danger, #c0392b) 8%, var(--color-surface-1));
  }

  .version-control-detached-note {
    background: color-mix(in srgb, var(--color-text-muted) 10%, var(--color-surface-1));
  }

  .version-control-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .version-control-header-status {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    flex: 1;
  }

  .version-control-branch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    font-size: 0.875rem;
  }

  .version-control-branch-label {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-branch-name {
    color: var(--color-text);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-control-detached-badge {
    flex-shrink: 0;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-text-muted) 14%, transparent);
    color: var(--color-text-secondary);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-tracking {
    flex-shrink: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .version-control-branch-error {
    font-size: 0.8125rem;
    color: var(--color-danger, #c0392b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-control-header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .version-control-remote-picker {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  .version-control-remote-picker-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-remote-select {
    min-width: 6.5rem;
    max-width: 10rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
  }

  .version-control-remote-select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .version-control-remote-hint {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .version-control-action {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .version-control-action:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .version-control-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .version-control-action-cancel {
    border-color: color-mix(in srgb, var(--color-danger, #c0392b) 35%, var(--color-border-subtle));
    color: var(--color-danger, #c0392b);
  }

  .version-control-action-cancel:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-danger, #c0392b) 10%, var(--color-surface-2));
  }

  .version-control-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .version-control-sidebar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4) var(--space-12);
    border-right: 1px solid var(--color-border-subtle);
    overflow-y: auto;
    width: 132px;
  }

  .version-control-title {
    margin: 0 0 var(--space-4);
    padding: 0 var(--space-4);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-control-tab {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .version-control-tab:hover {
    background: var(--color-surface-2);
  }

  .version-control-tab-active {
    background: var(--color-surface-2);
    font-weight: 600;
  }

  .version-control-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-10) var(--space-12) var(--space-12);
  }

  .version-control-body-flush {
    overflow: hidden;
    padding: 0;
  }

  .version-control-history-layout {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .version-control-history-list,
  .version-control-history-detail {
    min-width: 0;
    min-height: 0;
  }

  .version-control-history-list {
    flex: 1 1 45%;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .version-control-history-detail {
    flex: 1 1 55%;
  }

  @media (min-width: 56rem) {
    .version-control-history-layout {
      flex-direction: row;
    }

    .version-control-history-list {
      flex: 0 0 min(42%, 28rem);
      border-bottom: none;
      border-right: 1px solid var(--color-border-subtle);
    }

    .version-control-history-detail {
      flex: 1 1 auto;
    }
  }

  .version-control-placeholder {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }
</style>
