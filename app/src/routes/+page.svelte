<script lang="ts">
  import { onMount, tick } from "svelte";
  import AppShell from "../lib/components/AppShell.svelte";
  import { isChatHttpRailVisible } from "../lib/ai/providers/chatHttpRailGating";
  import { isAgentEditorPaneActive } from "../lib/components/editorRouting";
  import { createAppShellAgentHandlers } from "../lib/services/appShellAgentHandlers";
  import { createAppShellLayoutHandlers } from "../lib/services/appShellLayoutHandlers";
  import { createAppShellProjectTreeHandlers } from "../lib/services/appShellProjectTreeHandlers";
  import { dispatchMenuCommand, initializeAppMenu, isEditorGlobalCommand, keymapCommandForEvent, refreshOpenRecentMenu, shouldInitializeAppMenu } from "../lib/commands/registry";
  import { getErrorMessage } from "../lib/commands/commandErrors";
  import type { AppCommandId } from "../lib/domain/contracts";
  import type { EditorCommandRunner } from "../lib/types/editor";
  import { appState } from "../lib/state/appState";
  import { getActiveContextSnapshot } from "../lib/state/appState/contextHelpers";
  import { chatActiveAgentId, chatAgentIndex, chatStore } from "../lib/state/chatStore";
  import { logDiagnostic } from "../lib/services/logging";
  import { describeOpenActivePathResult, openActivePath } from "../lib/services/openActivePath";
  import { confirmLargeFileOpen } from "../lib/services/openFileGate";
  import { startAppShellRuntime } from "../lib/services/appShellRuntime";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { routePathToLastActiveWindow } from "../lib/services/windowManager";
  import { scheduleSessionPersistence } from "../lib/services/sessionManager";
  import { savePersistedSettings, toPersistedSettings } from "../lib/services/settingsStore";
  import { registerSettingsDialogOpener, type SettingsDialogTab } from "../lib/services/settingsDialogUi";
  import { checkDocumentIfDeferred } from "../lib/services/externalFileChanges";
  import { marked } from "marked";
  import type { AppDomainState } from "../lib/domain/contracts";
  import { CHAT_HTTP_CONTEXT_ID, type ContextId } from "../lib/domain/contracts";
  import { isAgentTab, isFileTab, tabDocumentId } from "../lib/domain/contracts";
  import { createProjectTreeController, type ProjectTreeControllerState } from "../lib/services/projectTreeController";
  import { syncProjectTreeWatcher } from "../lib/services/fileWatcher";
  import { normalizePathSync } from "../lib/services/diskFingerprint";
  import { scheduleAgentThreadFilePersistence } from "../lib/services/chatPersistence";
  import { ensureWorkspaceReadAccess, probeWorkspaceReadAccess } from "../lib/services/fileSystem";
  import { stopChatAccessMonitor, syncChatAccessMonitor } from "../lib/services/chatAccessMonitor";
  import { DEFAULT_CONSOLE_HEIGHT_PX } from "../lib/services/consoleTabPrefs";
  import { normalizeWorkspaceLayout } from "../lib/services/panelLayout";
  import { DEFAULT_UNTITLED_TITLE } from "../lib/services/untitledTitle";
  import { formatStatusPath } from "../lib/services/appShellHelpers";
  import { createWorkspaceContextMenuActions } from "../lib/services/workspaceContextMenuController";
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
  const isImageDocument = $derived(activeDocument?.contentKind === "image");
  const isBinaryDocument = $derived(activeDocument?.contentKind === "binary");
  const isLargePendingDocument = $derived(activeDocument?.contentKind === "large_pending");
  const isTextEditorDocument = $derived(
    !isImageDocument &&
      !isBinaryDocument &&
      !isLargePendingDocument &&
      activeDocument !== undefined,
  );
  let largeFileConfirming = $state(false);
  const previewFileSizeBytes = $derived(activeDocument?.diskFingerprint?.sizeBytes ?? 0);
  const isMarkdownDocument = $derived(
    isTextEditorDocument && activeDocument?.language === "markdown",
  );
  const markdownHtml = $derived(
    isMarkdownDocument && activeDocument
      ? (marked.parse(activeDocument.content) as string)
      : "",
  );
  const statusPath = $derived(
    formatStatusPath(
      activeDocument?.filePath ?? null,
      activeDocument?.title,
      DEFAULT_UNTITLED_TITLE,
    ),
  );
  const activeDocumentPath = $derived(
    activeDocument?.filePath ? normalizePathSync(activeDocument.filePath) : null,
  );

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

  async function handleConfirmLargeFile(): Promise<void> {
    const document = activeDocument;
    if (!document?.filePath || document.contentKind !== "large_pending" || largeFileConfirming) {
      return;
    }
    largeFileConfirming = true;
    try {
      await confirmLargeFileOpen(document.id, document.filePath);
      notify(`Opened ${document.filePath}`);
    } catch (error: unknown) {
      notify(`Failed to open file: ${getErrorMessage(error)}`);
    } finally {
      largeFileConfirming = false;
    }
  }

  function handleDocumentScrollTop(documentId: string, scrollTop: number): void {
    appState.setDocumentScrollTop(documentId, scrollTop);
  }

  function handleAddWorkspace(): void {
    runCommand("workspace.add");
    void loadProjectTreeRoot();
  }

  function scheduleUntitledTitleRefresh(documentId: string): void {
    if (untitledTitleDebounceTimer) {
      clearTimeout(untitledTitleDebounceTimer);
    }
    untitledTitleDebounceTimer = setTimeout(() => {
      appState.refreshUntitledTitle(documentId);
      untitledTitleDebounceTimer = null;
    }, 300);
  }

  function runCommand(commandId: AppCommandId): void {
    dispatchMenuCommand(commandId, {
      isThemePaneOpen: () => themePaneOpen,
      setThemePaneOpen: (next) => {
        themePaneOpen = next;
      },
      isSettingsDialogOpen: () => settingsDialogOpen,
      setSettingsDialogOpen: (next) => {
        settingsDialogOpen = next;
      },
      notify,
      getState: () => snapshot,
      getWindowId: () => currentWindowId,
      confirm: (message) => window.confirm(message),
      getEditorRunner: () => editorRunner,
    });
  }

  async function openDroppedPaths(paths: string[]): Promise<void> {
    for (const droppedPath of paths) {
      try {
        await openAndActivatePath(droppedPath);
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        notify(`Failed to open dropped file: ${message}`);
      }
    }
  }

  async function consumeOpenedPaths(paths: string[]): Promise<void> {
    await openDroppedPaths(paths);
    notify(`Opened ${paths.length} file(s) from app icon.`);
  }

  async function openAndActivatePath(path: string): Promise<void> {
    const result = await openActivePath(path, currentWindowId);
    notify(describeOpenActivePathResult(result));
  }

  async function onTabActivated(tabId: string): Promise<void> {
    if (!runtimeReady) {
      return;
    }
    const tab = appState.getActiveSession().openTabs.find((entry) => entry.id === tabId);
    if (!tab || !isFileTab(tab)) {
      return;
    }
    await checkDocumentIfDeferred(tab.documentId, "tab");
  }

  function handleKeydown(event: KeyboardEvent): void {
    const command = keymapCommandForEvent(event);
    if (command === "app.toggleFindReplace") {
      event.preventDefault();
      runCommand(command);
      return;
    }
    if (
      command &&
      !isEditorGlobalCommand(command) &&
      (event.target as HTMLElement | null)?.closest(
        "input, textarea, [contenteditable=true]",
      )
    ) {
      return;
    }
    if (!command) {
      return;
    }

    event.preventDefault();
    runCommand(command);
  }

  function runGoToLine(): void {
    const line = Number(goToLineValue);
    if (!Number.isInteger(line) || line < 1) {
      notify("Go-to line must be a positive integer.");
      return;
    }
    const moved = editorRunner?.goToLine(line) ?? false;
    notify(moved ? `Moved to line ${line}.` : "Line is out of range.");
  }

  onMount(() => {
    let runtimeCleanup: (() => void) | undefined;
    let resizeObserverDisconnected = false;

    registerSettingsDialogOpener((tab) => {
      settingsDialogInitialTab = tab;
      settingsDialogOpen = true;
    });

    void tick().then(() => {
      if (!resizeObserverDisconnected) {
        setupLayoutObserver();
      }
    });

    void startAppShellRuntime({
      notify,
      runCommand,
      openAndActivatePath,
      consumeOpenedPaths,
      restoreWorkspaceAgentSession,
      loadProjectTreeRoot,
      onFilesystemChange: (path) => {
        notifyProjectTreeFilesystemChange(path);
      },
      setConsoleHeightPx: (heightPx) => {
        consoleHeightPx = heightPx;
      },
    })
      .then((runtimeHandle) => {
        runtimeCleanup = runtimeHandle.cleanup;
        runtimeSyncExternalFileWatcher = runtimeHandle.syncExternalFileWatcher;
        currentWindowId = runtimeHandle.windowId;
        lastSelectedTabId = appState.getActiveSession().selectedTabId;
        runtimeReady = true;
      })
      .catch(async (error: unknown) => {
        const message = getErrorMessage(error, String(error));
        await logDiagnostic({
          level: "error",
          source: "frontend",
          timestamp: new Date().toISOString(),
          message: "startAppShellRuntime failed",
          metadata: { error: message },
        });
      });

    const search = new URLSearchParams(window.location.search);
    const openParam = search.get("open");
    if (openParam) {
      void routePathToLastActiveWindow(openParam)
        .then(() => {
          notify("File open routed to last active window.");
        })
        .catch(async () => {
          const self = getCurrentWebviewWindow().label;
          if (self !== "main") {
            return;
          }
          await openAndActivatePath(openParam);
        })
        .catch((error: unknown) => {
          const message = getErrorMessage(error);
          notify(`Failed to open file from path: ${message}`);
        });
    }

    function onKeydown(event: KeyboardEvent): void {
      handleKeydown(event);
    }

    function preventBrowserDragOver(event: DragEvent): void {
      event.preventDefault();
    }

    window.addEventListener("keydown", onKeydown);
    window.addEventListener("dragover", preventBrowserDragOver);
    return () => {
      registerSettingsDialogOpener(null);
      resizeObserverDisconnected = true;
      disconnectLayoutObserver();
      if (untitledTitleDebounceTimer) {
        clearTimeout(untitledTitleDebounceTimer);
        untitledTitleDebounceTimer = null;
      }
      runtimeReady = false;
      runtimeSyncExternalFileWatcher = null;
      runtimeCleanup?.();
      stopChatAccessMonitor();
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("dragover", preventBrowserDragOver);
    };
  });

  $effect(() => {
    if (!activeTab || !isAgentTab(activeTab) || isChatHttpActive) {
      return;
    }
    if (chatStore.getActiveAgentId() !== activeTab.agentId) {
      chatStore.setActiveAgentId(activeTab.agentId);
      appState.setLastActiveAgentId(activeTab.agentId);
      void chatStore.runAccessPreflight();
    }
  });

  $effect(() => {
    if (!runtimeReady || !activeWorkspaceRoot) {
      return;
    }
    const chatActiveId = selectedAgentId;
    const sessionLastActive = session.lastActiveAgentId ?? null;
    if (chatActiveId !== sessionLastActive) {
      appState.setLastActiveAgentId(chatActiveId);
    }
  });

  $effect(() => {
    if (!runtimeReady || !currentWindowId) {
      return;
    }
    void runtimeSyncExternalFileWatcher?.(snapshot);
  });

  $effect(() => {
    if (!runtimeReady) {
      return;
    }
    const nextTabId = session.selectedTabId;
    if (nextTabId && nextTabId !== lastSelectedTabId) {
      lastSelectedTabId = nextTabId;
      void onTabActivated(nextTabId);
    }
  });

  $effect(() => {
    if (!runtimeReady) {
      return;
    }
    syncChatAccessMonitor(isAgentTabActive && Boolean(activeWorkspaceRoot) && !isChatHttpActive);
  });

  $effect(() => {
    if (!activeContextId) {
      return;
    }
    handleActiveContextSwitch(activeContextId);
  });

  $effect(() => {
    if (isChatHttpActive && !chatHttpRailVisible) {
      appState.switchContext("notepad");
      return;
    }
  });

  $effect(() => {
    if (!isChatHttpActive) {
      return;
    }
    selectedAgentId;
    ensureChatHttpAgentTab();
  });

  $effect(() => {
    if (activeContextId === CHAT_HTTP_CONTEXT_ID) {
      if (lastChatScopeKey !== CHAT_HTTP_CONTEXT_ID) {
        if (lastChatScopeKey !== null) {
          chatStore.cancelAllGenerations(lastChatScopeKey);
        }
        lastChatScopeKey = CHAT_HTTP_CONTEXT_ID;
        chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
        void chatStore.loadWorkspaceAgents(CHAT_HTTP_CONTEXT_ID).then(() => {
          ensureChatHttpAgentTab();
        });
      } else {
        ensureChatHttpAgentTab();
      }
      return;
    }

    if (!activeWorkspaceRoot) {
      if (lastChatScopeKey !== null) {
        chatStore.cancelAllGenerations(lastChatScopeKey);
        lastChatScopeKey = null;
      }
      chatStore.setActiveWorkspaceRoot(null);
      return;
    }
    const normalizedWorkspaceRoot = normalizePathSync(activeWorkspaceRoot);
    if (lastChatScopeKey !== normalizedWorkspaceRoot) {
      if (lastChatScopeKey !== null) {
        chatStore.cancelAllGenerations(lastChatScopeKey);
      }
      lastChatScopeKey = normalizedWorkspaceRoot;
      void ensureWorkspaceReadAccess(normalizedWorkspaceRoot);
      chatStore.setActiveWorkspaceRoot(normalizedWorkspaceRoot);
      void restoreWorkspaceAgentSession(normalizedWorkspaceRoot).catch(() => {
        if (isAgentTabActive) {
          void chatStore.runAccessPreflight();
        }
      });
    }
  });

  $effect(() => {
    shellMainRowWidth;
    editorPaneWidth;
    activeWorkspaceRoot;
    isChatHttpActive;
    isAgentTabActive;
    workspaceLayout;
    consoleOpen;
    applyResponsiveLayoutRules();
  });

  $effect(() => {
    if (!runtimeReady) {
      return;
    }
    scheduleSessionPersistence(snapshot, currentWindowId);
    if (currentWindowId) {
      void savePersistedSettings(
        toPersistedSettings({
          wrapLines: snapshot.editor.wrapLines,
          zoomPercent: snapshot.editor.zoomPercent,
          externalFiles: snapshot.settings.externalFiles,
          decoratePlaintextSymbols: snapshot.settings.decoratePlaintextSymbols,
          hideActivityRailWhenNotepadOnly: snapshot.settings.hideActivityRailWhenNotepadOnly,
          logSettings: snapshot.settings.logSettings,
          chatModes: snapshot.settings.chatModes,
          providerSettings: snapshot.settings.providerSettings,
          providerModelCatalogs: snapshot.settings.providerModelCatalogs,
          commandBindingOverrides: snapshot.settings.commandBindingOverrides,
        }),
      );
    }
  });

  $effect(() => {
    if (!activeWorkspaceRoot || isChatHttpActive) {
      void syncProjectTreeWatcher(null);
      projectTreeController.clearFilesystemChangeDebounce();
      return;
    }
    void loadProjectTreeRoot();
    if (runtimeReady) {
      void syncProjectTreeWatcher(activeWorkspaceRoot);
    }
  });

  $effect(() => {
    if (!runtimeReady || !activeWorkspaceRoot || isChatHttpActive) {
      if (runtimeReady && (!activeWorkspaceRoot || isChatHttpActive)) {
        void syncProjectTreeWatcher(null);
      }
      return;
    }
    void syncProjectTreeWatcher(activeWorkspaceRoot);
  });

  $effect(() => {
    if (!activeDocumentPath || isChatHttpActive) {
      return;
    }
    void projectTreeController.ensureExpandedForActiveFile(activeWorkspaceRoot, activeDocumentPath);
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
    activeFilePath: activeDocumentPath,
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
    isImageDocument,
    isBinaryDocument,
    isLargePendingDocument,
    isTextEditorDocument,
    isMarkdownDocument,
    previewFileSizeBytes,
    markdownHtml,
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
    statusPath,
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
