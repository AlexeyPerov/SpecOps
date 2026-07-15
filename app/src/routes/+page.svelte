<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import AppShell from "../lib/components/AppShell.svelte";
  import { isChatHttpRailVisible } from "../lib/ai/providers/chatHttpRailGating";
  import {
    activeViewKindInActivePane,
    isSessionTabActiveInActivePane,
  } from "../lib/components/editorRouting";
  import { createAppShellAgentHandlers } from "../lib/services/appShellAgentHandlers";
  import { createAppShellLayoutHandlers } from "../lib/services/appShellLayoutHandlers";
  import {
    createAppShellCommandHandlers,
    createAppShellEditorHandlers,
    createAppShellFileHandlers,
    setupAppShellMount,
  } from "../lib/services/appShellPageHandlers";
  import { createAppShellProjectTreeHandlers } from "../lib/services/appShellProjectTreeHandlers";
  import { createEditorWorkbenchRuntime } from "../lib/editor/editorWorkbenchRuntime";
  import { setEditorWorkbenchRuntime } from "../lib/editor/editorWorkbenchContext";
  import { createEditorDocumentSessionCache } from "../lib/editor/editorDocumentSessionCache";
  import { setEditorDocumentSessionCache } from "../lib/editor/editorDocumentSessionContext";
  import { createEditorToolController } from "../lib/editor/editorToolController";
  import { setEditorToolController } from "../lib/editor/editorToolContext";
  import { subscribeDocumentDiskReload } from "../lib/editor/editorSessionLifecycle";
  import { appState } from "../lib/state/appState";
  import {
    collectAllOpenDocumentIds,
    getActiveContextSnapshot,
  } from "../lib/state/appState/contextHelpers";
  import {
    chatActiveSessionId,
    chatActiveRuntimeBySessionId,
    chatSessionIndex,
    chatStore,
  } from "../lib/state/chatStore";
  import { startAppShellRuntime } from "../lib/services/appShellRuntime";
  import { elapsedMs, logPerfTiming, nowMs } from "../lib/services/perfDiagnostics";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { routePathToLastActiveWindow } from "../lib/services/windowManager";
  import { registerSettingsDialogOpener } from "../lib/services/settingsDialogUi";
  import type { AppDomainState } from "../lib/domain/contracts";
  import {
    allTabs,
    CHAT_HTTP_CONTEXT_ID,
    getSessionActiveTab,
    getSessionSelectedTabId,
    isFileTab,
    type ContextId,
    tabDocumentId,
  } from "../lib/domain/contracts";
  import { createProjectTreeController, type ProjectTreeControllerState } from "../lib/services/projectTreeController";
  import { createWorkspaceFileCatalog } from "../lib/services/workspaceFileCatalog";
  import {
    createWorkspaceFileCatalogRegistry,
    type WorkspaceFileCatalogRegistry,
  } from "../lib/services/workspaceFileCatalogRegistry";
  import { collectPaneElementsFromDom } from "../lib/components/paneDropTargets";
  import { probeWorkspaceReadAccess } from "../lib/services/fileSystem";
  import { stopChatAccessMonitor } from "../lib/services/chatAccessMonitor";
  import { formatNotepadTabLabel } from "../lib/services/notepadTabLabel";
  import { rankFiles, type RankedFilesResult } from "../lib/picker/fileRanking";
  import { rankCommands, type RankedCommandsResult } from "../lib/picker/commandRanking";
  import { rankHeadings, type RankedHeadingsResult } from "../lib/picker/headingRanking";
  import { rankSnippets, type RankedSnippetsResult } from "../lib/picker/snippetRanking";
  import { listEnabledMarkdownSnippets } from "../lib/editor/markdownSnippetSettings";
  import type {
    EditorBookmarkSnapshot,
    EditorHostIdentity,
    MarkdownHeadingSnapshot,
  } from "../lib/types/editor";
  import { buildCommandAvailabilitySnapshot } from "../lib/commands/availability";
  import { buildPaletteSnapshot } from "../lib/commands/catalog";
  import type { AppCommandId } from "../lib/domain/contracts";
  import { collectTabOpenPaths } from "../lib/services/tabContextMenuActions";
  import {
    describeOpenActivePathResult,
    openActivePathInPane,
  } from "../lib/services/openActivePath";
  import { DEFAULT_CONSOLE_HEIGHT_PX } from "../lib/services/consoleTabPrefs";
  import {
    searchInProject,
    totalMatchCount,
    type ProjectSearchResult,
  } from "../lib/services/projectSearch";
  import { replaceInProjectFile } from "../lib/services/projectFileOps";
  import { createSearchQuery, validateSearchQuery, type SearchQuery } from "../lib/editor/searchQuery";
  import { requestConfirm } from "../lib/services/confirmDialogUi";
  import {
    decideReplaceAllForPath,
    syncOpenDocumentAfterReplace as syncOpenDocumentAfterReplaceService,
  } from "../lib/services/projectReplaceSync";
  import { getErrorMessage } from "../lib/commands/commandErrors";
  import { normalizeWorkspaceLayout, normalizeActivityRailWidthPx } from "../lib/services/panelLayout";
  import { deriveAppShellDocumentView } from "../lib/services/appShellDocumentView";
  import { createWorkspaceContextMenuActions } from "../lib/services/workspaceContextMenuController";
  import {
    getHiddenRootPaths,
    setHiddenFromRail,
    subscribeWorkspacePreferences,
  } from "../lib/services/workspacePreferences";
  import { collectImmediateSubfolders } from "../lib/services/workspaceSubfolders";
  import { normalizePathSync } from "../lib/services/diskFingerprint";
  import { openFolderDialog } from "../lib/services/fileSystem";
  import {
    flushSessionPersistence,
    registerTabsChangedSessionFlush,
  } from "../lib/services/sessionManager";
  import { isWorkspaceLifecycleActive, markWorkspaceLifecycleActive } from "../lib/services/workspaceLifecycle";
  import {
    requestOpencodeHealthRefresh,
    syncActiveFileTreeExpandEffect,
    syncSessionTabEffect,
    syncChatAccessMonitorEffect,
    syncExternalFileWatcherEffect,
    syncOpencodeSidecarEffect,
    syncOpencodeToggleEffect,
    syncProjectTreeWatcherEffect,
    syncWorkspaceFileCatalogEffect,
    syncResponsiveLayoutEffect,
    syncSessionPersistenceEffect,
    syncSettingsPersistenceEffect,
    syncWorkspaceContextEffect,
  } from "../lib/services/appShellEffects";
  import { externalFileWatcherSyncKey } from "../lib/services/appShellHelpers";
  import { refreshSessionTodos, clearSessionTodos } from "../lib/ai/opencodeTodoStore";
  import { refreshSessionDiffs, clearSessionDiffs } from "../lib/ai/opencodeDiffStore";
  import {
    clearOpencodeCatalog,
  } from "../lib/ai/opencodeCatalog";
  import {
    clearOpencodeConfigStore,
  } from "../lib/ai/opencodeConfigStore";
  import {
    clearOpencodeCommands,
  } from "../lib/ai/backends/opencodeCommands";
  import {
    getFileStatusTracker,
    refreshFileStatuses,
    clearFileStatusTracker,
  } from "../lib/services/fileStatusTracker";
  import {
    createSessionNotificationObserver,
  } from "../lib/services/sessionNotificationObserver";

  /**
   * Resolves a workspace-relative path (e.g. from an OpenCode diff payload)
   * to an absolute path. Passes absolute paths through unchanged so callers
   * can mix both shapes safely.
   */
  function resolveWorkspaceRelativePath(
    workspaceRoot: string | null,
    relativePath: string,
  ): string {
    const trimmed = relativePath.trim();
    if (!workspaceRoot || trimmed.length === 0) {
      return trimmed;
    }
    if (trimmed.startsWith("/")) {
      return trimmed;
    }
    const root = workspaceRoot.replace(/\/+$/, "");
    return `${root}/${trimmed}`;
  }
  let consoleOpen = $state(false);
  let consoleHeightPx = $state(DEFAULT_CONSOLE_HEIGHT_PX);
  let projectSearchOpen = $state(false);
  let projectSearchHeightPx = $state(DEFAULT_CONSOLE_HEIGHT_PX);
  let projectSearchFocusReplace = $state(false);
  let projectSearchQuery = $state("");
  let projectSearchReplace = $state("");
  let projectSearchCaseSensitive = $state(false);
  let projectSearchWholeWord = $state(false);
  let projectSearchRegex = $state(false);
  /** Inline regex validation error for the project search panel. */
  const projectSearchQueryError = $derived.by(() => {
    if (!projectSearchRegex || !projectSearchQuery.trim()) {
      return "";
    }
    try {
      void new RegExp(projectSearchQuery.trim());
      return "";
    } catch (error: unknown) {
      return error instanceof Error ? error.message : "Invalid regular expression.";
    }
  });
  let projectSearchResults = $state<ProjectSearchResult[]>([]);
  let projectSearchRunning = $state(false);
  let projectSearchStatus = $state("");
  let projectSearchNonce = $state(0);
  /** Monotonic generation to cancel in-flight searches (workspace switch / close). */
  let projectSearchGeneration = 0;
  /**
   * Normalized workspace root paths hidden from the activity rail (decision 3).
   * Backed by the global `workspacePreferences` store; loaded on startup and
   * kept reactive so toggling "Show in sidebar" in workspace settings updates
   * the rail immediately.
   */
  let workspaceHiddenRootPaths = $state<Set<string>>(new Set());
  /** Add-multiple modal state (decision 8): open + scanned subfolders. */
  let addMultipleOpen = $state(false);
  let addMultipleLoading = $state(false);
  let addMultipleError = $state<string | null>(null);
  let addMultipleParentPath = $state<string | null>(null);
  let addMultipleEntries = $state<ReadonlyArray<{ path: string; name: string; exists: boolean }>>([]);
  let addMultipleSelected = $state<Set<string>>(new Set());
  let statusMessage = $state("Ready");
  let currentWindowId = $state("main");
  let shellMainRowEl = $state<HTMLDivElement | null>(null);
  let editorShellEl = $state<HTMLElement | null>(null);
  let editorPaneEl = $state<HTMLElement | null>(null);
  let shellMainRowWidth = $state(0);
  let editorPaneWidth = $state(0);
  let layoutResizeObserver = $state<ResizeObserver | null>(null);
  let previousActiveContextId = $state<ContextId | null>(null);
  let untitledTitleDebounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  let lastSelectedTabId = $state<string | null>(null);
  let runtimeReady = $state(false);
  /**
   * M6-T4/T5 — observes agent runtime transitions in the active workspace and
   * fires sound + OS notifications. Created once; updated on every chatStore
   * change via the effect below.
   */
  const sessionNotificationObserver = createSessionNotificationObserver();
  const activeRuntimeBySessionId = $derived($chatActiveRuntimeBySessionId);
  let runtimeSyncExternalFileWatcher = $state<
    ((state: AppDomainState) => Promise<void>) | null
  >(null);
  let workspaceContextMenu = $state<{
    workspaceId: ContextId;
    x: number;
    y: number;
  } | null>(null);
  let workspaceContextMenuEl = $state<HTMLDivElement | null>(null);
  let projectTreeControllerState = $state<ProjectTreeControllerState>({
    rootNodes: [],
    childrenByPath: new Map(),
    expandedPaths: new Set(),
    loadingPaths: new Set(),
    showHidden: false,
  });
  const projectTreeController = createProjectTreeController(
    (nextState) => {
      projectTreeControllerState = nextState;
    },
    { probeWorkspaceReadAccessFn: probeWorkspaceReadAccess },
  );
  const workspaceFileCatalog = createWorkspaceFileCatalog();
  const workspaceFileCatalogRegistry: WorkspaceFileCatalogRegistry =
    createWorkspaceFileCatalogRegistry();
  let autoProjectPanelCollapsed = $state(false);
  let autoSessionsSidebarCollapsed = $state(false);
  let lastChatScopeKey = $state<string | null>(null);

  const snapshot = $derived($appState);
  const activeContext = $derived(getActiveContextSnapshot(snapshot));
  const session = $derived(activeContext.session);
  const documents = $derived(activeContext.documents);

  const editorWorkbench = createEditorWorkbenchRuntime({
    getActivePaneId: () =>
      getActiveContextSnapshot(appState.getSnapshot()).session.editorLayout.activePaneId,
    getActiveDocumentId: () => {
      const active = getSessionActiveTab(
        getActiveContextSnapshot(appState.getSnapshot()).session,
      );
      return active ? tabDocumentId(active) : null;
    },
  });
  setEditorWorkbenchRuntime(editorWorkbench);

  const editorSessionCache = createEditorDocumentSessionCache();
  setEditorDocumentSessionCache(editorSessionCache);

  // editorTools is created after modal state declarations below.

  $effect(() => {
    return editorWorkbench.subscribeCursorStatus(({ line, column, selectionCount }) => {
      appState.setCursor(line, column, selectionCount);
    });
  });

  $effect(() => {
    return subscribeDocumentDiskReload((documentId) => {
      editorSessionCache.invalidateDocument(documentId);
    });
  });

  $effect(() => {
    // Retain undo/fold cache across inactive contexts (LRU-bounded); only drop
    // entries whose documents no longer exist in any context.
    editorSessionCache.retainDocuments(collectAllOpenDocumentIds(snapshot));
  });

  /** Stable key for external file-watcher sync; ignores non-path snapshot churn. */
  const externalWatcherSyncKey = $derived(externalFileWatcherSyncKey(snapshot));
  const activeContextId = $derived(snapshot.contexts.activeContextId);
  const isChatHttpActive = $derived(activeContextId === CHAT_HTTP_CONTEXT_ID);
  const workspaces = $derived(snapshot.contexts.workspaces);
  /**
   * Workspaces visible in the activity rail: hidden-from-rail entries are
   * filtered out (decision 3). The Workspace Manager always receives the full
   * `workspaces` list so hidden workspaces remain switchable from there.
   */
  const railWorkspaces = $derived(
    workspaces.filter((workspace) => !workspaceHiddenRootPaths.has(workspace.rootPath)),
  );
  const activeWorkspaceRoot = $derived(appState.getWorkspaceRoot(activeContextId));
  const workspaceLayout = $derived(
    normalizeWorkspaceLayout(session.layout),
  );
  const showProjectPanel = $derived(
    !isChatHttpActive &&
      Boolean(activeWorkspaceRoot) &&
      !workspaceLayout.projectPanelCollapsed &&
      !autoProjectPanelCollapsed,
  );
  const workspaceSessions = $derived($chatSessionIndex);
  const selectedSessionId = $derived($chatActiveSessionId);
  /**
   * M2 — active agent's OpenCode session link for the chat header badges and
   * session-action gating. Resolved off the agent index (already reactive)
   * rather than reading the session index imperatively.
   */
  const activeSessionEntry = $derived(
    workspaceSessions.find((agent) => agent.id === selectedSessionId) ?? null,
  );
  const activeShareUrl = $derived(activeSessionEntry?.opencodeShareUrl ?? null);
  const activeParentSessionId = $derived(
    activeSessionEntry?.opencodeParentSessionId ?? null,
  );
  /** M5-T1 — linked session id for the active agent (scopes session.todo). */
  const activeOpencodeSessionId = $derived(
    activeSessionEntry?.opencodeSessionId ?? null,
  );
  const opencodeMode = $derived(snapshot.settings.opencode.mode);

  /**
   * M2-T2 — unified per-workspace session list panel state. Triggered from
   * the agents sidebar; fetches `listSessionDetails` and lets the user open
   * any session (including ones not created as SpecOps agent tabs).
   */
  let sessionListOpen = $state(false);
  let sessionListSessions = $state<
    import("$lib/ai/backends/workspaceAgentBackend").WorkspaceAgentSessionDetails[]
  >([]);
  let sessionListLoading = $state(false);
  let sessionListError = $state<string | null>(null);
  let sessionListSort = $state<
    import("$lib/ai/backends/opencodeSessionList").SessionListSort
  >("updated");
  let sessionListSearch = $state("");
  /**
   * M5-T1 — TODO panel toggle. Agent-scoped: only rendered when a workspace
   * agent tab with a linked OpenCode session is active. Auto-refresh of
   * `session.todo` is driven by the `todowrite` tool-event effect below.
   */
  let todoPanelOpen = $state(false);
  /** M5-T2 — diff viewer panel toggle (agent-scoped, like the TODO panel). */
  let diffPanelOpen = $state(false);
  /**
   * M5-T3 — workspace git status (file.status) for the project-tree badges.
   * One reactive store per workspace; cleared on workspace switch.
   */
  const fileStatusStore = $derived.by(() => {
    const root = activeWorkspaceRoot;
    if (!root) {
      return null;
    }
    return getFileStatusTracker(root);
  });
  const fileStatusState = $derived(fileStatusStore ? $fileStatusStore : null);
  const fileStatusByPath = $derived(fileStatusState?.statusByPath ?? null);
  /**
   * M5-T5 — session timeline dialog state. Reads the active transcript
   * (already hydrated); jumping scrolls the message list to the target id.
   */
  let timelineOpen = $state(false);
  let timelineSearch = $state("");
  /**
   * M1.2 — Quick Open file picker state. `quickOpenOpen` gates the overlay;
   * `quickOpenQuery` holds the live query; `quickOpenOpenerPaneId` captures the
   * active pane at invocation so the selected file opens into the pane the user
   * was focused on (falling back to the current active pane if it closed).
   */
  let quickOpenOpen = $state(false);
  let quickOpenQuery = $state("");
  let quickOpenOpenerPaneId = $state<string | null>(null);
  /**
   * M3.2 — Command palette state. Ephemeral and window-local like Quick Open.
   */
  let commandPaletteOpen = $state(false);
  let commandPaletteQuery = $state("");
  /**
   * M7.1 — Heading-jump picker state. Ephemeral and window-local.
   */
  let headingJumpOpen = $state(false);
  let headingJumpQuery = $state("");
  /**
   * M7.2 — Bookmark list picker state. Ephemeral and window-local.
   */
  let bookmarkListOpen = $state(false);
  let bookmarkListQuery = $state("");
  /**
   * M6.2 — Insert-snippet picker state. Ephemeral and window-local.
   * Captures the invoking host identity so selection cannot target a stale pane.
   */
  let snippetInsertOpen = $state(false);
  let snippetInsertQuery = $state("");
  let snippetInsertHostIdentity = $state<EditorHostIdentity | null>(null);

  const editorTools = createEditorToolController({
    getActiveBinding: () => {
      const active = getSessionActiveTab(
        getActiveContextSnapshot(appState.getSnapshot()).session,
      );
      const documentId = active ? tabDocumentId(active) : null;
      if (!documentId) {
        return null;
      }
      return {
        paneId: getActiveContextSnapshot(appState.getSnapshot()).session.editorLayout
          .activePaneId,
        documentId,
      };
    },
    focusEditor: () => {
      editorWorkbench.focusActive();
    },
    isModalOpen: () =>
      sessionListOpen ||
      addMultipleOpen ||
      projectSearchOpen ||
      timelineOpen ||
      quickOpenOpen ||
      commandPaletteOpen ||
      headingJumpOpen ||
      bookmarkListOpen ||
      snippetInsertOpen ||
      Boolean(workspaceContextMenu),
  });
  setEditorToolController(editorTools);

  /**
   * M1.2 — Quick Open ranking. Derives open/recent file paths from the active
   * context for recency boosts, then ranks the active workspace catalog against
   * the live query. The result is recomputed reactively when the catalog
   * snapshot, query, or open/recent paths change.
   */
  const quickOpenCatalogSnapshot = $derived(
    workspaceFileCatalogRegistry.getActiveSnapshot(),
  );
  const quickOpenRecencyInputs = $derived.by(() => {
    const ctx = getActiveContextSnapshot(snapshot);
    const openPaths = collectTabOpenPaths(allTabs(ctx.session.editorLayout), ctx.documents);
    const recentPaths = snapshot.recentFiles;
    return { openPaths, recentPaths };
  });
  const quickOpenResults: RankedFilesResult = $derived(
    rankFiles(quickOpenCatalogSnapshot, quickOpenQuery, quickOpenRecencyInputs),
  );

  onDestroy(() => {
    editorWorkbench.dispose();
    editorSessionCache.clear();
    editorTools.dispose();
    workspaceFileCatalog.dispose();
    workspaceFileCatalogRegistry.dispose();
  });

  $effect(() => {
    // Close editor tools on pane/document/context changes or when a modal opens.
    activeContextId;
    session.editorLayout.activePaneId;
    getSessionActiveTab(session);
    sessionListOpen;
    addMultipleOpen;
    projectSearchOpen;
    timelineOpen;
    quickOpenOpen;
    commandPaletteOpen;
    workspaceContextMenu;
    editorTools.syncToEnvironment();
  });

  const activeMessages = $derived(chatStore.getMessages());
  const openSessionIds = $derived(
    new Set(
      workspaceSessions
        .map((agent) => agent.opencodeSessionId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  async function refreshSessionList(): Promise<void> {
    sessionListLoading = true;
    try {
      // handleListWorkspaceSessions degrades to [] and never throws (M7-T5
      // surfaces failures via diagnostics instead), so there's nothing to
      // catch here — kept in try/finally purely for the loading toggle.
      sessionListSessions = await handleListWorkspaceSessions({
        ...(sessionListSearch.trim() ? { search: sessionListSearch.trim() } : {}),
      });
    } finally {
      sessionListLoading = false;
    }
  }

  async function openSessionListPanel(): Promise<void> {
    sessionListOpen = true;
    await refreshSessionList();
  }

  function closeSessionListPanel(): void {
    sessionListOpen = false;
  }

  async function handleOpenSessionFromList(sessionId: string, title?: string): Promise<void> {
    await handleOpenExternalSession(sessionId, title);
    closeSessionListPanel();
  }
  const opencodeBaseUrl = $derived(snapshot.settings.opencode.baseUrl);
  const opencodeEnabled = $derived(snapshot.settings.opencode.enabled);
  const opencodeSidecarPort = $derived(snapshot.settings.opencode.sidecarPort);
  const showSessionsSidebar = $derived(
    (isChatHttpActive || (Boolean(activeWorkspaceRoot) && opencodeEnabled)) &&
      !workspaceLayout.sessionsSidebarCollapsed,
  );
  const chatHttpRailVisible = $derived(
    isChatHttpRailVisible(
      snapshot.settings.providerSettings,
      snapshot.settings.providerApiKeys,
      snapshot.settings.providerSettings.debugChat,
      snapshot.settings.chatHttp,
    ),
  );
  const sessionSelectedTabId = $derived(getSessionSelectedTabId(session));
  const activeTab = $derived(getSessionActiveTab(session));
  // Phase 4: routing reads off the ACTIVE pane's selected tab (activePane →
  // activeTab, Q15). The session-tab singleton (Q5) keeps the sidecar gating
  // sound — the session tab lives in at most one pane, so checking the active
  // pane's selection is sufficient.
  const isSessionTabActive = $derived(isSessionTabActiveInActivePane(session));
  const activeViewTabKind = $derived(activeViewKindInActivePane(session));
  const isSettingsViewActive = $derived(activeViewTabKind === "settings");
  const isThemesViewActive = $derived(activeViewTabKind === "themes");
  const isViewTabActive = $derived(activeViewTabKind !== null);
  // Notepad rail card data — reads the notepad context directly so it is
  // available regardless of which context is currently active. Most recently
  // opened file tab in append order (newest-opened last). Kept to a single
  // row so the notepad card stays compact and its divider lands near the
  // editor tab-bar bottom line.
  const notepadSession = $derived(snapshot.contexts.notepad.session);
  const notepadOpenTabCount = $derived(allTabs(notepadSession.editorLayout).length);
  const notepadRecentTabs = $derived.by(() => {
    const notepadDocs = snapshot.contexts.notepad.documents;
    const fileTabs = allTabs(notepadSession.editorLayout)
      .filter(isFileTab)
      .filter((tab) => {
        const doc = notepadDocs.find((documentState) => documentState.id === tab.documentId);
        // Skip untitled/unsaved docs (no on-disk path) so the card only lists
        // real saved files.
        return Boolean(doc?.filePath);
      });
    const lastOne = fileTabs.slice(-1);
    return lastOne.map((tab) => {
      const doc = notepadDocs.find((documentState) => documentState.id === tab.documentId);
      return {
        tabId: tab.id,
        label: formatNotepadTabLabel(doc?.filePath ?? null, doc?.title ?? ""),
      };
    });
  });
  // Phase 4: the active document is the active pane's selected FILE tab's
  // document. Session / view tabs and empty panes resolve to `undefined`
  // (previously this fell back to documents[0], which could surface an
  // unrelated doc when the active pane showed a non-file tab — a latent
  // footgun now that the split lets any pane show a session/view tab).
  const activeDocument = $derived.by(() => {
    const docId = activeTab ? tabDocumentId(activeTab) : null;
    if (!docId) {
      return undefined;
    }
    return documents.find((documentState) => documentState.id === docId);
  });

  /**
   * M3.2 — Command palette ranking. Availability and effective bindings refresh
   * reactively when workspace, document, layout, or shortcut overrides change.
   */
  const commandAvailabilitySnapshot = $derived(
    buildCommandAvailabilitySnapshot({
      hasWorkspace: Boolean(activeWorkspaceRoot),
      hasActiveDocument: Boolean(activeDocument),
      isDirty: activeDocument?.isDirty ?? false,
      paneCount: session.editorLayout.panes.length,
      markdownPreviewAvailable: activeDocument?.language === "markdown",
      markdownEditAvailable: activeDocument?.language === "markdown",
    }),
  );
  const commandPaletteEntries = $derived(
    buildPaletteSnapshot({
      snapshot: commandAvailabilitySnapshot,
      bindingOverrides: snapshot.settings.commandBindingOverrides,
    }),
  );
  const commandPaletteResults: RankedCommandsResult = $derived(
    rankCommands(commandPaletteEntries, commandPaletteQuery),
  );

  /**
   * M7.1 / M7.2 pickers read from the live editor host queries. Host queries
   * are not Svelte-reactive, so while a picker is open we refresh on a short
   * interval (mirrors the MarkdownOutlinePanel polling approach).
   */
  let landmarkPickerTick = $state(0);
  $effect(() => {
    if (!headingJumpOpen && !bookmarkListOpen) {
      return;
    }
    const interval = setInterval(() => {
      landmarkPickerTick += 1;
    }, 200);
    return () => clearInterval(interval);
  });

  const headingJumpHeadings = $derived.by((): MarkdownHeadingSnapshot[] => {
    void landmarkPickerTick;
    if (!headingJumpOpen) {
      return [];
    }
    const host = editorWorkbench.getActiveHost();
    if (!host) {
      return [];
    }
    const result = host.queries.markdown.getHeadings();
    return result.ok ? result.value : [];
  });

  const headingJumpCursorPos = $derived.by((): number => {
    void landmarkPickerTick;
    const host = editorWorkbench.getActiveHost();
    if (!host) {
      return 0;
    }
    const selection = host.queries.selection.getSelection();
    return selection.ok ? selection.value.head : 0;
  });

  const headingJumpResults: RankedHeadingsResult = $derived(
    rankHeadings(headingJumpHeadings, headingJumpQuery, headingJumpCursorPos),
  );

  const bookmarkListSnapshots = $derived.by((): EditorBookmarkSnapshot[] => {
    void landmarkPickerTick;
    if (!bookmarkListOpen) {
      return [];
    }
    const host = editorWorkbench.getActiveHost();
    if (!host) {
      return [];
    }
    const result = host.queries.bookmarks.list();
    return result.ok ? result.value : [];
  });

  const snippetInsertResults: RankedSnippetsResult = $derived(
    rankSnippets(
      listEnabledMarkdownSnippets(snapshot.settings.markdownSnippets),
      snippetInsertQuery,
    ),
  );

  const shouldRenderMarkdownPreview = $derived.by(() => {
    if (!activeDocument || activeDocument.language !== "markdown") {
      return false;
    }
    if (activeDocument.markdownViewMode === "preview") {
      return true;
    }
    return activeDocument.markdownViewMode === "split" && canFitMarkdownSplit();
  });
  const documentView = $derived(
    deriveAppShellDocumentView(activeDocument, {
      renderMarkdownHtml: shouldRenderMarkdownPreview,
    }),
  );
  let largeFileConfirming = $state(false);
  /**
   * Phase 6 — the pane currently highlighted as a file-drop target during a
   * project-tree file drag. Bound through AppShell → EditorGridLayout so the
   * hovered pane renders an affordance; cleared when the drag ends.
   */
  let fileDropTargetPaneId = $state<string | null>(null);

  function notify(message: string): void {
    statusMessage = message;
  }

  const projectTreeHandlers = createAppShellProjectTreeHandlers({
    getActiveWorkspaceRoot: () => activeWorkspaceRoot,
    getIsSessionTabActive: () => isSessionTabActive,
    getCurrentWindowId: () => currentWindowId,
    notify,
    projectTreeController,
    onFilesystemChange: (path, kind) => {
      workspaceFileCatalog.notifyFilesystemChange(path, kind);
      workspaceFileCatalogRegistry.notifyFilesystemChange(path, kind);
    },
  });

  const {
    loadProjectTreeRoot,
    handleToggleProjectTreeDirectory,
    handleOpenProjectTreeFile,
    handleOpenProjectTreeFileInPane,
    refreshProjectTree,
    notifyProjectTreeFilesystemChange,
    handleMoveProjectTreeEntry,
    handleNewProjectFile,
    handleNewProjectFolder,
    handleRenameProjectEntry,
    handleDeleteProjectEntry,
    toggleProjectTreeHidden,
  } = projectTreeHandlers;

  const layoutHandlers = createAppShellLayoutHandlers({
    getShellMainRowEl: () => shellMainRowEl,
    getEditorPaneEl: () => editorPaneEl,
    setShellMainRowWidth: (width) => {
      shellMainRowWidth = width;
    },
    setEditorPaneWidth: (width) => {
      editorPaneWidth = width;
    },
    getShellMainRowWidth: () => shellMainRowWidth,
    getEditorPaneWidth: () => editorPaneWidth,
    getActiveWorkspaceRoot: () => activeWorkspaceRoot,
    getIsChatHttpActive: () => isChatHttpActive,
    getIsSessionTabActive: () => isSessionTabActive,
    getWorkspaceLayout: () => workspaceLayout,
    getConsoleOpen: () => consoleOpen,
    setConsoleOpen: (open) => {
      consoleOpen = open;
    },
    getAutoProjectPanelCollapsed: () => autoProjectPanelCollapsed,
    setAutoProjectPanelCollapsed: (collapsed) => {
      autoProjectPanelCollapsed = collapsed;
    },
    getAutoSessionsSidebarCollapsed: () => autoSessionsSidebarCollapsed,
    setAutoSessionsSidebarCollapsed: (collapsed) => {
      autoSessionsSidebarCollapsed = collapsed;
    },
    getActiveDocument: () => activeDocument,
    getConsoleHeightPx: () => consoleHeightPx,
    setConsoleHeightPx: (heightPx) => {
      consoleHeightPx = heightPx;
    },
    getLayoutResizeObserver: () => layoutResizeObserver,
    setLayoutResizeObserver: (observer) => {
      layoutResizeObserver = observer;
    },
  });

  const {
    toggleProjectPanelCollapsed,
    toggleSessionsSidebarCollapsed,
    handleProjectPanelWidthChange,
    handleSessionsSidebarWidthChange,
    handleActivityRailWidthChange,
    toggleConsole,
    persistConsoleHeightNow,
    canFitMarkdownSplit,
    setMarkdownViewMode,
    applyResponsiveLayoutRules,
    setupLayoutObserver,
    disconnectLayoutObserver,
  } = layoutHandlers;

  function handleToggleConsole(): void {
    if (!snapshot.settings.logSettings.canOpenLogsPanel) {
      return;
    }
    toggleConsole();
  }

  function closeProjectSearch(): void {
    // Cancel any in-flight search and clear results so stale results never
    // open after the panel is dismissed.
    projectSearchGeneration += 1;
    projectSearchOpen = false;
    projectSearchResults = [];
    projectSearchStatus = "";
    projectSearchRunning = false;
  }

  /**
   * M1.2 — Quick Open selection handler. Opens the chosen file through the
   * existing gated pipeline (`openActivePathInPane` targeting the pane captured
   * at invocation, falling back to the active pane if the captured pane closed).
   * The picker closes only after a successful handoff; failures keep the picker
   * open with a status message so the user can try another file.
   */
  async function handleQuickOpenSelect(path: string): Promise<void> {
    const targetPaneId = quickOpenOpenerPaneId ?? session.editorLayout.activePaneId;
    const result = await openActivePathInPane(path, currentWindowId, targetPaneId);
    notify(describeOpenActivePathResult(result));
    if (result.kind === "failed" || result.kind === "missing") {
      // Keep the picker open so the user sees the failure and can retry.
      return;
    }
    quickOpenOpen = false;
  }

  function closeQuickOpen(): void {
    quickOpenOpen = false;
  }

  function closeCommandPalette(): void {
    commandPaletteOpen = false;
  }

  function closeHeadingJump(): void {
    headingJumpOpen = false;
  }

  function closeBookmarkList(): void {
    bookmarkListOpen = false;
  }

  function closeSnippetInsert(): void {
    snippetInsertOpen = false;
    snippetInsertHostIdentity = null;
  }

  function handleHeadingJumpSelect(headingKey: string): void {
    // Preview-only: switch to edit so the CodeMirror host can reveal the heading.
    if (activeDocument?.markdownViewMode === "preview") {
      setMarkdownViewMode("edit");
    }
    const host = editorWorkbench.getActiveHost();
    host?.actions.navigation.jumpToHeading(headingKey);
    host?.focus();
    headingJumpOpen = false;
  }

  function handleBookmarkListSelect(line: number): void {
    const host = editorWorkbench.getActiveHost();
    if (host) {
      host.actions.navigation.goToLine(line);
      host.focus();
    }
    bookmarkListOpen = false;
  }

  function handleSnippetInsertSelect(snippetId: string): void {
    const captured = snippetInsertHostIdentity;
    const host = editorWorkbench.getActiveHost();
    // Reject stale pane/document after a context switch while the picker was open.
    if (
      !host ||
      !captured ||
      host.identity.paneId !== captured.paneId ||
      host.identity.documentId !== captured.documentId ||
      host.identity.generation !== captured.generation
    ) {
      notify("Snippet insert cancelled — editor context changed.");
      closeSnippetInsert();
      return;
    }
    if (activeDocument?.markdownViewMode === "preview") {
      setMarkdownViewMode("edit");
    }
    host.actions.snippets.insert(snippetId);
    host.focus();
    closeSnippetInsert();
  }

  function refreshQuickOpenCatalog(): void {
    workspaceFileCatalogRegistry.refresh();
  }

  /**
   * Find-in-Project panel height is not persisted yet (no dedicated pref store);
   * the commit hook is a no-op so the resize handle still works in-session.
   */
  function persistProjectSearchHeightNow(): void {
    // intentionally empty — height resets to default each session.
  }

  /** Build a unified query from the panel's current search options. */
  function buildProjectSearchQuery(): SearchQuery {
    return createSearchQuery({
      text: projectSearchQuery.trim(),
      replacement: projectSearchReplace,
      caseSensitive: projectSearchCaseSensitive,
      wholeWord: projectSearchWholeWord,
      regexp: projectSearchRegex,
    });
  }

  async function runProjectSearch(): Promise<void> {
    const root = activeWorkspaceRoot;
    const query = buildProjectSearchQuery();
    const validation = validateSearchQuery(query);
    if (!root) {
      projectSearchResults = [];
      projectSearchStatus = "Open a workspace to search.";
      return;
    }
    if (!validation.ok) {
      projectSearchResults = [];
      projectSearchStatus = validation.reason;
      return;
    }
    projectSearchRunning = true;
    projectSearchStatus = "Searching…";
    // Invalidate any in-flight search so stale results never land.
    projectSearchGeneration += 1;
    const generation = projectSearchGeneration;
    try {
      const outcome = await searchInProject(root, query, {
        files:
          workspaceFileCatalogRegistry.getActive()?.getOpenablePaths() ??
          workspaceFileCatalog.getOpenablePaths() ??
          undefined,
        onProgress: () => generation === projectSearchGeneration,
      });
      if (generation !== projectSearchGeneration) {
        return;
      }
      if (!outcome.ok) {
        projectSearchResults = [];
        projectSearchStatus = outcome.reason;
        return;
      }
      const results = outcome.results;
      projectSearchResults = results;
      const files = results.length;
      const matches = totalMatchCount(results);
      projectSearchStatus =
        matches === 0
          ? "No results"
          : `${matches} result${matches === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}`;
    } catch (error: unknown) {
      if (generation === projectSearchGeneration) {
        projectSearchStatus = `Search failed: ${getErrorMessage(error)}`;
      }
    } finally {
      if (generation === projectSearchGeneration) {
        projectSearchRunning = false;
      }
    }
  }

  async function replaceAllInProject(): Promise<void> {
    const root = activeWorkspaceRoot;
    if (!root || projectSearchResults.length === 0) {
      notify("Nothing to replace.");
      return;
    }
    const query = buildProjectSearchQuery();
    const validation = validateSearchQuery(query);
    if (!validation.ok) {
      notify(validation.reason);
      return;
    }
    const totalFiles = projectSearchResults.length;
    const totalMatches = totalMatchCount(projectSearchResults);
    const confirmed = await requestConfirm({
      title: "Replace in Project",
      message: `Replace ${totalMatches} match${totalMatches === 1 ? "" : "es"} in ${totalFiles} file${totalFiles === 1 ? "" : "s"}?`,
      confirmLabel: "Replace All",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    projectSearchRunning = true;
    projectSearchStatus = "Replacing…";
    let replaced = 0;
    let files = 0;
    let failures = 0;
    let skippedDirty = 0;
    try {
      for (const result of projectSearchResults) {
        // Never silently clobber an unsaved buffer: skip files whose open
        // document is dirty across any context, and count them for status.
        const decision = decideReplaceAllForPath(result.path);
        if (decision.kind === "skip-dirty") {
          skippedDirty += 1;
          continue;
        }
        const outcome = await replaceInProjectFile(root, result.path, query);
        if (outcome.ok) {
          replaced += outcome.count;
          files += 1;
          syncOpenDocumentAfterReplaceService(result.path, outcome.content, outcome.fingerprint);
        } else if (outcome.reason !== "No matches.") {
          failures += 1;
        }
      }
      projectSearchStatus = `Replaced ${replaced} occurrence(s) in ${files} file(s)${
        failures > 0 ? `; ${failures} file(s) failed` : ""
      }${skippedDirty > 0 ? `; skipped ${skippedDirty} file(s) with unsaved changes` : ""}`;
      notify(
        skippedDirty > 0
          ? `Replaced ${replaced} occurrence(s) in ${files} file(s); skipped ${skippedDirty} with unsaved changes.`
          : `Replaced ${replaced} occurrence(s) in ${files} file(s).`,
      );
      await runProjectSearch();
    } finally {
      projectSearchRunning = false;
    }
  }

  async function openProjectSearchResult(
    path: string,
    line: number,
  ): Promise<void> {
    await openAndActivatePath(path);
    if (line > 0) {
      await tick();
      editorWorkbench.getActiveRunner()?.goToLine(line);
    }
  }

  $effect(() => {
    if (!snapshot.settings.logSettings.canOpenLogsPanel && consoleOpen) {
      consoleOpen = false;
    }
  });

  const {
    handleNewSession,
    handleSelectSession,
    handleDeleteSession,
    ensureChatHttpSessionTab,
    handleDeleteSessionFromChat,
    restoreWorkspaceSession,
    handleCloseTab,
    handleRenameSession,
    handleForkSession,
    handleRevertSession,
    handleUnrevertSession,
    handleShareSession,
    handleUnshareSession,
    handleSummarizeSession,
    handleExportSession,
    handleOpenExternalSession,
    handleListWorkspaceSessions,
  } = createAppShellAgentHandlers({
    getIsChatHttpActive: () => isChatHttpActive,
    getCurrentWindowId: () => currentWindowId,
    notify,
  });

  const {
    open: handleOpenWorkspaceContextMenu,
    close: closeWorkspaceContextMenu,
    menuIndex: workspaceContextMenuIndex,
    move: moveWorkspaceFromContextMenu,
    closeWorkspace: closeWorkspaceFromContextMenu,
    openSettings: openSettingsFromContextMenu,
    openVersionControl: openVersionControlFromContextMenu,
    handleActiveContextSwitch,
    handleSelectContext,
  } = createWorkspaceContextMenuActions({
    getMenu: () => workspaceContextMenu,
    setMenu: (menu) => {
      workspaceContextMenu = menu;
    },
    getMenuEl: () => workspaceContextMenuEl,
    getWorkspaceIds: () => workspaces.map((workspace) => workspace.id),
    getPreviousActiveContextId: () => previousActiveContextId,
    setPreviousActiveContextId: (contextId) => {
      previousActiveContextId = contextId;
    },
    setConsoleOpen: (open) => {
      consoleOpen = open;
    },
    setMarkdownViewMode,
    loadProjectTreeRoot,
    notify,
  });

  const { runCommand, handleKeydown } = createAppShellCommandHandlers({
    notify,
    getSnapshot: () => snapshot,
    getCurrentWindowId: () => currentWindowId,
    getEditorRunner: () => editorWorkbench.getActiveRunner(),
    getEditorTools: () => editorTools,
    getOverlayOpen: () =>
      sessionListOpen ||
      addMultipleOpen ||
      projectSearchOpen ||
      timelineOpen ||
      quickOpenOpen ||
      commandPaletteOpen ||
      headingJumpOpen ||
      bookmarkListOpen ||
      snippetInsertOpen ||
      Boolean(workspaceContextMenu),
    openProjectSearch: (focusReplace) => {
      projectSearchOpen = true;
      projectSearchFocusReplace = focusReplace;
      projectSearchNonce += 1;
    },
    openQuickOpen: () => {
      if (commandPaletteOpen) {
        commandPaletteOpen = false;
      }
      if (headingJumpOpen) {
        headingJumpOpen = false;
      }
      if (bookmarkListOpen) {
        bookmarkListOpen = false;
      }
      if (snippetInsertOpen) {
        closeSnippetInsert();
      }
      // Capture the active pane at invocation so the selected file opens into
      // the pane the user was focused on. If that pane is gone by selection
      // time, the open pipeline falls back to the current active pane.
      quickOpenOpenerPaneId = session.editorLayout.activePaneId;
      // Query is reset by the picker component on open (via onQueryInput).
      quickOpenOpen = true;
    },
    openHeadingJump: () => {
      if (quickOpenOpen) {
        quickOpenOpen = false;
      }
      if (commandPaletteOpen) {
        commandPaletteOpen = false;
      }
      if (bookmarkListOpen) {
        bookmarkListOpen = false;
      }
      if (snippetInsertOpen) {
        closeSnippetInsert();
      }
      editorTools.close({ restoreFocus: false });
      headingJumpQuery = "";
      headingJumpOpen = true;
    },
    openBookmarkList: () => {
      if (quickOpenOpen) {
        quickOpenOpen = false;
      }
      if (commandPaletteOpen) {
        commandPaletteOpen = false;
      }
      if (headingJumpOpen) {
        headingJumpOpen = false;
      }
      if (snippetInsertOpen) {
        closeSnippetInsert();
      }
      editorTools.close({ restoreFocus: false });
      bookmarkListQuery = "";
      bookmarkListOpen = true;
    },
    openSnippetInsert: () => {
      if (quickOpenOpen) {
        quickOpenOpen = false;
      }
      if (commandPaletteOpen) {
        commandPaletteOpen = false;
      }
      if (headingJumpOpen) {
        headingJumpOpen = false;
      }
      if (bookmarkListOpen) {
        bookmarkListOpen = false;
      }
      editorTools.close({ restoreFocus: false });
      const host = editorWorkbench.getActiveHost();
      snippetInsertHostIdentity = host ? { ...host.identity } : null;
      snippetInsertQuery = "";
      snippetInsertOpen = true;
    },
    openCommandPalette: () => {
      if (quickOpenOpen) {
        quickOpenOpen = false;
      }
      if (headingJumpOpen) {
        headingJumpOpen = false;
      }
      if (bookmarkListOpen) {
        bookmarkListOpen = false;
      }
      if (snippetInsertOpen) {
        closeSnippetInsert();
      }
      editorTools.close({ restoreFocus: false });
      commandPaletteQuery = "";
      commandPaletteOpen = true;
    },
    setConsoleOpen: (open) => {
      consoleOpen = open;
    },
  });

  const { openAndActivatePath, consumeOpenedPaths, onTabActivated } = createAppShellFileHandlers({
    getCurrentWindowId: () => currentWindowId,
    getRuntimeReady: () => runtimeReady,
    notify,
  });

  const {
    handleConfirmLargeFile,
    handleDocumentScrollTop,
    scheduleUntitledTitleRefresh,
    runGoToLine,
    clearUntitledTitleDebounceTimer,
  } = createAppShellEditorHandlers({
    getDocument: (documentId) =>
      documents.find((documentState) => documentState.id === documentId),
    getLargeFileConfirming: () => largeFileConfirming,
    setLargeFileConfirming: (value) => {
      largeFileConfirming = value;
    },
    getGoToLineValue: () => editorTools.getSnapshot().goToLineValue,
    getEditorRunner: () => editorWorkbench.getActiveRunner(),
    getUntitledTitleDebounceTimer: () => untitledTitleDebounceTimer,
    setUntitledTitleDebounceTimer: (timer) => {
      untitledTitleDebounceTimer = timer;
    },
    notify,
  });

  function handleAddWorkspace(): void {
    runCommand("workspace.add");
  }

  function handleOpenWorkspaceManager(): void {
    runCommand("app.openWorkspaceManager");
  }

  /**
   * Manager row "Settings" action: switch to the workspace and focus its
   * `workspace-settings` view tab (same flow as the rail context menu).
   */
  function handleOpenWorkspaceSettingsFromManager(workspaceId: ContextId): void {
    openSettingsFromContextMenu(workspaceId);
  }

  function handleOpenVersionControlFromManager(workspaceId: ContextId): void {
    openVersionControlFromContextMenu(workspaceId);
  }

  /** Switches to the notepad context and selects the given tab. */
  function handleSelectNotepadTab(tabId: string): void {
    appState.switchContext("notepad");
    appState.selectTab(tabId);
  }

  /**
   * "Add multiple…" flow (decision 8): folder picker → list immediate
   * subfolders → modal with checkboxes (default unchecked, existing excluded)
   * → batch add. Reuses the same add logic per path as `workspace.add`
   * (duplicates skipped, access errors notified).
   */
  async function handleOpenAddMultipleWorkspaces(): Promise<void> {
    const parent = await openFolderDialog();
    if (!parent) {
      return;
    }
    addMultipleOpen = true;
    addMultipleLoading = true;
    addMultipleError = null;
    addMultipleParentPath = parent;
    addMultipleEntries = [];
    addMultipleSelected = new Set();
    try {
      const existing = new Set(
        workspaces.map((workspace) => normalizePathSync(workspace.rootPath)),
      );
      const entries = await collectImmediateSubfolders(parent, existing);
      addMultipleEntries = entries;
    } catch (error) {
      addMultipleError = error instanceof Error ? error.message : String(error);
    } finally {
      addMultipleLoading = false;
    }
  }

  function toggleAddMultipleEntry(path: string, checked: boolean): void {
    const next = new Set(addMultipleSelected);
    if (checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    addMultipleSelected = next;
  }

  async function handleConfirmAddMultiple(notify: (message: string) => void): Promise<void> {
    const selectedPaths = [...addMultipleSelected];
    addMultipleOpen = false;
    addMultipleEntries = [];
    addMultipleSelected = new Set();
    addMultipleParentPath = null;
    let added = 0;
    let blocked = 0;
    for (const path of selectedPaths) {
      const created = appState.addWorkspace(path);
      if (created) {
        added += 1;
      } else {
        blocked += 1;
      }
    }
    if (added > 0) {
      markWorkspaceLifecycleActive();
    }
    const parts: string[] = [];
    if (added > 0) {
      parts.push(`Added ${added} workspace${added === 1 ? "" : "s"}.`);
    }
    if (blocked > 0) {
      parts.push(`${blocked} already open or blocked.`);
    }
    if (parts.length > 0) {
      notify(parts.join(" "));
    }
  }

  function handleCancelAddMultiple(): void {
    addMultipleOpen = false;
    addMultipleEntries = [];
    addMultipleSelected = new Set();
    addMultipleError = null;
    addMultipleParentPath = null;
  }

  onMount(() => {
    registerTabsChangedSessionFlush((state) => {
      void flushSessionPersistence(state, getCurrentWebviewWindow().label);
    });

    // Reflect the global workspace hide-from-rail preferences (loaded during
    // runtime startup) and keep the rail filter reactive to later toggles.
    workspaceHiddenRootPaths = getHiddenRootPaths();
    const unsubscribeWorkspacePreferences = subscribeWorkspacePreferences((hidden) => {
      workspaceHiddenRootPaths = new Set(hidden);
    });

    const shellCleanup = setupAppShellMount({
      registerSettingsDialogOpener,
      setupLayoutObserver,
      startAppShellRuntime,
      notify,
      runCommand,
      openAndActivatePath,
      consumeOpenedPaths,
      restoreWorkspaceSession,
      loadProjectTreeRoot,
      notifyProjectTreeFilesystemChange,
      setConsoleHeightPx: (heightPx) => {
        consoleHeightPx = heightPx;
      },
      setRuntimeSyncExternalFileWatcher: (sync) => {
        runtimeSyncExternalFileWatcher = sync;
      },
      setCurrentWindowId: (windowId) => {
        currentWindowId = windowId;
      },
      setLastSelectedTabId: (tabId) => {
        lastSelectedTabId = tabId;
      },
      setRuntimeReady: (ready) => {
        runtimeReady = ready;
      },
      routePathToLastActiveWindow,
      getCurrentWebviewWindowLabel: () => getCurrentWebviewWindow().label,
      handleKeydown,
      stopChatAccessMonitor,
      flushSessionBeforeUnload: () =>
        flushSessionPersistence(appState.getSnapshot(), getCurrentWebviewWindow().label),
      cleanup: {
        disconnectLayoutObserver,
        clearUntitledTitleDebounceTimer,
      },
    });
    return () => {
      unsubscribeWorkspacePreferences();
      shellCleanup();
    };
  });

  $effect(() => {
    activeTab;
    isChatHttpActive;
    chatHttpRailVisible;
    activeContextId;
    activeWorkspaceRoot;
    isSessionTabActive;
    selectedSessionId;
    lastChatScopeKey;
    syncSessionTabEffect({
      activeTab,
      isChatHttpActive,
      chatHttpRailVisible,
      activeContextId,
      activeWorkspaceRoot,
      isSessionTabActive,
      selectedSessionId,
      lastChatScopeKey,
      ensureChatHttpSessionTab,
      restoreWorkspaceSession,
      setLastChatScopeKey: (key) => {
        lastChatScopeKey = key;
      },
    });
  });

  $effect(() => {
    runtimeReady;
    snapshot;
    currentWindowId;
    activeWorkspaceRoot;
    selectedSessionId;
    session.lastActiveSessionId;
    sessionSelectedTabId;
    lastSelectedTabId;
    syncSessionPersistenceEffect({
      runtimeReady,
      snapshot,
      currentWindowId,
      activeWorkspaceRoot,
      selectedSessionId,
      sessionLastActiveSessionId: session.lastActiveSessionId,
      selectedTabId: sessionSelectedTabId,
      lastSelectedTabId,
      onTabActivated,
      setLastSelectedTabId: (tabId) => {
        lastSelectedTabId = tabId;
      },
    });
    syncSettingsPersistenceEffect({ runtimeReady, currentWindowId, snapshot });
  });

  /**
   * M6-T4/T5 — fire sound + OS notifications when an agent in the active
   * workspace finishes, requests permission/question, or errors. Reacts to
   * chatStore runtime transitions (per agent) and the appearance settings.
   */
  $effect(() => {
    runtimeReady;
    activeRuntimeBySessionId;
    snapshot.settings.soundSettings;
    snapshot.settings.osNotificationSettings;
    if (!runtimeReady) {
      return;
    }
    sessionNotificationObserver.update({
      activeScopeKey: activeRuntimeBySessionId.scopeKey,
      runtimeBySessionId: activeRuntimeBySessionId.runtimeBySessionId,
      settings: {
        sound: snapshot.settings.soundSettings,
        osNotifications: snapshot.settings.osNotificationSettings,
      },
    });
  });

  $effect(() => {
    // Sidecar health depends on session-tab active; keep that dep here only.
    const effectStartedAt = nowMs();
    runtimeReady;
    isWorkspaceLifecycleActive();
    activeWorkspaceRoot;
    isChatHttpActive;
    isSessionTabActive;
    syncOpencodeSidecarEffect({
      runtimeReady,
      workspaceLifecycleActive: isWorkspaceLifecycleActive(),
      activeWorkspaceRoot,
      isChatHttpActive,
      isSessionTabActive,
      opencodeEnabled,
      opencodeMode,
      opencodeBaseUrl,
      opencodeSidecarPort,
      setOpencodeHealth: (patch) => appState.applyPersistedSettings({ opencodeHealth: patch }),
    });
    syncOpencodeToggleEffect({
      runtimeReady,
      opencodeEnabled,
      opencodeMode,
    });
    void logPerfTiming(
      "tab/workspace shell effect scheduled",
      {
        metric: "tab.activationSideEffects",
        durationMs: elapsedMs(effectStartedAt),
        label: "shell-sidecar-effect",
        runtimeReady,
        isChatHttpActive,
        isSessionTabActive,
        hasWorkspaceRoot: Boolean(activeWorkspaceRoot),
      },
      "debug",
    );
  });

  $effect(() => {
    // Project tree: workspace-root / chat-http / runtimeReady only — not tab churn.
    const effectStartedAt = nowMs();
    runtimeReady;
    activeWorkspaceRoot;
    isChatHttpActive;
    syncProjectTreeWatcherEffect({
      runtimeReady,
      activeWorkspaceRoot,
      isChatHttpActive,
      projectTreeController,
      loadProjectTreeRoot,
    });
    void logPerfTiming(
      "project tree shell effect scheduled",
      {
        metric: "tab.activationSideEffects",
        durationMs: elapsedMs(effectStartedAt),
        label: "shell-project-tree-effect",
        runtimeReady,
        isChatHttpActive,
        hasWorkspaceRoot: Boolean(activeWorkspaceRoot),
      },
      "debug",
    );
  });

  $effect(() => {
    activeWorkspaceRoot;
    isChatHttpActive;
    syncWorkspaceFileCatalogEffect({
      activeWorkspaceRoot,
      isChatHttpActive,
      catalog: workspaceFileCatalog,
      registry: workspaceFileCatalogRegistry,
    });
    // M1.2 — close the Quick Open picker on workspace switch so no path from a
    // prior workspace can be opened after a switch. The catalog retargets
    // asynchronously; closing is the simplest safe behavior.
    // M7.1/M7.2 — close the heading-jump and bookmark-list pickers too: their
    // host-scoped data belongs to the previous context's active editor.
    if (quickOpenOpen) {
      quickOpenOpen = false;
    }
    if (commandPaletteOpen) {
      commandPaletteOpen = false;
    }
    if (headingJumpOpen) {
      headingJumpOpen = false;
    }
    if (bookmarkListOpen) {
      bookmarkListOpen = false;
    }
    if (snippetInsertOpen) {
      closeSnippetInsert();
    }
    // M8 — cancel and clear project search on workspace switch so results from
    // the previous workspace never open after the switch.
    if (projectSearchOpen) {
      projectSearchGeneration += 1;
      projectSearchResults = [];
      projectSearchStatus = "";
      projectSearchRunning = false;
    }
  });

  // M6.2/M7.1/M7.2 — close Markdown-only pickers when the active document is no
  // longer Markdown-editable, and close host-scoped pickers when document
  // identity changes (stale host data).
  $effect(() => {
    const docId = activeDocument?.id;
    const language = activeDocument?.language;
    void docId;
    if (headingJumpOpen && language !== "markdown") {
      headingJumpOpen = false;
    }
    if (snippetInsertOpen && language !== "markdown") {
      closeSnippetInsert();
    }
  });

  $effect(() => {
    documentView.activeDocumentPath;
    isChatHttpActive;
    activeWorkspaceRoot;
    syncActiveFileTreeExpandEffect({
      activeDocumentPath: documentView.activeDocumentPath,
      isChatHttpActive,
      activeWorkspaceRoot,
      projectTreeController,
    });
  });

  $effect(() => {
    runtimeReady;
    opencodeEnabled;
    opencodeMode;
    opencodeBaseUrl;
    opencodeSidecarPort;
    activeWorkspaceRoot;
    if (!runtimeReady) {
      return;
    }
    requestOpencodeHealthRefresh({
      opencodeEnabled,
      opencodeMode,
      opencodeBaseUrl,
      opencodeSidecarPort,
      activeWorkspaceRoot,
      setOpencodeHealth: (patch) => appState.applyPersistedSettings({ opencodeHealth: patch }),
    });
  });

  /**
   * M13.5 — deduped snackbar on hard sidecar failure. Emits one status
   * message per distinct failure signature (kind+message); re-emitting the
   * same signature (e.g. on tab switch while breaker is active) does not
   * flash a second snackbar. Cleared when the signature changes.
   */
  let lastHardFailureSignature = "";
  $effect(() => {
    const health = snapshot.settings.opencodeHealth;
    if (health.status !== "error") {
      return;
    }
    const signature = health.lastErrorMessage ?? "error";
    if (signature === lastHardFailureSignature) {
      return;
    }
    lastHardFailureSignature = signature;
    notify("OpenCode could not start. Check Settings → Workspaces → OpenCode.");
  });

  $effect(() => {
    // External file watcher: only path-affecting state (watch flag + open file paths).
    runtimeReady;
    runtimeSyncExternalFileWatcher;
    externalWatcherSyncKey;
    syncExternalFileWatcherEffect({
      runtimeReady,
      snapshot: untrack(() => snapshot),
      syncExternalFileWatcher: runtimeSyncExternalFileWatcher,
    });
  });

  $effect(() => {
    runtimeReady;
    isSessionTabActive;
    activeWorkspaceRoot;
    isChatHttpActive;
    syncChatAccessMonitorEffect({
      runtimeReady,
      isSessionTabActive,
      activeWorkspaceRoot,
      isChatHttpActive,
    });
  });

  $effect(() => {
    activeContextId;
    shellMainRowWidth;
    editorPaneWidth;
    workspaceLayout;
    consoleOpen;
    syncWorkspaceContextEffect({
      activeContextId,
      handleActiveContextSwitch,
    });
    syncResponsiveLayoutEffect({ applyResponsiveLayoutRules });
  });

  /**
   * M5-T1 — TODO panel auto-refresh. Loads `session.todo` when the panel is
   * open for a linked agent session, re-fetches whenever the active session
   * changes, and re-fetches after each completed turn (the agent may have
   * emitted a `todowrite`). Stale per-session cache is cleared when the
   * active agent session changes so closed sessions don't linger.
   */
  let lastTodoScopeKey = $state<string | null>(null);
  $effect(() => {
    runtimeReady;
    activeWorkspaceRoot;
    activeOpencodeSessionId;
    todoPanelOpen;
    session.lastActiveSessionId;
    const isGenerating = chatStore.getRuntimeState().isGenerating;
    void isGenerating;

    const root = activeWorkspaceRoot;
    const sessionId = activeOpencodeSessionId;
    const scopeKey = root && sessionId ? `${root}|${sessionId}` : null;

    // Clear cache for the previously-active session when the scope changes.
    if (lastTodoScopeKey && lastTodoScopeKey !== scopeKey) {
      const [prevRoot, prevSession] = lastTodoScopeKey.split("|");
      if (prevRoot && prevSession) {
        clearSessionTodos(prevRoot, prevSession);
        clearSessionDiffs(prevRoot, prevSession);
      }
    }
    lastTodoScopeKey = scopeKey;

    if (!runtimeReady || !todoPanelOpen || !root || !sessionId) {
      return;
    }
    void refreshSessionTodos({ workspaceRootPath: root, sessionId });
  });

  /**
   * M5-T2 — diff viewer auto-refresh. Loads `session.diff` when the panel is
   * open for a linked agent session, re-fetches on session change and after
   * each completed turn (file changes land once the agent finishes editing).
   */
  $effect(() => {
    runtimeReady;
    activeWorkspaceRoot;
    activeOpencodeSessionId;
    diffPanelOpen;
    session.lastActiveSessionId;
    const isGenerating = chatStore.getRuntimeState().isGenerating;
    void isGenerating;

    if (!runtimeReady || !diffPanelOpen) {
      return;
    }
    const root = activeWorkspaceRoot;
    const sessionId = activeOpencodeSessionId;
    if (!root || !sessionId) {
      return;
    }
    void refreshSessionDiffs({ workspaceRootPath: root, sessionId });
  });

  /**
   * M5-T3 — project-tree file-status badges. Refreshes `file.status` when the
   * workspace changes and after each completed turn (the agent's edits land
   * on disk once the turn finishes). Stale per-workspace cache is cleared on
   * switch.
   *
   * M13.5 — file-status refresh: git-backed workspaces use system git and
   * refresh on any editor tab; non-git workspaces still gate OpenCode
   * `file.status` on `isSessionTabActive`.
   */
  let lastFileStatusWorkspace = $state<string | null>(null);
  $effect(() => {
    runtimeReady;
    activeWorkspaceRoot;
    isSessionTabActive;
    session.lastActiveSessionId;
    const isGenerating = chatStore.getRuntimeState().isGenerating;
    void isGenerating;

    const root = activeWorkspaceRoot;
    if (lastFileStatusWorkspace && lastFileStatusWorkspace !== root) {
      clearFileStatusTracker(lastFileStatusWorkspace);
    }
    lastFileStatusWorkspace = root;

    if (!runtimeReady || !root) {
      return;
    }
    void refreshFileStatuses({
      workspaceRootPath: root,
      allowOpencode: isSessionTabActive,
    });
  });

  /**
   * M10-T3 — invalidate the workspace-scoped pull-only stores on workspace
   * switch so the process-lifetime cache doesn't accumulate an entry per
   * workspace ever opened (slow leak in a long-running desktop app). The
   * per-session (todo/diff) and reactive workspace (file-status /
   * status-summary) stores are cleared by their own effects above; this covers
   * the remaining catalog / config / commands pull-only stores.
   */
  let lastWorkspaceStoreRoot = $state<string | null>(null);
  $effect(() => {
    runtimeReady;
    activeWorkspaceRoot;

    const root = activeWorkspaceRoot;
    if (lastWorkspaceStoreRoot && lastWorkspaceStoreRoot !== root) {
      clearOpencodeCatalog(lastWorkspaceStoreRoot);
      clearOpencodeConfigStore(lastWorkspaceStoreRoot);
      clearOpencodeCommands(lastWorkspaceStoreRoot);
    }
    lastWorkspaceStoreRoot = root;
  });
</script>

<AppShell
  bind:shellMainRowEl
  bind:editorShellEl
  bind:editorPaneEl
  bind:workspaceContextMenuEl
  bind:consoleHeightPx
  {consoleOpen}
  onConsoleHeightCommit={persistConsoleHeightNow}
  projectSearch={{
    open: projectSearchOpen,
    heightPx: projectSearchHeightPx,
    focusNonce: projectSearchNonce,
    focusReplace: projectSearchFocusReplace,
    query: projectSearchQuery,
    replaceValue: projectSearchReplace,
    caseSensitive: projectSearchCaseSensitive,
    wholeWord: projectSearchWholeWord,
    regex: projectSearchRegex,
    queryError: projectSearchQueryError,
    results: projectSearchResults,
    running: projectSearchRunning,
    status: projectSearchStatus,
    onHeightCommit: persistProjectSearchHeightNow,
    onHeightChange: (heightPx) => {
      projectSearchHeightPx = heightPx;
    },
    onClose: closeProjectSearch,
    onQueryChange: (value) => {
      projectSearchQuery = value;
    },
    onReplaceValueChange: (value) => {
      projectSearchReplace = value;
    },
    onCaseSensitiveChange: (value) => {
      projectSearchCaseSensitive = value;
    },
    onWholeWordChange: (value) => {
      projectSearchWholeWord = value;
    },
    onRegexChange: (value) => {
      projectSearchRegex = value;
    },
    onRunSearch: () => {
      void runProjectSearch();
    },
    onReplaceAll: () => {
      void replaceAllInProject();
    },
    onOpenResult: (path, line) => {
      void openProjectSearchResult(path, line);
    },
  }}
  activityRail={{
    show: true,
    workspaces: railWorkspaces,
    activeContextId,
    chatHttpRailVisible,
    panelWidthPx: normalizeActivityRailWidthPx(snapshot.activityRailWidthPx),
    notepadOpenTabCount,
    notepadRecentTabs,
    contextMenuWorkspaceId: workspaceContextMenu?.workspaceId ?? null,
    onSelectContext: handleSelectContext,
    onAddWorkspace: handleAddWorkspace,
    onOpenWorkspaceManager: handleOpenWorkspaceManager,
    onPanelWidthChange: handleActivityRailWidthChange,
    onRequestCloseWorkspace: handleOpenWorkspaceContextMenu,
    onReorderWorkspaces: (fromIndex, toIndex) => appState.reorderWorkspaces(fromIndex, toIndex),
    onSelectNotepadTab: handleSelectNotepadTab,
  }}
  sessionsSidebar={{
    show: (Boolean(activeWorkspaceRoot) && opencodeEnabled) || isChatHttpActive,
    sessions: workspaceSessions,
    activeSessionId: selectedSessionId,
    sidebarTitle: isChatHttpActive ? "Chats" : "Sessions",
    collapsed: !showSessionsSidebar,
    panelWidthPx: workspaceLayout.sessionsSidebarWidthPx,
    onToggleCollapsed: toggleSessionsSidebarCollapsed,
    onPanelWidthChange: handleSessionsSidebarWidthChange,
    onSelectSession: handleSelectSession,
    onNewSession: handleNewSession,
    onDeleteSession: handleDeleteSession,
    onRenameSession: handleRenameSession,
    onShareSession: (sessionId) => {
      void handleShareSession(sessionId);
    },
    onExportSession: handleExportSession,
    onOpenSessions: openSessionListPanel,
  }}
  projectTree={{
    workspaceRoot: activeWorkspaceRoot,
    state: projectTreeControllerState,
    activeFilePath: documentView.activeDocumentPath,
    statusByPath: fileStatusByPath,
    collapsed: !showProjectPanel,
    panelWidthPx: workspaceLayout.projectPanelWidthPx,
    onRefresh: refreshProjectTree,
    onToggleHidden: toggleProjectTreeHidden,
    onToggleCollapsed: toggleProjectPanelCollapsed,
    onPanelWidthChange: handleProjectPanelWidthChange,
    onToggleDirectory: handleToggleProjectTreeDirectory,
    onOpenFile: handleOpenProjectTreeFile,
    onMoveEntry: handleMoveProjectTreeEntry,
    onNewFile: handleNewProjectFile,
    onNewFolder: handleNewProjectFolder,
    onRenameEntry: handleRenameProjectEntry,
    onDeleteEntry: handleDeleteProjectEntry,
    getPaneElements: () => collectPaneElementsFromDom(),
    onOpenFileInPane: handleOpenProjectTreeFileInPane,
    onFileDropPaneChange: (paneId) => {
      fileDropTargetPaneId = paneId;
    },
    notify,
  }}
  editor={{
    session,
    documents,
    activeDocument,
    isChatHttpActive,
    workspaceRootPath: activeWorkspaceRoot,
    workspaceManager: {
      workspaces,
      activeContextId,
      hiddenRootPaths: workspaceHiddenRootPaths,
      onAddWorkspace: handleAddWorkspace,
      onAddMultiple: handleOpenAddMultipleWorkspaces,
      onSelectWorkspace: handleSelectContext,
      onOpenWorkspaceSettings: handleOpenWorkspaceSettingsFromManager,
      onOpenVersionControl: handleOpenVersionControlFromManager,
    },
    isSessionTabActive,
    isSettingsViewActive,
    isThemesViewActive,
    isViewTabActive,
    isImageDocument: documentView.isImageDocument,
    isBinaryDocument: documentView.isBinaryDocument,
    isLargePendingDocument: documentView.isLargePendingDocument,
    isTextEditorDocument: documentView.isTextEditorDocument,
    isMarkdownDocument: documentView.isMarkdownDocument,
    previewFileSizeBytes: documentView.previewFileSizeBytes,
    markdownHtml: documentView.markdownHtml,
    previewMode: snapshot.editor.previewMode,
    wrapLines: snapshot.editor.wrapLines,
    zoomPercent: snapshot.editor.zoomPercent,
    cursorLine: snapshot.editor.cursorLine,
    cursorColumn: snapshot.editor.cursorColumn,
    selectionCount: snapshot.editor.selectionCount,
    decoratePlaintextSymbols: snapshot.settings.decoratePlaintextSymbols,
    showMinimap: snapshot.settings.showMinimap,
    showFoldGutter: snapshot.settings.showFoldGutter,
    autoClosePairs: snapshot.settings.autoClosePairs,
    autoSuggest: snapshot.settings.autoSuggest,
    maxBinaryOpenAsTextBytes: snapshot.settings.externalFiles.maxBinaryOpenAsTextBytes,
    maxOpenWithoutConfirmBytes: snapshot.settings.externalFiles.maxOpenWithoutConfirmBytes,
    canFitMarkdownSplit: canFitMarkdownSplit(),
    currentWindowId,
    onCloseTab: handleCloseTab,
    onSelectTab: appState.selectTab,
    onClosePane: appState.closeEditorPane,
    onFocusPane: appState.setActiveEditorPane,
    onMoveTabBetweenPanes: (fromPaneId, tabId, toPaneId, toIndex) =>
      appState.moveTabBetweenPanes(fromPaneId, tabId, toPaneId, toIndex),
    onOpenFileInPane: (filePath, paneId) => handleOpenProjectTreeFileInPane(filePath, paneId),
    fileDropTargetPaneId,
    onFileDropPaneChange: (paneId) => {
      fileDropTargetPaneId = paneId;
    },
    onRunCommand: runCommand,
    onConfirmLargeFile: handleConfirmLargeFile,
    onMarkdownViewModeChange: setMarkdownViewMode,
    onUntitledTitleRefresh: scheduleUntitledTitleRefresh,
    onScrollTopChange: handleDocumentScrollTop,
    onDeleteSessionFromChat: handleDeleteSessionFromChat,
    onGoToLine: runGoToLine,
    notify,
    onForkSession: (messageId?: string) => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void handleForkSession(sessionId, messageId);
      }
    },
    onRevertSession: (messageId?: string) => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void handleRevertSession(sessionId, messageId);
      }
    },
    onUnrevertSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void handleUnrevertSession(sessionId);
      }
    },
    onShareSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void handleShareSession(sessionId);
      }
    },
    onUnshareSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void handleUnshareSession(sessionId);
      }
    },
    onSummarizeSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void handleSummarizeSession(sessionId);
      }
    },
    onExportSession: () => {
      const sessionId = chatStore.getActiveSessionId();
      if (sessionId) {
        void handleExportSession(sessionId);
      }
    },
    activeShareUrl,
    activeParentSessionId,
  }}
  statusBar={{
    statusPath: documentView.statusPath,
    statusMessage,
    consoleOpen,
    canOpenLogsPanel: snapshot.settings.logSettings.canOpenLogsPanel,
    onToggleConsole: handleToggleConsole,
  }}
  workspaceContextMenu={{
    menu: workspaceContextMenu,
    menuIndex: workspaceContextMenuIndex(),
    workspaceCount: workspaces.length,
    onMoveUp: () => moveWorkspaceFromContextMenu("up"),
    onMoveDown: () => moveWorkspaceFromContextMenu("down"),
    onOpenSettings: openSettingsFromContextMenu,
    onOpenVersionControl: openVersionControlFromContextMenu,
    onCloseWorkspace: closeWorkspaceFromContextMenu,
  }}
  overlays={{
    notify,
  }}
  sessionListPanel={{
    open: sessionListOpen,
    sessions: sessionListSessions,
    openSessionIds,
    activeSessionId: activeSessionEntry?.opencodeSessionId ?? null,
    loading: sessionListLoading,
    errorMessage: sessionListError,
    sort: sessionListSort,
    searchQuery: sessionListSearch,
    onOpenSession: (sessionId, title) => {
      void handleOpenSessionFromList(sessionId, title);
    },
    onClose: closeSessionListPanel,
    onSearchChange: (query) => {
      sessionListSearch = query;
      void refreshSessionList();
    },
    onSortChange: (next) => {
      sessionListSort = next;
    },
    onRefresh: () => {
      void refreshSessionList();
    },
  }}
  addMultipleWorkspaces={{
    open: addMultipleOpen,
    loading: addMultipleLoading,
    errorMessage: addMultipleError,
    parentPath: addMultipleParentPath,
    entries: addMultipleEntries,
    selected: addMultipleSelected,
    onToggleEntry: toggleAddMultipleEntry,
    onConfirm: () => {
      void handleConfirmAddMultiple(notify);
    },
    onCancel: handleCancelAddMultiple,
  }}
  todoPanel={{
    open: todoPanelOpen && Boolean(activeWorkspaceRoot) && Boolean(activeOpencodeSessionId),
    workspaceRootPath: activeWorkspaceRoot,
    sessionId: activeOpencodeSessionId,
    onToggle: () => {
      todoPanelOpen = !todoPanelOpen;
    },
  }}
  diffPanel={{
    open: diffPanelOpen && Boolean(activeWorkspaceRoot) && Boolean(activeOpencodeSessionId),
    workspaceRootPath: activeWorkspaceRoot,
    sessionId: activeOpencodeSessionId,
    onToggle: () => {
      diffPanelOpen = !diffPanelOpen;
    },
    onOpenFile: (filePath) => {
      // OpenCode diff paths are workspace-relative; resolve to an absolute
      // path before opening (matches the project-tree path convention).
      const resolved = resolveWorkspaceRelativePath(activeWorkspaceRoot, filePath);
      void handleOpenProjectTreeFile(resolved);
    },
  }}
  timelineDialog={{
    open: timelineOpen,
    messages: activeMessages,
    searchQuery: timelineSearch,
    onJumpToMessage: (messageId) => {
      // Dispatch a custom event the ChatMessageList can listen for to scroll
      // the target message into view. Best-effort: a no-op when no listener.
      window.dispatchEvent(
        new CustomEvent("specops:scroll-to-message", { detail: { messageId } }),
      );
    },
    onToggle: () => {
      timelineOpen = true;
    },
    onClose: () => {
      timelineOpen = false;
    },
    onSearchChange: (query) => {
      timelineSearch = query;
    },
  }}
  quickOpen={{
    open: quickOpenOpen,
    results: quickOpenResults,
    onSelect: (path) => {
      void handleQuickOpenSelect(path);
    },
    onClose: closeQuickOpen,
    onRefresh: refreshQuickOpenCatalog,
    onQueryInput: (value) => {
      quickOpenQuery = value;
    },
  }}
  commandPalette={{
    open: commandPaletteOpen,
    results: commandPaletteResults,
    onSelect: (commandId) => {
      commandPaletteOpen = false;
      runCommand(commandId as AppCommandId);
    },
    onClose: closeCommandPalette,
    onQueryInput: (value) => {
      commandPaletteQuery = value;
    },
  }}
  headingJump={{
    open: headingJumpOpen,
    results: headingJumpResults,
    onSelect: handleHeadingJumpSelect,
    onClose: closeHeadingJump,
    onQueryInput: (value) => {
      headingJumpQuery = value;
    },
  }}
  bookmarkList={{
    open: bookmarkListOpen,
    bookmarks: bookmarkListSnapshots,
    onSelect: handleBookmarkListSelect,
    onClose: closeBookmarkList,
    onQueryInput: (value) => {
      bookmarkListQuery = value;
    },
  }}
  snippetInsert={{
    open: snippetInsertOpen,
    results: snippetInsertResults,
    onSelect: handleSnippetInsertSelect,
    onClose: closeSnippetInsert,
    onQueryInput: (value) => {
      snippetInsertQuery = value;
    },
  }}
/>
