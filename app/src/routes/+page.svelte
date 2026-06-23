<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "../lib/components/AppShell.svelte";
  import { isChatHttpRailVisible } from "../lib/ai/providers/chatHttpRailGating";
  import { isAgentEditorPaneActive } from "../lib/components/editorRouting";
  import { createAppShellAgentHandlers } from "../lib/services/appShellAgentHandlers";
  import { createAppShellLayoutHandlers } from "../lib/services/appShellLayoutHandlers";
  import {
    createAppShellCommandHandlers,
    createAppShellEditorHandlers,
    createAppShellFileHandlers,
    setupAppShellMount,
  } from "../lib/services/appShellPageHandlers";
  import { createAppShellProjectTreeHandlers } from "../lib/services/appShellProjectTreeHandlers";
  import type { EditorCommandRunner } from "../lib/types/editor";
  import { appState } from "../lib/state/appState";
  import { getActiveContextSnapshot } from "../lib/state/appState/contextHelpers";
  import {
    chatActiveAgentId,
    chatActiveRuntimeByAgentId,
    chatAgentIndex,
    chatStore,
  } from "../lib/state/chatStore";
  import { startAppShellRuntime } from "../lib/services/appShellRuntime";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { routePathToLastActiveWindow } from "../lib/services/windowManager";
  import { registerSettingsDialogOpener, type SettingsDialogTab } from "../lib/services/settingsDialogUi";
  import type { AppDomainState } from "../lib/domain/contracts";
  import { CHAT_HTTP_CONTEXT_ID, type ContextId, tabDocumentId } from "../lib/domain/contracts";
  import { createProjectTreeController, type ProjectTreeControllerState } from "../lib/services/projectTreeController";
  import { probeWorkspaceReadAccess } from "../lib/services/fileSystem";
  import { stopChatAccessMonitor } from "../lib/services/chatAccessMonitor";
  import { DEFAULT_CONSOLE_HEIGHT_PX } from "../lib/services/consoleTabPrefs";
  import { normalizeWorkspaceLayout } from "../lib/services/panelLayout";
  import { deriveAppShellDocumentView } from "../lib/services/appShellDocumentView";
  import { createWorkspaceContextMenuActions } from "../lib/services/workspaceContextMenuController";
  import {
    flushSessionPersistence,
    registerTabsChangedSessionFlush,
  } from "../lib/services/sessionManager";
  import { isWorkspaceLifecycleActive } from "../lib/services/workspaceLifecycle";
  import {
    requestOpencodeHealthRefresh,
    syncActiveFileTreeExpandEffect,
    syncAgentTabEffect,
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
    getStatusSummary,
    refreshStatusSummary,
    clearStatusSummary,
  } from "../lib/ai/opencodeStatusSummary";
  import {
    createAgentNotificationObserver,
  } from "../lib/services/agentNotificationObserver";

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
  let themePaneOpen = $state(false);
  let settingsDialogOpen = $state(false);
  let settingsDialogInitialTab = $state<SettingsDialogTab>("editor");
  let consoleOpen = $state(false);
  let consoleHeightPx = $state(DEFAULT_CONSOLE_HEIGHT_PX);
  let statusMessage = $state("Ready");
  let editorRunner = $state<EditorCommandRunner | null>(null);
  let currentWindowId = $state("main");
  let findQuery = $state("");
  let replaceValue = $state("");
  let findCaseSensitive = $state(false);
  let goToLineValue = $state("");
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
  const agentNotificationObserver = createAgentNotificationObserver();
  const activeRuntimeByAgentId = $derived($chatActiveRuntimeByAgentId);
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
  let autoAgentsSidebarCollapsed = $state(false);
  let lastChatScopeKey = $state<string | null>(null);

  const snapshot = $derived($appState);
  const activeContext = $derived(getActiveContextSnapshot(snapshot));
  const session = $derived(activeContext.session);
  const documents = $derived(activeContext.documents);
  const activeContextId = $derived(snapshot.contexts.activeContextId);
  const isChatHttpActive = $derived(activeContextId === CHAT_HTTP_CONTEXT_ID);
  const workspaces = $derived(snapshot.contexts.workspaces);
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
  const workspaceAgents = $derived($chatAgentIndex);
  const selectedAgentId = $derived($chatActiveAgentId);
  /**
   * M2 — active agent's OpenCode session link for the chat header badges and
   * session-action gating. Resolved off the agent index (already reactive)
   * rather than calling `chatStore.getAgentSessionLink` imperatively.
   */
  const activeAgentEntry = $derived(
    workspaceAgents.find((agent) => agent.id === selectedAgentId) ?? null,
  );
  const activeShareUrl = $derived(activeAgentEntry?.opencodeShareUrl ?? null);
  const activeParentSessionId = $derived(
    activeAgentEntry?.opencodeParentSessionId ?? null,
  );
  /** M5-T1 — linked session id for the active agent (scopes session.todo). */
  const activeOpencodeSessionId = $derived(
    activeAgentEntry?.opencodeSessionId ?? null,
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
   * M5-T4 — status popover state. The button is gated to "workspace open +
   * OpenCode enabled"; opening it loads the aggregated status summary.
   */
  let statusPopoverOpen = $state(false);
  /**
   * M5-T5 — session timeline dialog state. Reads the active transcript
   * (already hydrated); jumping scrolls the message list to the target id.
   */
  let timelineOpen = $state(false);
  let timelineSearch = $state("");
  const activeMessages = $derived(chatStore.getMessages());
  const statusButtonVisible = $derived(
    Boolean(activeWorkspaceRoot) && snapshot.settings.opencode.enabled,
  );
  const openSessionIds = $derived(
    new Set(
      workspaceAgents
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
  const showAgentsSidebar = $derived(
    (isChatHttpActive || (Boolean(activeWorkspaceRoot) && opencodeEnabled)) &&
      !workspaceLayout.agentsSidebarCollapsed,
  );
  const showActivityRail = $derived(
    !(
      snapshot.settings.hideActivityRailWhenNotepadOnly &&
      snapshot.contexts.workspaces.length === 0
    ),
  );
  const chatHttpRailVisible = $derived(
    isChatHttpRailVisible(
      snapshot.settings.providerSettings,
      snapshot.settings.providerApiKeys,
      snapshot.settings.providerSettings.debugChat,
      snapshot.settings.chatHttp,
    ),
  );
  const activeTab = $derived(
    session.openTabs.find((tab) => tab.id === session.selectedTabId),
  );
  const isAgentTabActive = $derived(
    isAgentEditorPaneActive(session.openTabs, session.selectedTabId),
  );
  const activeDocument = $derived(
    documents.find((documentState) => documentState.id === tabDocumentId(activeTab)) ??
      documents[0],
  );
  const documentView = $derived(deriveAppShellDocumentView(activeDocument));
  let largeFileConfirming = $state(false);

  function notify(message: string): void {
    statusMessage = message;
  }

  const projectTreeHandlers = createAppShellProjectTreeHandlers({
    getActiveWorkspaceRoot: () => activeWorkspaceRoot,
    getIsAgentTabActive: () => isAgentTabActive,
    getCurrentWindowId: () => currentWindowId,
    notify,
    projectTreeController,
  });

  const {
    loadProjectTreeRoot,
    handleToggleProjectTreeDirectory,
    handleOpenProjectTreeFile,
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
    getIsAgentTabActive: () => isAgentTabActive,
    getWorkspaceLayout: () => workspaceLayout,
    getConsoleOpen: () => consoleOpen,
    setConsoleOpen: (open) => {
      consoleOpen = open;
    },
    getAutoProjectPanelCollapsed: () => autoProjectPanelCollapsed,
    setAutoProjectPanelCollapsed: (collapsed) => {
      autoProjectPanelCollapsed = collapsed;
    },
    getAutoAgentsSidebarCollapsed: () => autoAgentsSidebarCollapsed,
    setAutoAgentsSidebarCollapsed: (collapsed) => {
      autoAgentsSidebarCollapsed = collapsed;
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
    toggleAgentsSidebarCollapsed,
    handleProjectPanelWidthChange,
    handleAgentsSidebarWidthChange,
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

  $effect(() => {
    if (!snapshot.settings.logSettings.canOpenLogsPanel && consoleOpen) {
      consoleOpen = false;
    }
  });

  const {
    handleNewAgent,
    handleSelectAgent,
    handleDeleteAgent,
    ensureChatHttpAgentTab,
    handleDeleteAgentFromChat,
    restoreWorkspaceAgentSession,
    handleCloseTab,
    handleRenameAgent,
    handleForkAgent,
    handleRevertSession,
    handleUnrevertSession,
    handleShareAgent,
    handleUnshareAgent,
    handleSummarizeAgent,
    handleExportAgent,
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
    confirmSaveAll: (count) =>
      window.confirm(
        `This workspace has ${count} unsaved file(s). Press OK to Save All, or Cancel for more options.`,
      ),
    confirmDiscardAll: () =>
      window.confirm("Discard all unsaved changes and close this workspace?"),
  });

  const { runCommand, handleKeydown } = createAppShellCommandHandlers({
    getThemePaneOpen: () => themePaneOpen,
    setThemePaneOpen: (open) => {
      themePaneOpen = open;
    },
    getSettingsDialogOpen: () => settingsDialogOpen,
    setSettingsDialogOpen: (open) => {
      settingsDialogOpen = open;
    },
    notify,
    getSnapshot: () => snapshot,
    getCurrentWindowId: () => currentWindowId,
    getEditorRunner: () => editorRunner,
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
    getGoToLineValue: () => goToLineValue,
    getEditorRunner: () => editorRunner,
    getUntitledTitleDebounceTimer: () => untitledTitleDebounceTimer,
    setUntitledTitleDebounceTimer: (timer) => {
      untitledTitleDebounceTimer = timer;
    },
    notify,
  });

  function handleAddWorkspace(): void {
    runCommand("workspace.add");
    void loadProjectTreeRoot();
  }

  onMount(() => {
    registerTabsChangedSessionFlush((state) => {
      void flushSessionPersistence(state, getCurrentWebviewWindow().label);
    });

    return setupAppShellMount({
      registerSettingsDialogOpener,
      setSettingsDialogInitialTab: (tab) => {
        settingsDialogInitialTab = tab;
      },
      setSettingsDialogOpen: (open) => {
        settingsDialogOpen = open;
      },
      setupLayoutObserver,
      startAppShellRuntime,
      notify,
      runCommand,
      openAndActivatePath,
      consumeOpenedPaths,
      restoreWorkspaceAgentSession,
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
  });

  $effect(() => {
    activeTab;
    isChatHttpActive;
    chatHttpRailVisible;
    activeContextId;
    activeWorkspaceRoot;
    isAgentTabActive;
    selectedAgentId;
    lastChatScopeKey;
    syncAgentTabEffect({
      activeTab,
      isChatHttpActive,
      chatHttpRailVisible,
      activeContextId,
      activeWorkspaceRoot,
      isAgentTabActive,
      selectedAgentId,
      lastChatScopeKey,
      ensureChatHttpAgentTab,
      restoreWorkspaceAgentSession,
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
    selectedAgentId;
    session.lastActiveAgentId;
    session.selectedTabId;
    lastSelectedTabId;
    syncSessionPersistenceEffect({
      runtimeReady,
      snapshot,
      currentWindowId,
      activeWorkspaceRoot,
      selectedAgentId,
      sessionLastActiveAgentId: session.lastActiveAgentId,
      selectedTabId: session.selectedTabId,
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
    activeRuntimeByAgentId;
    snapshot.settings.soundSettings;
    snapshot.settings.osNotificationSettings;
    if (!runtimeReady) {
      return;
    }
    agentNotificationObserver.update({
      activeScopeKey: activeRuntimeByAgentId.scopeKey,
      runtimeByAgentId: activeRuntimeByAgentId.runtimeByAgentId,
      settings: {
        sound: snapshot.settings.soundSettings,
        osNotifications: snapshot.settings.osNotificationSettings,
      },
    });
  });

  $effect(() => {
    runtimeReady;
    isWorkspaceLifecycleActive();
    activeWorkspaceRoot;
    isChatHttpActive;
    isAgentTabActive;
    documentView.activeDocumentPath;
    syncOpencodeSidecarEffect({
      runtimeReady,
      workspaceLifecycleActive: isWorkspaceLifecycleActive(),
      activeWorkspaceRoot,
      isChatHttpActive,
      isAgentTabActive,
      opencodeEnabled,
      opencodeMode,
      opencodeBaseUrl,
      setOpencodeHealth: (patch) => appState.applyPersistedSettings({ opencodeHealth: patch }),
    });
    syncOpencodeToggleEffect({
      runtimeReady,
      opencodeEnabled,
      opencodeMode,
    });
    syncProjectTreeWatcherEffect({
      runtimeReady,
      activeWorkspaceRoot,
      isChatHttpActive,
      projectTreeController,
      loadProjectTreeRoot,
    });
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
    activeWorkspaceRoot;
    if (!runtimeReady) {
      return;
    }
    requestOpencodeHealthRefresh({
      opencodeEnabled,
      opencodeMode,
      opencodeBaseUrl,
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
    runtimeReady;
    snapshot;
    runtimeSyncExternalFileWatcher;
    isAgentTabActive;
    activeWorkspaceRoot;
    isChatHttpActive;
    activeContextId;
    shellMainRowWidth;
    editorPaneWidth;
    workspaceLayout;
    consoleOpen;
    syncExternalFileWatcherEffect({
      runtimeReady,
      snapshot,
      syncExternalFileWatcher: runtimeSyncExternalFileWatcher,
    });
    syncChatAccessMonitorEffect({
      runtimeReady,
      isAgentTabActive,
      activeWorkspaceRoot,
      isChatHttpActive,
    });
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
    session.lastActiveAgentId;
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
    session.lastActiveAgentId;
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
   * M13.5 — file-status refresh touches OpenCode (`file.status`); gate it on
   * `isAgentTabActive` so file/editor tabs don't trigger backend calls.
   */
  let lastFileStatusWorkspace = $state<string | null>(null);
  $effect(() => {
    runtimeReady;
    activeWorkspaceRoot;
    isAgentTabActive;
    session.lastActiveAgentId;
    const isGenerating = chatStore.getRuntimeState().isGenerating;
    void isGenerating;

    const root = activeWorkspaceRoot;
    if (lastFileStatusWorkspace && lastFileStatusWorkspace !== root) {
      clearFileStatusTracker(lastFileStatusWorkspace);
    }
    lastFileStatusWorkspace = root;

    if (!runtimeReady || !root || !isAgentTabActive) {
      return;
    }
    void refreshFileStatuses({ workspaceRootPath: root });
  });

  /**
   * M5-T4 — status summary. Refreshed when the popover opens and when the
   * workspace changes; cleared on switch.
   */
  let lastStatusWorkspace = $state<string | null>(null);
  $effect(() => {
    runtimeReady;
    activeWorkspaceRoot;
    statusPopoverOpen;

    const root = activeWorkspaceRoot;
    if (lastStatusWorkspace && lastStatusWorkspace !== root) {
      clearStatusSummary(lastStatusWorkspace);
    }
    lastStatusWorkspace = root;

    if (!runtimeReady || !root || !statusPopoverOpen) {
      return;
    }
    void refreshStatusSummary({ workspaceRootPath: root });
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
  bind:editorRunner
  bind:findQuery
  bind:replaceValue
  bind:findCaseSensitive
  bind:goToLineValue
  {consoleOpen}
  onConsoleHeightCommit={persistConsoleHeightNow}
  activityRail={{
    show: showActivityRail,
    workspaces,
    activeContextId,
    chatHttpRailVisible,
    onSelectContext: handleSelectContext,
    onAddWorkspace: handleAddWorkspace,
    onRequestCloseWorkspace: handleOpenWorkspaceContextMenu,
    onReorderWorkspaces: (fromIndex, toIndex) => appState.reorderWorkspaces(fromIndex, toIndex),
  }}
  agentsSidebar={{
    show: (Boolean(activeWorkspaceRoot) && opencodeEnabled) || isChatHttpActive,
    agents: workspaceAgents,
    activeAgentId: selectedAgentId,
    sidebarTitle: isChatHttpActive ? "Chats" : "Sessions",
    collapsed: !showAgentsSidebar,
    panelWidthPx: workspaceLayout.agentsSidebarWidthPx,
    onToggleCollapsed: toggleAgentsSidebarCollapsed,
    onPanelWidthChange: handleAgentsSidebarWidthChange,
    onSelectAgent: handleSelectAgent,
    onNewAgent: handleNewAgent,
    onDeleteAgent: handleDeleteAgent,
    onRenameAgent: handleRenameAgent,
    onShareAgent: (agentId) => {
      void handleShareAgent(agentId);
    },
    onExportAgent: handleExportAgent,
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
    notify,
  }}
  editor={{
    session,
    documents,
    activeDocument,
    isChatHttpActive,
    isAgentTabActive,
    isImageDocument: documentView.isImageDocument,
    isBinaryDocument: documentView.isBinaryDocument,
    isLargePendingDocument: documentView.isLargePendingDocument,
    isTextEditorDocument: documentView.isTextEditorDocument,
    isMarkdownDocument: documentView.isMarkdownDocument,
    previewFileSizeBytes: documentView.previewFileSizeBytes,
    markdownHtml: documentView.markdownHtml,
    previewMode: snapshot.editor.previewMode,
    findReplaceOpen: snapshot.editor.findReplaceOpen,
    goToOpen: snapshot.editor.goToOpen,
    wrapLines: snapshot.editor.wrapLines,
    zoomPercent: snapshot.editor.zoomPercent,
    cursorLine: snapshot.editor.cursorLine,
    cursorColumn: snapshot.editor.cursorColumn,
    decoratePlaintextSymbols: snapshot.settings.decoratePlaintextSymbols,
    maxBinaryOpenAsTextBytes: snapshot.settings.externalFiles.maxBinaryOpenAsTextBytes,
    maxOpenWithoutConfirmBytes: snapshot.settings.externalFiles.maxOpenWithoutConfirmBytes,
    largeFileConfirming,
    canFitMarkdownSplit: canFitMarkdownSplit(),
    currentWindowId,
    onCloseTab: handleCloseTab,
    onRunCommand: runCommand,
    onConfirmLargeFile: handleConfirmLargeFile,
    onMarkdownViewModeChange: setMarkdownViewMode,
    onUntitledTitleRefresh: scheduleUntitledTitleRefresh,
    onScrollTopChange: handleDocumentScrollTop,
    onDeleteAgentFromChat: handleDeleteAgentFromChat,
    onGoToLine: runGoToLine,
    onCloseGoTo: () => appState.setGoToOpen(false),
    notify,
    onForkAgent: (messageId?: string) => {
      const agentId = chatStore.getActiveAgentId();
      if (agentId) {
        void handleForkAgent(agentId, messageId);
      }
    },
    onRevertSession: (messageId?: string) => {
      const agentId = chatStore.getActiveAgentId();
      if (agentId) {
        void handleRevertSession(agentId, messageId);
      }
    },
    onUnrevertSession: () => {
      const agentId = chatStore.getActiveAgentId();
      if (agentId) {
        void handleUnrevertSession(agentId);
      }
    },
    onShareAgent: () => {
      const agentId = chatStore.getActiveAgentId();
      if (agentId) {
        void handleShareAgent(agentId);
      }
    },
    onUnshareAgent: () => {
      const agentId = chatStore.getActiveAgentId();
      if (agentId) {
        void handleUnshareAgent(agentId);
      }
    },
    onSummarizeAgent: () => {
      const agentId = chatStore.getActiveAgentId();
      if (agentId) {
        void handleSummarizeAgent(agentId);
      }
    },
    onExportAgent: () => {
      const agentId = chatStore.getActiveAgentId();
      if (agentId) {
        void handleExportAgent(agentId);
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
    onCloseWorkspace: closeWorkspaceFromContextMenu,
  }}
  overlays={{
    themePaneOpen,
    settingsDialogOpen,
    settingsDialogInitialTab,
    onSettingsDialogClose: () => (settingsDialogOpen = false),
    notify,
  }}
  sessionListPanel={{
    open: sessionListOpen,
    sessions: sessionListSessions,
    openSessionIds,
    activeSessionId: activeAgentEntry?.opencodeSessionId ?? null,
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
  statusPopover={{
    statusButtonVisible,
    statusButtonActive: statusPopoverOpen,
    workspaceRootPath: activeWorkspaceRoot,
    onToggleStatus: () => {
      statusPopoverOpen = !statusPopoverOpen;
    },
    onStatusClose: () => {
      statusPopoverOpen = false;
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
