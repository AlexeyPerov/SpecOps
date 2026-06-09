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
  import { chatActiveAgentId, chatAgentIndex } from "../lib/state/chatStore";
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
    syncActiveFileTreeExpandEffect,
    syncAgentTabEffect,
    syncChatAccessMonitorEffect,
    syncExternalFileWatcherEffect,
    syncOpencodeSidecarEffect,
    syncProjectTreeWatcherEffect,
    syncResponsiveLayoutEffect,
    syncSessionPersistenceEffect,
    syncSettingsPersistenceEffect,
    syncWorkspaceContextEffect,
  } from "../lib/services/appShellEffects";
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
  const showAgentsSidebar = $derived(
    (isChatHttpActive || Boolean(activeWorkspaceRoot)) &&
      !workspaceLayout.agentsSidebarCollapsed,
  );
  const workspaceAgents = $derived($chatAgentIndex);
  const selectedAgentId = $derived($chatActiveAgentId);
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

  const {
    handleNewAgent,
    handleSelectAgent,
    handleDeleteAgent,
    ensureChatHttpAgentTab,
    handleDeleteAgentFromChat,
    restoreWorkspaceAgentSession,
    handleCloseTab,
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

  onMount(() =>
    setupAppShellMount({
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
      cleanup: {
        disconnectLayoutObserver,
        clearUntitledTitleDebounceTimer,
      },
    }),
  );

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

  $effect(() => {
    runtimeReady;
    activeWorkspaceRoot;
    isChatHttpActive;
    documentView.activeDocumentPath;
    syncOpencodeSidecarEffect({
      runtimeReady,
      activeWorkspaceRoot,
      isChatHttpActive,
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
    show: Boolean(activeWorkspaceRoot) || isChatHttpActive,
    agents: workspaceAgents,
    activeAgentId: selectedAgentId,
    sidebarTitle: isChatHttpActive ? "Chats" : "Agents",
    collapsed: !showAgentsSidebar,
    panelWidthPx: workspaceLayout.agentsSidebarWidthPx,
    onToggleCollapsed: toggleAgentsSidebarCollapsed,
    onPanelWidthChange: handleAgentsSidebarWidthChange,
    onSelectAgent: handleSelectAgent,
    onNewAgent: handleNewAgent,
    onDeleteAgent: handleDeleteAgent,
  }}
  projectTree={{
    workspaceRoot: activeWorkspaceRoot,
    state: projectTreeControllerState,
    activeFilePath: documentView.activeDocumentPath,
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
  }}
  statusBar={{
    statusPath: documentView.statusPath,
    statusMessage,
    consoleOpen,
    onToggleConsole: toggleConsole,
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
/>
