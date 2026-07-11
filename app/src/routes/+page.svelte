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
    findDocumentByPath,
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
    CHAT_HTTP_CONTEXT_ID,
    getSessionActiveTab,
    getSessionSelectedTabId,
    getSessionTabs,
    isFileTab,
    type ContextId,
    tabDocumentId,
  } from "../lib/domain/contracts";
  import { createProjectTreeController, type ProjectTreeControllerState } from "../lib/services/projectTreeController";
  import { collectPaneElementsFromDom } from "../lib/components/paneDropTargets";
  import { probeWorkspaceReadAccess } from "../lib/services/fileSystem";
  import { stopChatAccessMonitor } from "../lib/services/chatAccessMonitor";
  import { formatNotepadTabLabel } from "../lib/services/notepadTabLabel";
  import { DEFAULT_CONSOLE_HEIGHT_PX } from "../lib/services/consoleTabPrefs";
  import {
    searchInProject,
    totalMatchCount,
    type ProjectSearchResult,
  } from "../lib/services/projectSearch";
  import { replaceInProjectFile } from "../lib/services/projectFileOps";
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
  let projectSearchResults = $state<ProjectSearchResult[]>([]);
  let projectSearchRunning = $state(false);
  let projectSearchStatus = $state("");
  let projectSearchNonce = $state(0);
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
    return editorWorkbench.subscribeCursorStatus(({ line, column }) => {
      appState.setCursor(line, column);
    });
  });

  $effect(() => {
    return subscribeDocumentDiskReload((documentId) => {
      editorSessionCache.invalidateDocument(documentId);
    });
  });

  $effect(() => {
    const openIds = new Set(documents.map((document) => document.id));
    editorSessionCache.retainDocuments(openIds);
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
      Boolean(workspaceContextMenu),
  });
  setEditorToolController(editorTools);

  onDestroy(() => {
    editorWorkbench.dispose();
    editorSessionCache.clear();
    editorTools.dispose();
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
  const sessionTabs = $derived(getSessionTabs(session));
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
  const notepadOpenTabCount = $derived(getSessionTabs(notepadSession).length);
  const notepadRecentTabs = $derived.by(() => {
    const notepadDocs = snapshot.contexts.notepad.documents;
    const fileTabs = getSessionTabs(notepadSession)
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
    projectSearchOpen = false;
  }

  /**
   * Find-in-Project panel height is not persisted yet (no dedicated pref store);
   * the commit hook is a no-op so the resize handle still works in-session.
   */
  function persistProjectSearchHeightNow(): void {
    // intentionally empty — height resets to default each session.
  }

  async function runProjectSearch(): Promise<void> {
    const query = projectSearchQuery.trim();
    const root = activeWorkspaceRoot;
    if (!query || !root) {
      projectSearchResults = [];
      projectSearchStatus = root ? "Type a search term." : "Open a workspace to search.";
      return;
    }
    projectSearchRunning = true;
    projectSearchStatus = "Searching…";
    try {
      const results = await searchInProject(root, query, {
        caseSensitive: projectSearchCaseSensitive,
      });
      projectSearchResults = results;
      const files = results.length;
      const matches = totalMatchCount(results);
      projectSearchStatus =
        matches === 0
          ? "No results"
          : `${matches} result${matches === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}`;
    } catch (error: unknown) {
      projectSearchStatus = `Search failed: ${getErrorMessage(error)}`;
    } finally {
      projectSearchRunning = false;
    }
  }

  async function replaceAllInProject(): Promise<void> {
    const query = projectSearchQuery.trim();
    const root = activeWorkspaceRoot;
    if (!query || !root || projectSearchResults.length === 0) {
      notify("Nothing to replace.");
      return;
    }
    projectSearchRunning = true;
    projectSearchStatus = "Replacing…";
    let replaced = 0;
    let files = 0;
    let failures = 0;
    try {
      for (const result of projectSearchResults) {
        const outcome = await replaceInProjectFile(
          root,
          result.path,
          query,
          projectSearchReplace,
          projectSearchCaseSensitive,
        );
        if (outcome.ok) {
          replaced += outcome.count;
          files += 1;
          syncOpenDocumentAfterReplace(result.path, outcome.content);
        } else if (outcome.reason !== "No matches.") {
          failures += 1;
        }
      }
      projectSearchStatus = `Replaced ${replaced} occurrence(s) in ${files} file(s)${
        failures > 0 ? `; ${failures} file(s) failed` : ""
      }`;
      notify(`Replaced ${replaced} occurrence(s) in ${files} file(s).`);
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

  /**
   * After replace-on-disk, refresh any open editor document for that path so the
   * buffer picks up the new content instead of showing stale (now-dirty) text.
   */
  function syncOpenDocumentAfterReplace(path: string, content: string): void {
    const document = findDocumentByPath(appState.getSnapshot(), path);
    if (!document) {
      return;
    }
    appState.setDocumentContent(document.id, content);
    appState.markDocumentSaved(document.id, path, content);
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
      Boolean(workspaceContextMenu),
    openProjectSearch: (focusReplace) => {
      projectSearchOpen = true;
      projectSearchFocusReplace = focusReplace;
      projectSearchNonce += 1;
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
    getActiveDocument: () => activeDocument,
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
      flushSessionBeforeUnload: () => {
        void flushSessionPersistence(appState.getSnapshot(), getCurrentWebviewWindow().label);
      },
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
    decoratePlaintextSymbols: snapshot.settings.decoratePlaintextSymbols,
    showMinimap: snapshot.settings.showMinimap,
    maxBinaryOpenAsTextBytes: snapshot.settings.externalFiles.maxBinaryOpenAsTextBytes,
    maxOpenWithoutConfirmBytes: snapshot.settings.externalFiles.maxOpenWithoutConfirmBytes,
    largeFileConfirming,
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
/>
