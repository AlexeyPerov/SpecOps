<script lang="ts" module>
  import { clearGitWorkspaceViewStateForTests } from "../git/gitWorkspaceViewState";
  import type { VersionControlProbeResult } from "../git/versionControlProbe";

  // Cross-mount probe cache: remembers the last probe *outcome* for each
  // workspace root. The Version Control view re-mounts on every tab switch into
  // it (see EditorPaneContent {#if} chain), and without this cache the
  // mount-time $effect re-shells-out to git on every visit. Explicit
  // user-initiated refreshes (panelRefreshToken bumps) and workspace-root
  // changes always re-probe regardless of the cache.
  //
  // The cached value is the result itself, not just a timestamp: a cache hit
  // still has to drive the same state transitions a fresh probe would, or the
  // view is left rendering its initial "loading" placeholder forever with no
  // in-view way to recover (the header with Refresh is not rendered in the
  // loading branch).
  const PROBE_CACHE_TTL_MS = 5000;
  const probeCacheByRoot = new Map<string, { at: number; result: VersionControlProbeResult }>();

  /**
   * Returns the cached probe result for `root` when it was probed within the TTL
   * window, otherwise null. Callers should still perform their own freshness
   * check — this is a hint to skip a redundant mount-time probe, not a guarantee
   * the cached data is still valid.
   */
  export function readCachedVersionControlProbe(root: string): VersionControlProbeResult | null {
    const entry = probeCacheByRoot.get(root);
    if (entry === undefined) {
      return null;
    }
    if (Date.now() - entry.at >= PROBE_CACHE_TTL_MS) {
      probeCacheByRoot.delete(root);
      return null;
    }
    return entry.result;
  }

  /** Records the outcome of a probe of `root` performed now. */
  export function markVersionControlProbePerformed(
    root: string,
    result: VersionControlProbeResult,
  ): void {
    probeCacheByRoot.set(root, { at: Date.now(), result });
  }

  /** Drops any cached probe outcome for `root` (used by tests). */
  export function clearVersionControlProbeCache(): void {
    probeCacheByRoot.clear();
    clearGitWorkspaceViewStateForTests();
  }
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { readGitWorkspaceViewState, saveGitWorkspaceViewState } from "../git/gitWorkspaceViewState";
  import GitPushDialog from "./GitPushDialog.svelte";
  import { executePushPlan, type PushPlan, type PushResult } from "../git/gitPush";
  import GitPullDialog from "./GitPullDialog.svelte";
  import { queryGitOperationState, recoverGitOperation, assertPullSnapshot, redactRemoteUrl, type PullOptions, type PullSnapshot, type GitOperationState } from "../git/gitPull";
  import DialogShell from "./DialogShell.svelte";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { openSettingsDialog } from "../services/settingsDialogUi";
  import { confirm, message } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import GitWorkspaceSplit from "./GitWorkspaceSplit.svelte";
  import GitCommitDetailPanel from "./GitCommitDetailPanel.svelte";
  import GitNavigationTree from "./GitNavigationTree.svelte";
  import type { NavigationNode } from "../git/gitNavigationTree";
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
    GitPullConflictError,
    GitStashApplyConflictError,
    isWorkingTreeDirty,
    pullRemote,
    queryAheadBehind,
    queryCurrentBranch,
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
  import { loadRemotes } from "../git/versionControlRemotesCache";
  import type { SaveDocumentDeps } from "../services/documentSave";
  import { prepareWorkspaceForGitOperation } from "../services/preGitOperationGuard";
  import { shouldRunAutosaveBeforeGitOperations } from "../git/gitIntegrationGating";
  import { promptLocalChangesPull } from "../services/localChangesPullPrompt";
  import {
    subscribeVersionControlCommitRequests,
    takePendingVersionControlCommit,
  } from "../services/versionControlNavigation";

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
    { id: "changes", label: "File Status" },
  ];

  const REFRESH_DEBOUNCE_MS = 500;

  let sidebarCollapsed = $state(false);
  const layoutScope = $derived(`specops.git-layout:${windowId}:${workspaceRootPath ?? ""}`);

  let navigationSelection = $state("history");
  let historyRevision = $state<string | null>(null);
  let actionSelection = $state<string | null>(null);

  let focusMessageToken = $state(0);
  let remoteDialog = $state<"Pull" | "Push" | null>(null);
  let pushController: AbortController | null = null;
  let pushDialogError = $state<string | null>(null);
  let pushResult = $state<PushResult | null>(null);
  let pullDialogError = $state<string | null>(null);
  let operationState = $state<GitOperationState | null>(null);
  let operationError = $state<string | null>(null);
  let dialogRoot = $state<string | null>(null);

  function openRemoteDialog(operation: "Pull" | "Push"): void {
    if (toolbarBusy || !repoRoot) return;
    pullDialogError = null;
    pushDialogError = null;
    pushResult = null;
    dialogRoot = repoRoot;
    remoteDialog = operation;
    closeOverflow();
  }
  async function openCommit(): Promise<void> {
    activeSection = "changes";
    navigationSelection = "changes";
    await tick();
    focusMessageToken += 1;
  }
  async function revealRepository(): Promise<void> {
    if (!repoRoot) return;
    try { await revealItemInDir(repoRoot); } catch (error) { reportGitError(error, { operation: "Show folder", repoRoot, notify }); }
  }

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
  let historyPanel = $state<{ jumpTo: (query: string) => Promise<void> }>();
  let selectedCommit = $state<CommitSummary | null>(null);
  let selectedCommitSha = $state<string | null>(null);
  let changesBusy = $state(false);
  let hasUncommittedChanges = $state(false);
  let uncommittedSelected = $state(false);
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
  /** Bumped by stage/unstage, which only change the working tree status. */
  let changesRefreshToken = $state(0);
  let probeGeneration = 0;
  let lastRefreshAt = 0;
  // AbortController for an in-flight manual Refresh. A new Refresh, a probe
  // generation change (workspace switch / remount), or component teardown
  // aborts the previous one so a late response from the older root can never
  // stamp `probeStatus`/`repoRoot`/`remotes` with stale data (M6). The
  // `refreshProbe` call also receives the generation captured at the start of
  // the refresh, so `refreshProbe`'s own staleness guard drops the result even
  // if the controller is never aborted.
  let remoteRefreshController: AbortController | null = null;
  let refreshController: AbortController | null = null;

  // Secondary actions stay keyboard-accessible when the toolbar is compact.
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
    return overflowEl ? Array.from(overflowEl.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter(button => {
      for (let element: HTMLElement | null = button; element && element !== overflowEl; element = element.parentElement) {
        if (getComputedStyle(element).display === "none") return false;
      }
      return true;
    }) : buttons;
  });

  function openOverflow(): void {
    if (overflowOpen) {
      return;
    }
    overflowOpen = true;
    overflowFocusIndex = -1;
  }

  function closeOverflow(): void {
    if (!overflowOpen) {
      return;
    }
    overflowOpen = false;
    overflowFocusIndex = -1;
  }

  // Window listeners are bound to `overflowOpen` via this effect so they are
  // removed both when the menu closes and when the component unmounts (e.g.
  // switching away from the Version Control view while the menu is open).
  $effect(() => {
    if (!overflowOpen) {
      return;
    }
    window.addEventListener("pointerdown", onOverflowPointerDown);
    window.addEventListener("keydown", onOverflowKeydown);
    return () => {
      window.removeEventListener("pointerdown", onOverflowPointerDown);
      window.removeEventListener("keydown", onOverflowKeydown);
    };
  });

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
    isVersionControlToolbarBusy({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading }) ||
      panelRemoteCommand !== null || changesBusy,
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

  const remoteBrowserUrl = $derived.by(() => {
    const url = remotes.find(remote => remote.name === selectedRemoteName)?.fetchUrl;
    if (!url) return null;
    try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href.replace(/\.git$/, "") : null; } catch { return null; }
  });

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
        // P03-08-09: shared remotes cache — a quick VC remount or a Tags panel
        // open reuses the same `git remote -v` result instead of re-shelling-out.
        loadRemotes(root),
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

  let ownedViewScope: string | null = null;
  let viewStateReadyScope = $state<string | null>(null);
  function saveOwnedView(): void {
    if (ownedViewScope && probeStatus === "ready") saveGitWorkspaceViewState(ownedViewScope, { view: { sidebarCollapsed, section: activeSection, navigation: navigationSelection, revision: historyRevision, action: actionSelection, selected: selectedCommitSha === selectedCommit?.sha ? $state.snapshot(selectedCommit) : null } });
  }
  onDestroy(saveOwnedView);
  $effect.pre(() => {
    const nextScope = layoutScope;
    untrack(() => {
      if (ownedViewScope !== nextScope) {
        saveOwnedView();
        viewStateReadyScope = null;
        changesBusy = false;
        hasUncommittedChanges = false;
        uncommittedSelected = false;
        panelRemoteCommand = null;
      }
      ownedViewScope = nextScope;
    });
  });

  $effect(() => {
    void selectedCommitSha; void selectedCommit; void activeSection; void navigationSelection;
    void historyRevision; void actionSelection; void sidebarCollapsed; void probeStatus;
    const readyScope = viewStateReadyScope;
    const scope = layoutScope;
    untrack(() => { if (scope === ownedViewScope && scope === readyScope) saveOwnedView(); });
  });

  function handleSelectCommit(commit: CommitSummary): void {
    uncommittedSelected = false;
    selectedCommit = commit;
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
    options?: {
      silent?: boolean;
      refreshBranchHeader?: boolean;
      generation?: number;
      /**
       * Pre-resolved probe outcome from the cross-mount cache. Skips the git
       * shell-out but runs the identical state transitions, so a cache hit can
       * never leave `probeStatus` stuck at its initial "loading" value.
       */
      cachedResult?: VersionControlProbeResult;
    },
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
      const result = options?.cachedResult ?? (await probeVersionControlContext(root));
      if (isStale()) {
        return;
      }

      // Record a successful probe so a quick tab away-and-back within the TTL
      // does not re-shell-out to git. Covers all non-error outcomes (ready,
      // notARepository, gitUnavailable, noWorkspace) since each is a valid
      // resolution that doesn't need immediate re-probing.
      markVersionControlProbePerformed(root, result);

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
          if (!options?.silent) untrack(() => {
            const saved = readGitWorkspaceViewState(layoutScope)?.view;
            if (saved) {
              sidebarCollapsed = saved.sidebarCollapsed; activeSection = saved.section; navigationSelection = saved.navigation;
              historyRevision = saved.revision; actionSelection = saved.action;
              selectedCommit = saved.selected; selectedCommitSha = saved.selected?.sha ?? null;
            }
          });
          viewStateReadyScope = layoutScope;
          // A commit handed over by the project-tree / tab "Git Log" popup:
          // land on it in History instead of the default view.
          {
            const handedOverSha = takePendingVersionControlCommit(result.repoRoot);
            if (handedOverSha) {
              activeSection = "history";
              historyRevision = null;
              navigationSelection = "history";
              selectedCommitSha = handedOverSha;
            }
          }
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

  // A commit handed over while this view is already mounted (its tab merely
  // re-focused, so no probe runs) still has to land.
  $effect(() => {
    return subscribeVersionControlCommitRequests(() => {
      const handedOverSha = takePendingVersionControlCommit(repoRoot);
      if (!handedOverSha) {
        return;
      }
      activeSection = "history";
      historyRevision = null;
      navigationSelection = "history";
      selectedCommitSha = handedOverSha;
    });
  });

  $effect(() => {
    workspaceRootPath;
    probeGeneration += 1;
    const generation = probeGeneration;
    const controller = new AbortController();
    // A workspace switch / remount supersedes any in-flight manual Refresh: its
    // result belongs to the previous root and must not overwrite the new
    // root's `probeStatus`/`repoRoot`/`remotes` (M6).
    abortInFlightRefresh();
    // Skip the git shell-out if this root was probed very recently (e.g. the
    // user switched away and back within the TTL) by replaying the cached
    // outcome instead. Explicit refreshes via panelRefreshToken always
    // re-probe. Replaying rather than returning early is what keeps
    // `probeStatus` from being stranded at "loading" on a cache hit.
    historyRevision = null;
    navigationSelection = "history";
    actionSelection = null;
    activeSection = "history";
    remoteDialog = null;
    const cachedResult = workspaceRootPath
      ? readCachedVersionControlProbe(workspaceRootPath)
      : null;
    void refreshProbe(controller.signal, {
      generation,
      ...(cachedResult ? { cachedResult } : {}),
    });
    return () => {
      controller.abort();
      remoteRefreshController?.abort();
    };
  });

  function abortInFlightRefresh(): void {
    if (refreshController) {
      refreshController.abort();
      refreshController = null;
    }
  }

  function selectNavigation(node: NavigationNode | null): void {
    uncommittedSelected = false;
    if (!node) { historyRevision = null; selectedCommitSha = null; return; }
    const sameHistorySelection = activeSection === "history" && navigationSelection === node.id && historyRevision === (node.revision ?? null);
    const returningToHistory = node.id === "history" && (activeSection === "changes" || (activeSection === "history" && historyRevision === null));
    navigationSelection = node.id;
    actionSelection = null;
    if (node.id === "changes" || returningToHistory || sameHistorySelection) {
      activeSection = node.id === "changes" ? "changes" : "history";
      return;
    }
    if (node.revision) {
      activeSection = "history";
      historyRevision = node.revision;
      selectedCommitSha = node.stash?.sha ?? null;
    } else {
      activeSection = node.id === "changes" ? "changes" : "history";
      historyRevision = null;
      selectedCommitSha = null;
    }
  }
  function openReferenceActions(section: "branches" | "tags" | "stashes", revision: string | null): void {
    actionSelection = revision;
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
    // Staging cannot move HEAD or change refs, stashes or remotes, so it only
    // reloads the Changes status instead of re-running history, the reference
    // tree and the branch header.
    if (scope === "stage") {
      changesRefreshToken += 1;
    } else {
      panelRefreshToken += 1;
    }
    if (workspaceRootPath) {
      notifyVersionControlMutation(workspaceRootPath, scope);
    }
    if (scope === "stage") {
      return;
    }
    const root = repoRoot;
    const controller = new AbortController();
    remoteRefreshController?.abort();
    remoteRefreshController = controller;
    await refreshBranchHeader(root, controller.signal);
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
    if (pushBusy) pushController?.abort();
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

  function handleRemoteOperationError(operation: string, error: unknown, root = repoRoot): void {
    if (isGitCancellationError(error)) {
      if (!remoteCancelRequested) {
        notifyGitCancellation(operation, { repoRoot: root ?? undefined, notify });
      }
      return;
    }
    reportGitError(new Error(redactRemoteUrl(formatGitErrorPrimaryMessage(error))), { operation, repoRoot: root ?? undefined, notify });
  }

  async function handleFetch(): Promise<void> {
    if (
      !repoRoot || changesBusy ||
      panelRemoteCommand !== null ||
      !canStartRemoteGitOperation({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading })
    ) {
      // Block a toolbar remote op while a panel remote command (tag push/
      // delete, changes fetch) is in flight. Without this Pull/Push stayed
      // enabled during a panel op, and starting one raced Cancel onto the
      // wrong command (M15).
      return;
    }

    const root = repoRoot;
    const workspace = workspaceRootPath;
    const generation = probeGeneration;
    const target = buildRemoteOperationTarget();
    const current = () => repoRoot === root && workspaceRootPath === workspace && probeGeneration === generation;
    let started = false;
    const commandId = createGitCommandId();
    activeRemoteCommandId = commandId;
    remoteCancelRequested = false;
    fetchBusy = true;

    try {
      started = true;
      await fetchRemote(root, target, { commandId });

    } catch (error) {
      handleRemoteOperationError("Fetch", error, root);
    } finally {
      if (started && workspace) {
        notifyVersionControlMutation(workspace, "fetch");
        if (current()) {
          panelRefreshToken += 1;
          const controller = new AbortController();
          remoteRefreshController?.abort();
          remoteRefreshController = controller;
          await refreshBranchHeader(root, controller.signal);
        }
      }

      fetchBusy = false;
      activeRemoteCommandId = null;
      remoteCancelRequested = false;
    }
  }

  async function handlePull(target: RemoteOperationTarget, pullOptions: PullOptions, snapshot: PullSnapshot): Promise<void> {
    if (
      !repoRoot || changesBusy ||
      panelRemoteCommand !== null ||
      !canStartRemoteGitOperation({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading })
    ) {
      // See handleFetch: block toolbar remotes while a panel command runs (M15).
      return;
    }

    const root = repoRoot;
    const workspace = workspaceRootPath;
    const generation = probeGeneration;
    if (dialogRoot !== root) return;
    pullDialogError = null;
    const current = () => repoRoot === root && workspaceRootPath === workspace && probeGeneration === generation;
    let started = false;
    let closePullAfterFinish = false;
    // Mark the toolbar busy up-front so Pull/Push/Refresh stay disabled while
    // the pre-pull prompts (autosave, dirty-tree choice) are open. The
    // cancellable command id is NOT registered yet: nothing can be cancelled
    // until `pullRemote` actually spawns, and registering it early let a
    // Cancel-pressed-during-prompt land on a not-yet-spawned command (`notFound`)
    // and leave `remoteCancelRequested` latched, making the real network
    // operation uncancellable (M5).
    pullBusy = true;
    // Clear any stale cancel flag from a previous operation, so the inline
    // Cancel control starts enabled once the command is registered below.
    remoteCancelRequested = false;

    let stashedRef: string | null = null;
    const commandId = createGitCommandId();

    try {
      if (workspace) {
        const canProceed = await prepareWorkspaceForGitOperation(workspace, {
          enabled: shouldRunAutosaveBeforeGitOperations(),
          deps: preGitSaveDeps,
        });
        if (!canProceed || !current()) {
          return;
        }
      }

      await assertPullSnapshot(root, snapshot);
      const existing = await queryGitOperationState(root);
      if (existing.kind !== "none" || existing.conflicts.length) throw new Error("Finish the current Git operation before pulling.");
      if (!current()) return;
      const dirty = await isWorkingTreeDirty(root);
      if (!current()) return;
      if (dirty) {
        const choice = await promptLocalChangesPull();
        if (!current() || !choice || choice.type === "cancel") {
          return;
        }
        if (choice.type === "block") {
          await message(
            "Pull is blocked while the working tree has uncommitted changes. Commit or stash your changes in File Status, then try again.",
            {
              title: "Working tree not clean",
              kind: "warning",
            },
          );
          return;
        }

        try {
          started = true;
          stashedRef = await createStash(root, "WIP before pull");
        } catch (error) {
          reportGitError(error, { operation: "Stash", repoRoot, notify });
          return;
        }
      }

      if (!current()) return;

      // Publish cancellation only after queued guards complete and the runner invokes Git.

      try {
        started = true;
        await pullRemote(root, target, { commandId, pull: pullOptions, expected: snapshot, onStart: id => {
          if (!current()) throw new Error("Repository changed before Pull could start.");
          activeRemoteCommandId = id;
          remoteCancelRequested = false;
        } });
      } catch (error) {
        // A conflicted pull leaves a merge or rebase in progress: continue below so
        // the operation state is read and the user is sent to resolve conflicts.
        if (error instanceof GitPullConflictError) {
          notify(error.message);
        } else {
          if (stashedRef) {
            notify(
              "Pull failed. Your changes were stashed — apply the latest stash to restore them.",
            );
          }
          if (current()) pullDialogError = formatGitErrorPrimaryMessage(error);
          handleRemoteOperationError("Pull", error, root);
          return;
        }
      }

      const resultingState = await queryGitOperationState(root);
      if (current()) {
        operationState = resultingState;
        closePullAfterFinish = true;
        if (resultingState.kind !== "none" || resultingState.conflicts.length) {
          activeSection = "changes";
          navigationSelection = "changes";
        }
      }
      if (stashedRef && resultingState.kind !== "none") {
        notify("Pull left an unfinished Git operation. Your changes remain in the latest stash; restore them after finishing or aborting the operation.");
      }
      if (stashedRef && resultingState.kind === "none") {
        try {
          await applyStash(root, stashedRef, true);
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


    } catch (error) {
      if (current()) pullDialogError = formatGitErrorPrimaryMessage(error);
      handleRemoteOperationError("Pull", error, root);
    } finally {
      if (started && current()) {
        try {
          const state = await queryGitOperationState(root);
          if (current()) {
            operationState = state;
            if (state.kind !== "none" || state.conflicts.length) {
              closePullAfterFinish = true;
              activeSection = "changes";
              navigationSelection = "changes";
            }
          }
        } catch (error) { if (current()) operationError = formatGitErrorPrimaryMessage(error); }
      }
      if (started && workspace) {
        notifyVersionControlMutation(workspace, "pull");
        if (current()) {
          panelRefreshToken += 1;
          const controller = new AbortController();
          remoteRefreshController?.abort();
          remoteRefreshController = controller;
          await refreshBranchHeader(root, controller.signal);
        }
      }

      pullBusy = false;
      activeRemoteCommandId = null;
      remoteCancelRequested = false;
      if (closePullAfterFinish && current()) {
        await tick();
        if (current()) remoteDialog = null;
      }
    }
  }

  $effect(() => {
    const root = repoRoot;
    panelRefreshToken;
    changesRefreshToken;
    let disposed = false;
    operationState = null;
    operationError = null;
    if (root && !isBareRepository) void queryGitOperationState(root).then(state => { if (!disposed) operationState = state; }).catch(error => { if (!disposed) operationError = formatGitErrorPrimaryMessage(error); });
    return () => { disposed = true; };
  });

  async function handleRecovery(action: "continue" | "abort"): Promise<void> {
    if (!repoRoot || toolbarBusy || !operationState) return;
    const root = repoRoot, workspace = workspaceRootPath, generation = probeGeneration;
    const kind = operationState.kind;
    const current = () => root === repoRoot && workspace === workspaceRootPath && generation === probeGeneration;
    const commandId = createGitCommandId();
    pullBusy = true;
    let started = false;
    try {
      if (workspace && !await prepareWorkspaceForGitOperation(workspace, { enabled: shouldRunAutosaveBeforeGitOperations(), deps: preGitSaveDeps })) return;
      if (!current()) return;
      started = true;
      await recoverGitOperation(root, kind, action, { commandId, onStart: id => {
        if (!current()) throw new Error("Repository changed before recovery could start.");
        activeRemoteCommandId = id;
        remoteCancelRequested = false;
      } });
    } catch (error) { handleRemoteOperationError("Git recovery", error, root); }
    finally {
      if (started && workspace) notifyVersionControlMutation(workspace, "pull");
      if (current()) {
        panelRefreshToken += 1;
        const controller = new AbortController();
        remoteRefreshController?.abort();
        remoteRefreshController = controller;
        await refreshBranchHeader(root, controller.signal);
      }
      pullBusy = false;
      activeRemoteCommandId = null;
      remoteCancelRequested = false;
    }
  }

  async function handlePush(plan: PushPlan): Promise<void> {
    if (
      !repoRoot || changesBusy ||
      panelRemoteCommand !== null ||
      !canStartRemoteGitOperation({ fetchBusy, pullBusy, pushBusy, refreshBusy, remotesLoading })
    ) {
      // See handleFetch: block toolbar remotes while a panel command runs (M15).
      return;
    }

    const root = repoRoot;
    const workspace = workspaceRootPath;
    const generation = probeGeneration;
    if (dialogRoot !== root) return;
    pushDialogError = null;
    pushResult = null;
    const current = () => repoRoot === root && workspaceRootPath === workspace && probeGeneration === generation;
    let started = false;
    const commandId = createGitCommandId();
    const controller = new AbortController();
    pushController = controller;
    activeRemoteCommandId = null;
    remoteCancelRequested = false;
    pushBusy = true;

    try {
      if (workspace && !await prepareWorkspaceForGitOperation(workspace, { enabled: shouldRunAutosaveBeforeGitOperations(), deps: preGitSaveDeps })) return;
      if (!current()) return;
      started = true;
      const result = await executePushPlan(root, plan, { commandId, signal: controller.signal, onStart: id => {
        if (!current()) throw new Error("Repository changed before Push could start.");
        activeRemoteCommandId = id;
        remoteCancelRequested = false;
      } });
      if (current()) pushResult = result;
    } catch (error) {
      if (current()) pushDialogError = formatGitErrorPrimaryMessage(error);
      handleRemoteOperationError("Push", error, root);
    } finally {
      if (started && workspace) {
        notifyVersionControlMutation(workspace, "push");
        if (current()) {
          panelRefreshToken += 1;
          const controller = new AbortController();
          remoteRefreshController?.abort();
          remoteRefreshController = controller;
          await refreshBranchHeader(root, controller.signal);
        }
      }

      pushController = null;
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

    // Capture the generation the refresh belongs to. If the workspace changes
    // before the response lands, the probe-generation effect aborts this
    // controller and bumps `probeGeneration`, so `refreshProbe`'s own guard
    // (and the explicit `signal.aborted` checks below) drop the stale result
    // rather than stamping it over the new root's data (M6).
    const generation = probeGeneration;
    abortInFlightRefresh();
    const controller = new AbortController();
    refreshController = controller;
    try {
      await refreshProbe(controller.signal, {
        silent: true,
        refreshBranchHeader: false,
        generation,
      });
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
      if (refreshController === controller) {
        refreshController = null;
      }
      // Always release the toolbar busy flag, even on abort: a workspace
      // switch that aborted us does not itself touch `refreshBusy`, so leaving
      // it latched would permanently disable the Refresh action.
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
      <button
        type="button"
        class="version-control-init-button"
        disabled={refreshBusy}
        onclick={() => void handleRefresh()}
      >
        {refreshBusy ? "Refreshing…" : "Refresh"}
      </button>
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
        <button type="button" class="btn btn-sm" disabled={toolbarBusy || isReadOnlyRepository} title={isReadOnlyRepository ? "Commit is unavailable for bare repositories" : "Open File Status and write a commit message"} onclick={openCommit}>Commit</button>
        <button type="button" class="btn btn-sm" aria-expanded={!sidebarCollapsed} onclick={() => sidebarCollapsed = !sidebarCollapsed}>Navigation</button>
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
          onclick={() => openRemoteDialog("Pull")}
        >
          {pullBusy ? "Pulling…" : "Pull"}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          disabled={remoteActionsDisabled || isReadOnlyRepository}
          title={isReadOnlyRepository ? "Push is unavailable for bare repositories" : remotes.length === 0 ? "Push (no remotes configured)" : "Push to selected remote"}
          onclick={() => openRemoteDialog("Push")}
        >
          {pushBusy ? "Pushing…" : "Push"}
        </button>
        <button type="button" class="btn btn-sm version-control-secondary" disabled={remoteActionsDisabled} title={remotePickerTitle} onclick={handleFetch}>Fetch</button>
        <button type="button" class="btn btn-sm version-control-secondary" disabled={toolbarBusy || isReadOnlyRepository} onclick={() => openReferenceActions("branches", null)}>Branch</button>
        <button type="button" class="btn btn-sm version-control-secondary" disabled title="Merge is not yet available">Merge</button>
        <button type="button" class="btn btn-sm version-control-secondary" disabled={toolbarBusy || isReadOnlyRepository} onclick={() => openReferenceActions("stashes", null)}>Stash</button>

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
              <div class="version-control-compact-actions">
                <button type="button" class="version-control-overflow-item" disabled={toolbarBusy || isReadOnlyRepository} onclick={() => { closeOverflow(); openReferenceActions("branches", null); }}>Branch</button>
                <button type="button" class="version-control-overflow-item" disabled title="Merge is not yet available">Merge — not yet available</button>
                <button type="button" class="version-control-overflow-item" disabled={toolbarBusy || isReadOnlyRepository} onclick={() => { closeOverflow(); openReferenceActions("stashes", null); }}>Stash</button>
              </div>
              <button type="button" class="version-control-overflow-item" disabled={!remoteBrowserUrl} title={remoteBrowserUrl ? "Open remote in browser" : "Remote has no supported web URL"} onclick={() => { closeOverflow(); if (remoteBrowserUrl) void openUrl(remoteBrowserUrl).catch(error => reportGitError(error, { operation: "Open remote", repoRoot: repoRoot ?? undefined, notify })); }}>Open remote</button>
              <button type="button" class="version-control-overflow-item" onclick={() => { closeOverflow(); void revealRepository(); }}>Show folder</button>
              <button type="button" class="version-control-overflow-item" onclick={() => { closeOverflow(); openSettingsDialog("versionControl"); }}>Settings</button>
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
                class="version-control-overflow-item version-control-compact-fetch"
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
      <GitWorkspaceSplit storageKey={`${layoutScope}:sidebar`} label="Resize navigation" initial={0.2} minFirst={180} minSecond={400} collapsed={sidebarCollapsed}>
      {#snippet first()}
      <div class="version-control-sidebar" aria-label="Version control navigation">
        <p class="version-control-title">{workspaceName}</p>
        {#if repoRoot}
          {#key `${layoutScope}:${repoRoot}`}
            <GitNavigationTree stateKey={layoutScope} {repoRoot} bare={isBareRepository} refreshToken={panelRefreshToken} selectedId={navigationSelection} onSelect={selectNavigation} onAction={openReferenceActions} />
          {/key}
        {/if}
      </div>

      {/snippet}
      {#snippet second()}
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
        {#if operationState && operationState.kind !== "none"}
          <div class="git-operation-banner" role="status">
            <strong>{operationState.kind === "unsupported" ? "Git operation requires external recovery" : `${operationState.kind} in progress`}</strong>
            <p>{operationState.conflicts.length ? "Resolve and stage conflicts in File Status before continuing." : "Continue to finish the operation, or abort to restore its starting point."} Git state is recovered when this view reopens.</p>
            <button type="button" disabled={toolbarBusy} onclick={() => { activeSection = "changes"; navigationSelection = "changes"; }}>Open File Status</button>
            <button type="button" disabled={toolbarBusy || operationState.kind === "unsupported" || operationState.conflicts.length > 0} onclick={() => { void handleRecovery("continue"); }}>Continue operation</button>
            <button type="button" disabled={toolbarBusy || operationState.kind === "unsupported"} onclick={() => { void handleRecovery("abort"); }}>Abort operation</button>
          </div>
        {:else if operationError}<p role="alert">Unable to read Git operation state: {operationError}</p>{/if}
        <div class="git-workspace-content">
        {#if isBareRepository && activeSection === "changes"}<p class="version-control-note">Working tree changes are unavailable in a bare repository.</p>{/if}
        {#if repoRoot}
          {#key `${layoutScope}:${repoRoot}`}
          {@const changesRoot = repoRoot}
          {@const changesScope = layoutScope}
          <div class="version-control-history-workspace" hidden={activeSection !== "history" && activeSection !== "changes"}>
          <GitWorkspaceSplit storageKey={`${layoutScope}:history`} label="Resize history and inspector" vertical initial={0.35} minFirst={140} minSecond={180} collapsed={activeSection === "changes"}>
            {#snippet first()}
              <GitHistoryPanel stateKey={layoutScope} bind:this={historyPanel} revision={historyRevision} repoRoot={repoRoot!} refreshToken={panelRefreshToken} selectedSha={uncommittedSelected ? null : selectedCommitSha} {hasUncommittedChanges} {uncommittedSelected} onSelectCommit={handleSelectCommit} onRefreshSelection={(commit) => { selectedCommit = commit; selectedCommitSha = commit.sha; }} onClearSelection={() => selectedCommitSha = null} onOpenChanges={() => { uncommittedSelected = true; }} />
            {/snippet}
            {#snippet second()}
              {#if workspaceRootPath && !isBareRepository}
                <div class="version-control-changes" hidden={activeSection !== "changes" && !uncommittedSelected}>
          <GitChangesPanel
            inspectOnly={activeSection === "history"}
            stateKey={layoutScope}
            onStatusChange={(dirty) => { if (changesRoot === repoRoot && changesScope === layoutScope) { hasUncommittedChanges = dirty; if (!dirty) uncommittedSelected = false; } }}
            onBusyChange={(busy) => { if (changesRoot === repoRoot && changesScope === layoutScope) changesBusy = busy; }}
            {focusMessageToken}
            operationBusy={toolbarBusy && !changesBusy}
            repoRoot={changesRoot}
            workspaceRootPath={workspaceRootPath}
            preGitSaveDeps={preGitSaveDeps}
            readOnly={isReadOnlyRepository}
            refreshToken={panelRefreshToken + changesRefreshToken}
            onMutation={(scope) => changesRoot === repoRoot && changesScope === layoutScope ? refreshAfterMutation(scope) : undefined}
            onRemoteCommandChange={(command) => { if (changesRoot === repoRoot && changesScope === layoutScope) registerPanelRemoteCommand(command); }}
            {notify}
          />
                </div>
              {/if}
              {#if activeSection === "history" && !uncommittedSelected}
                <GitCommitDetailPanel repoRoot={repoRoot!} sha={selectedCommitSha} refs={selectedCommit?.sha === selectedCommitSha ? selectedCommit.refs : []} onNavigate={sha => { void historyPanel?.jumpTo(sha); }} refreshToken={panelRefreshToken} {notify} layoutScope={layoutScope} />
              {/if}
            {/snippet}
          </GitWorkspaceSplit>
          </div>
          {/key}
        {/if}
        {#key `${layoutScope}:${repoRoot}:${actionSelection}`}
        {@const actionRoot = repoRoot}
        {@const actionScope = layoutScope}
        {#if activeSection === "branches" && repoRoot && workspaceRootPath}
          <GitBranchesPanel
            compact initialSelection={actionSelection}
            repoRoot={repoRoot}
            workspaceRootPath={workspaceRootPath}
            preGitSaveDeps={preGitSaveDeps}
            readOnly={isReadOnlyRepository || toolbarBusy}
            refreshToken={panelRefreshToken}
            onMutation={(scope) => actionRoot === repoRoot && actionScope === layoutScope ? refreshAfterMutation(scope) : undefined}
            {notify}
          />
        {:else if activeSection === "tags" && repoRoot}
          <GitTagsPanel
            compact initialSelection={actionSelection}
            repoRoot={repoRoot}
            readOnly={isReadOnlyRepository}
            remoteOpBusy={toolbarBusy}
            refreshToken={panelRefreshToken}
            onMutation={(scope) => actionRoot === repoRoot && actionScope === layoutScope ? refreshAfterMutation(scope) : undefined}
            onRemoteCommandChange={(command) => { if (actionRoot === repoRoot && actionScope === layoutScope) registerPanelRemoteCommand(command); }}
            {notify}
          />
        {:else if activeSection === "stashes" && repoRoot && workspaceRootPath}
          <GitStashesPanel
            compact initialSelection={actionSelection}
            repoRoot={repoRoot}
            workspaceRootPath={workspaceRootPath}
            preGitSaveDeps={preGitSaveDeps}
            readOnly={isReadOnlyRepository || toolbarBusy}
            refreshToken={panelRefreshToken}
            onMutation={(scope) => actionRoot === repoRoot && actionScope === layoutScope ? refreshAfterMutation(scope) : undefined}
            {notify}
          />
        {:else if activeSection !== "changes" && activeSection !== "history"}
          <p class="version-control-placeholder">{placeholderCopy}</p>
        {/if}
        {/key}
        </div>
      </div>
      {/snippet}
      </GitWorkspaceSplit>
    </div>
  {/if}
</div>

{#if remoteDialog === "Pull" && dialogRoot}
  <GitPullDialog root={dialogRoot} {remotes} initialRemote={selectedRemoteName} initialBranch={remoteSelection.remoteBranch}
    busy={pullBusy} canCancel={activeRemoteCommandId !== null && !remoteCancelRequested} error={pullDialogError}
    onPull={(target, options, snapshot) => { void handlePull(target, options, snapshot); }}
    onClose={() => remoteDialog = null} onCancel={() => { void handleCancelRemoteOperation(); }} />
{/if}
{#if remoteDialog === "Push" && dialogRoot}
  <GitPushDialog root={dialogRoot} refreshToken={panelRefreshToken} {remotes} initialRemote={selectedRemoteName} busy={pushBusy}
    canCancel={activeRemoteCommandId !== null && !remoteCancelRequested} error={pushDialogError} result={pushResult}
    onPush={plan => { void handlePush(plan); }} onClose={() => remoteDialog = null}
    onCancel={() => { void handleCancelRemoteOperation(); }} />
{/if}

<style>
  .git-workspace-content { flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
  .git-operation-banner { max-height: 35%; overflow-y: auto; padding: var(--space-6); border-bottom: 1px solid var(--color-border-subtle); overflow-wrap: anywhere; flex-shrink: 0; }
  .version-control-history-workspace { height:100%; min-height:0; }
  .version-control-changes { height: 100%; min-height: 0; }
  .version-control-changes[hidden] { display: none; }
  .version-control-compact-actions, .version-control-compact-fetch { display: none; }
  @container (max-width: 980px) {
    .version-control-secondary { display: none; }
    .version-control-compact-actions { display: contents; }
    .version-control-compact-fetch { display: flex; }
  }

  .version-control-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
    container-type: inline-size;
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
    flex-wrap: wrap;
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
    flex: 1 1 12rem;
    flex-wrap: wrap;
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
    min-width: 0;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .version-control-sidebar {
    min-height: 0;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4) var(--space-12);
    border-right: 1px solid var(--color-border-subtle);
    height: 100%;
    box-sizing: border-box;
  }

  .version-control-sidebar > :global(.navigation) {
    flex: 1;
    height: auto;
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

  .version-control-body {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
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

  .version-control-placeholder {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }
</style>
