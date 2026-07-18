<script lang="ts" module>
  // Cross-mount probe cache: remembers when each workspace root was last
  // probed. The Version Control view re-mounts on every tab switch into it
  // (see EditorPaneContent {#if} chain), and without this cache the mount-time
  // $effect re-shells-out to git on every visit. The cache is consulted only
  // on mount; explicit user-initiated refreshes (panelRefreshToken bumps) and
  // workspace-root changes always re-probe regardless of the cache.
  const PROBE_CACHE_TTL_MS = 5000;
  const probeCacheByRoot = new Map<string, number>();

  /**
   * Returns true if `root` was probed within the TTL window. Callers should
   * still perform their own freshness check — this is a hint to skip redundant
   * mount-time probes, not a guarantee the cached data is still valid.
   */
  export function isVersionControlProbeCached(root: string): boolean {
    const last = probeCacheByRoot.get(root);
    if (last === undefined) {
      return false;
    }
    return Date.now() - last < PROBE_CACHE_TTL_MS;
  }

  /** Records that `root` was probed now. */
  export function markVersionControlProbePerformed(root: string): void {
    probeCacheByRoot.set(root, Date.now());
  }
</script>

<script lang="ts">
  import { confirm, message } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import GitCommitDetailPanel from "./GitCommitDetailPanel.svelte";
  import GitBranchesPanel from "./GitBranchesPanel.svelte";
  import GitChangesPanel from "./GitChangesPanel.svelte";
  import GitHistoryPanel from "./GitHistoryPanel.svelte";
  import GitStashesPanel from "./GitStashesPanel.svelte";
  import GitTagsPanel from "./GitTagsPanel.svelte";
  import { notifyGitCancellation, reportGitError, isGitCancellationError, formatGitErrorPrimaryMessage } from "../git/gitErrorUi";
  import { logDiagnostic } from "../services/logging";
  import { gitInstallHint } from "../git/gitInstallHints";
  import {
    applyStash,
    cancelGitCommand,
    createStash,
    fetchRemote,
    GitStashApplyConflictError,
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
    notifyVersionControlMutation,
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
  import { shouldRunAutosaveBeforeGitOperations } from "../git/gitIntegrationGating";
  import { promptLocalChangesPull } from "../services/localChangesPullPrompt";

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

  type Section = "history" | "branches" | "tags" | "stashes" | "changes";
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
    { id: "stashes", label: "Stashes" },
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
  let aheadBehindError = $state<string | null>(null);
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
  let probeGeneration = 0;
  let lastRefreshAt = 0;

  // Overflow-menu state for the de-densified toolbar (U3.3). Refresh, Fetch,
  // and the Remote <select> live behind a "…" popover; Pull and Push stay
  // inline as primary actions. Cancel appears inline only while a remote
  // operation is active.
  let overflowOpen = $state(false);
  let overflowEl = $state<HTMLDivElement | null>(null);
  let overflowButtonEl = $state<HTMLButtonElement | null>(null);
  let overflowRefreshEl = $state<HTMLButtonElement | null>(null);
  let overflowFetchEl = $state<HTMLButtonElement | null>(null);
  let overflowFocusIndex = $state(-1);

  const overflowButtons = $derived.by(() => {
    const buttons: HTMLButtonElement[] = [];
    if (overflowRefreshEl) {
      buttons.push(overflowRefreshEl);
    }
    if (overflowFetchEl) {
      buttons.push(overflowFetchEl);
    }
    return buttons;
  });

  function openOverflow(): void {
    if (overflowOpen) {
      return;
    }
    overflowOpen = true;
    overflowFocusIndex = -1;
    window.addEventListener("pointerdown", onOverflowPointerDown);
    window.addEventListener("keydown", onOverflowKeydown);
  }

  function closeOverflow(): void {
    if (!overflowOpen) {
      return;
    }
    overflowOpen = false;
    overflowFocusIndex = -1;
    window.removeEventListener("pointerdown", onOverflowPointerDown);
    window.removeEventListener("keydown", onOverflowKeydown);
  }

  function toggleOverflow(): void {
    if (overflowOpen) {
      closeOverflow();
    } else {
      openOverflow();
    }
  }

  function onOverflowPointerDown(event: PointerEvent): void {
    if (!overflowOpen) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && overflowEl?.contains(target)) {
      return;
    }
    if (target instanceof Node && overflowButtonEl?.contains(target)) {
      return;
    }
    closeOverflow();
  }

  function focusOverflowButton(index: number): void {
    overflowFocusIndex = index;
    const buttons = overflowButtons;
    if (index >= 0 && index < buttons.length) {
      buttons[index].focus();
    }
  }

  function onOverflowKeydown(event: KeyboardEvent): void {
    if (!overflowOpen) {
      return;
    }
    const buttons = overflowButtons;
    const count = buttons.length;
    const current = overflowFocusIndex;

    if (event.key === "Escape") {
      event.preventDefault();
      closeOverflow();
      overflowButtonEl?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (count === 0) {
        return;
      }
      const next = current < 0 ? 0 : current + 1;
      focusOverflowButton(next >= count ? 0 : next);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (count === 0) {
        return;
      }
      const next = current < 0 ? count - 1 : current - 1;
      focusOverflowButton(next < 0 ? count - 1 : next);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      if (count > 0) {
        focusOverflowButton(0);
      }
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      if (count > 0) {
        focusOverflowButton(count - 1);
      }
      return;
    }
  }

  // Closing the overflow menu when a remote operation starts keeps the
  // transient inline Cancel control visible.
  $effect(() => {
    if (remoteOperationBusy && overflowOpen) {
      closeOverflow();
    }
  });

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
    if (aheadBehindError) {
      return "Tracking unavailable";
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

  const trackingSummaryTitle = $derived.by(() => {
    if (aheadBehindError) {
      return aheadBehindError;
    }
    if (branchHeaderStatus !== "ready" || !currentBranch || currentBranch.isDetached) {
      return "Upstream tracking";
    }
    if (!currentBranch.upstream) {
      return "No upstream configured";
    }
    if (!aheadBehind) {
      return "Upstream tracking";
    }
    const parts: string[] = [];
    if (aheadBehind.ahead > 0) {
      parts.push(`${aheadBehind.ahead} ahead`);
    }
    if (aheadBehind.behind > 0) {
      parts.push(`${aheadBehind.behind} behind`);
    }
    if (parts.length === 0) {
      return "Up to date with upstream";
    }
    return parts.join(" · ");
  });

  function resetBranchHeader(): void {
    branchHeaderStatus = "idle";
    currentBranch = null;
    aheadBehind = null;
    aheadBehindError = null;
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
    aheadBehindError = null;
    currentBranch = null;
    aheadBehind = null;

    try {
      const branch = await queryCurrentBranch(root);
      if (signal?.aborted) {
        return;
      }

      currentBranch = branch;
      if (!branch.isDetached && branch.upstream) {
        try {
          aheadBehind = await queryAheadBehind(root);
          if (signal?.aborted) {
            return;
          }
        } catch (error) {
          if (signal?.aborted) {
            return;
          }
          aheadBehind = null;
          aheadBehindError = formatGitErrorPrimaryMessage(error);
        }
      }

      branchHeaderStatus = "ready";
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      branchHeaderStatus = "error";
      branchHeaderError = formatGitErrorPrimaryMessage(error);
    }
  }

  async function refreshProbe(
    signal?: AbortSignal,
    options?: { silent?: boolean; refreshBranchHeader?: boolean; generation?: number },
  ): Promise<void> {
    const root = workspaceRootPath;
    const generation = options?.generation;
    const isStale = (): boolean =>
      signal?.aborted === true ||
      (generation !== undefined && generation !== probeGeneration);
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
      if (isStale()) {
        return;
      }

      // Record a successful probe so a quick tab away-and-back within the TTL
      // does not re-shell-out to git. Covers all non-error outcomes (ready,
      // notARepository, gitUnavailable, noWorkspace) since each is a valid
      // resolution that doesn't need immediate re-probing.
      markVersionControlProbePerformed(root);

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
          if (isStale()) {
            return;
          }
          if (shouldRefreshBranchHeader) {
            await refreshBranchHeader(result.repoRoot, signal);
          }
          break;
      }
    } catch (error) {
      if (isStale()) {
        return;
      }
      probeStatus = "error";
      repoRoot = null;
      isBareRepository = false;
      probeError = formatGitErrorPrimaryMessage(error);
      void logDiagnostic({
        level: "warn",
        source: "frontend",
        message: "Version control probe failed",
        timestamp: new Date().toISOString(),
        metadata: {
          workspaceRootPath: root,
          operation: "probeVersionControlContext",
          error: probeError,
        },
      });
      resetBranchHeader();
      resetRemotePicker();
    }
  }

  $effect(() => {
    workspaceRootPath;
    probeGeneration += 1;
    const generation = probeGeneration;
    const controller = new AbortController();
    // Skip the mount-time probe if this root was probed very recently (e.g.
    // the user switched away and back within the TTL). Explicit refreshes via
    // panelRefreshToken still re-probe regardless of the cache. This avoids
    // re-shelling-out to git on every tab visit.
    if (workspaceRootPath && isVersionControlProbeCached(workspaceRootPath)) {
      return () => {
        controller.abort();
      };
    }
    void refreshProbe(controller.signal, { generation });
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
      notifyVersionControlMutation(workspaceRootPath, "branch");
    } catch (error) {
      initError = formatGitErrorPrimaryMessage(error);
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
    if (workspaceRootPath) {
      notifyVersionControlMutation(workspaceRootPath, scope);
    }
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

    let stashedRef: string | null = null;

    try {
      if (workspaceRootPath) {
        const canProceed = await prepareWorkspaceForGitOperation(workspaceRootPath, {
          enabled: shouldRunAutosaveBeforeGitOperations(),
          deps: preGitSaveDeps,
        });
        if (!canProceed) {
          return;
        }
      }

      const dirty = await isWorkingTreeDirty(repoRoot);
      if (dirty) {
        const choice = await promptLocalChangesPull();
        if (!choice || choice.type === "cancel") {
          return;
        }
        if (choice.type === "block") {
          await message(
            "Pull is blocked while the working tree has uncommitted changes. Commit or stash your changes in the Changes panel, then try again.",
            {
              title: "Working tree not clean",
              kind: "warning",
            },
          );
          return;
        }

        try {
          stashedRef = await createStash(repoRoot, "WIP before pull");
        } catch (error) {
          reportGitError(error, { operation: "Stash", repoRoot, notify });
          return;
        }
      }

      try {
        await pullRemote(repoRoot, buildRemoteOperationTarget(), { commandId });
      } catch (error) {
        if (stashedRef) {
          notify(
            "Pull failed. Your changes were stashed — apply the latest stash to restore them.",
          );
        }
        handleRemoteOperationError("Pull", error);
        return;
      }

      if (stashedRef) {
        try {
          await applyStash(repoRoot, stashedRef, true);
        } catch (error) {
          const detail = formatGitErrorPrimaryMessage(error);
          if (error instanceof GitStashApplyConflictError) {
            notify(
              `Pull succeeded, but stashed changes conflicted on apply. Resolve conflicts, then apply ${stashedRef} manually.`,
            );
          } else {
            notify(
              `Pull succeeded, but could not restore stashed changes: ${detail}. Apply ${stashedRef} manually if needed.`,
            );
          }
        }
      }

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
          <span
            class="version-control-tracking"
            class:version-control-tracking-error={aheadBehindError !== null}
            title={trackingSummaryTitle}
          >
            {trackingSummary}
          </span>
        {/if}
        {#if branchHeaderError}
          <span class="version-control-branch-error" role="alert">{branchHeaderError}</span>
        {/if}
      </div>
      <div class="version-control-header-actions">
        <span class="version-control-remote-indicator" title={remotePickerTitle}>
          {#if showRemotePicker}
            <span class="version-control-remote-indicator-label">Remote</span>
            <span class="version-control-remote-indicator-value">{selectedRemoteName ?? "—"}</span>
          {:else if probeStatus === "ready" && !isReadOnlyRepository}
            <span class="version-control-remote-indicator-value">No remotes</span>
          {/if}
        </span>
        <button
          type="button"
          class="btn btn-sm"
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
          class="btn btn-sm"
          disabled={remoteActionsDisabled}
          title={remotes.length === 0 ? "Push (no remotes configured)" : "Push to selected remote"}
          onclick={handlePush}
        >
          {pushBusy ? "Pushing…" : "Push"}
        </button>
        {#if remoteOperationBusy}
          <button
            type="button"
            class="btn btn-sm btn-sm-danger version-control-action-cancel"
            disabled={remoteCancelRequested}
            title={`Cancel ${activeRemoteOperationLabel.toLowerCase()}`}
            onclick={handleCancelRemoteOperation}
          >
            {remoteCancelRequested ? "Cancelling…" : "Cancel"}
          </button>
        {/if}
        <div class="version-control-overflow">
          <button
            type="button"
            class="btn btn-sm version-control-overflow-button"
            bind:this={overflowButtonEl}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            aria-label="More version control actions"
            title="Refresh, fetch, and remote selection"
            onclick={toggleOverflow}
          >
            <span class="version-control-overflow-glyph" aria-hidden="true">⋯</span>
          </button>
          {#if overflowOpen}
            <div
              class="version-control-overflow-menu"
              role="menu"
              tabindex="-1"
              aria-label="More version control actions"
              bind:this={overflowEl}
              onpointerdown={(event) => event.stopPropagation()}
            >
              {#if showRemotePicker}
                <label class="version-control-overflow-remote">
                  <span class="version-control-overflow-remote-label">Remote</span>
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
              {/if}
              <div class="ui-rule version-control-overflow-separator" role="separator"></div>
              <button
                type="button"
                class="version-control-overflow-item"
                role="menuitem"
                bind:this={overflowRefreshEl}
                disabled={toolbarBusy}
                title="Refresh repository state"
                onclick={() => {
                  closeOverflow();
                  void handleRefresh();
                }}
              >
                <span class="version-control-overflow-item-label">Refresh</span>
                <span class="version-control-overflow-item-hint">{refreshBusy ? "Refreshing…" : "Update state"}</span>
              </button>
              <button
                type="button"
                class="version-control-overflow-item"
                role="menuitem"
                bind:this={overflowFetchEl}
                disabled={remoteActionsDisabled}
                title={remotes.length === 0 ? "Fetch (no remotes configured)" : "Fetch from selected remote"}
                onclick={() => {
                  closeOverflow();
                  void handleFetch();
                }}
              >
                <span class="version-control-overflow-item-label">Fetch</span>
                <span class="version-control-overflow-item-hint">{fetchBusy ? "Fetching…" : remotes.length === 0 ? "No remotes" : "Download updates"}</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </header>

    {#if usesParentRepository && repoRoot}
      <p class="version-control-note" role="note">
        This workspace folder is inside the git repository at
        <span class="version-control-note-path">{formatRepoRoot(repoRoot)}</span>. Version control
        actions apply to that repository — you do not need to initialize a new repository here.
      </p>
    {/if}

    {#if isBareRepository}
      <p class="version-control-note version-control-note-danger" role="note">
        This is a bare repository with no working tree. History and fetch are available; staging,
        committing, and other write actions are disabled.
      </p>
    {/if}

    {#if currentBranch?.isDetached}
      <p class="version-control-note" role="note">
        You are in a detached HEAD state at
        <span class="version-control-note-path">{currentBranch.name}</span>. You can browse history
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
          activeSection === "stashes" ||
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
        {:else if activeSection === "stashes" && repoRoot && workspaceRootPath}
          <GitStashesPanel
            repoRoot={repoRoot}
            workspaceRootPath={workspaceRootPath}
            preGitSaveDeps={preGitSaveDeps}
            readOnly={isReadOnlyRepository}
            refreshToken={panelRefreshToken}
            onMutation={refreshAfterMutation}
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
            onRemoteCommandChange={registerPanelRemoteCommand}
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
    color: var(--color-danger);
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

  /* Unified tinted note banner (U3.3). The view previously used three classes
     with different accent/danger/muted tints; they now collapse to one class
     with an optional severity modifier. */
  .version-control-note {
    flex-shrink: 0;
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-1));
  }

  .version-control-note-danger {
    background: color-mix(in srgb, var(--color-danger) 8%, var(--color-surface-1));
  }

  .version-control-note-path {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text);
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

  .version-control-tracking-error {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .version-control-branch-error {
    font-size: 0.8125rem;
    color: var(--color-danger);
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

  .version-control-remote-indicator {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    white-space: nowrap;
  }

  .version-control-remote-indicator-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-remote-indicator-value {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 9rem;
  }

  .version-control-remote-select {
    min-width: 100%;
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

  /* Overflow affordance (U3.3): "⋯" opens a popover holding the less-frequent
     remote actions (Refresh, Fetch) and the Remote <select>. Anchored under
     the trigger, dismisses on outside pointer / Escape. */
  .version-control-overflow {
    position: relative;
    display: inline-flex;
  }

  .version-control-overflow-button {
    min-width: 1.75rem;
    padding: var(--space-2) var(--space-3);
  }

  .version-control-overflow-glyph {
    font-size: 1rem;
    line-height: 1;
    letter-spacing: 0.02em;
  }

  .version-control-overflow-menu {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: var(--z-popover, 40);
    min-width: 14rem;
    padding: var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-popover);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .version-control-overflow-remote {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .version-control-overflow-remote-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-overflow-separator {
    margin: var(--space-1) 0;
  }

  .version-control-overflow-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .version-control-overflow-item:hover:not(:disabled),
  .version-control-overflow-item:focus-visible {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
    outline: none;
  }

  .version-control-overflow-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .version-control-overflow-item-label {
    font-size: var(--font-size-ui);
    color: var(--color-text-primary);
  }

  .version-control-overflow-item-hint {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  /* Cancel action keeps a danger-tinted border/hover on top of the shared
     .btn .btn-sm .btn-sm-danger base (U3.1). */
  .version-control-action-cancel {
    border-color: color-mix(in srgb, var(--color-danger) 35%, var(--color-border-subtle));
  }

  .version-control-action-cancel:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-danger) 10%, var(--color-surface-2));
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
