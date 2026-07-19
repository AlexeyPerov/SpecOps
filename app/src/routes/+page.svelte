<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import AppShellHost from "../lib/components/AppShellHost.svelte";
  import type { AppShellHostBound } from "../lib/components/appShellHostTypes";
  import OverlayHost from "../lib/components/overlays/OverlayHost.svelte";
  import { isChatHttpRailVisible } from "../lib/ai/providers/chatHttpRailGating";
  import {
    activeViewKindInActivePane,
    isSessionTabActiveInActivePane,
  } from "../lib/components/editorRouting";
  import { createEditorWorkbenchRuntime } from "../lib/editor/editorWorkbenchRuntime";
  import { setEditorWorkbenchRuntime } from "../lib/editor/editorWorkbenchContext";
  import { createEditorDocumentSessionCache } from "../lib/editor/editorDocumentSessionCache";
  import { setEditorDocumentSessionCache } from "../lib/editor/editorDocumentSessionContext";
  import { createEditorToolController } from "../lib/editor/editorToolController";
  import { setEditorToolController } from "../lib/editor/editorToolContext";
  import { subscribeDocumentDiskReload } from "../lib/editor/editorSessionLifecycle";
  import { appState } from "../lib/state/appState";
  import {
    appActiveContext,
    appActiveContextId,
    appActiveDocuments,
    appActiveSession,
    appActivityRailWidthPx,
    appContexts,
    appEditor,
    appOpenDocumentIds,
    appRecentFiles,
    appSettings,
    appExternalWatcherSyncKey,
    deriveQuickOpenRecencyInputs,
  } from "../lib/state/appStateSelectors";
  import {
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
    isSessionTab,
    type ContextId,
    tabDocumentId,
  } from "../lib/domain/contracts";
  import { createProjectTreeController, type ProjectTreeControllerState } from "../lib/services/projectTreeController";
  import { createWorkspaceFileCatalog } from "../lib/services/workspaceFileCatalog";
  import {
    createWorkspaceFileCatalogRegistry,
    type WorkspaceFileCatalogRegistry,
  } from "../lib/services/workspaceFileCatalogRegistry";
  import { probeWorkspaceReadAccess } from "../lib/services/fileSystem";
  import { stopChatAccessMonitor } from "../lib/services/chatAccessMonitor";
  import { formatNotepadTabLabel } from "../lib/services/notepadTabLabel";
  import { listEnabledMarkdownSnippets } from "../lib/editor/markdownSnippetSettings";
  import { buildCommandAvailabilitySnapshot } from "../lib/commands/availability";
  import { buildPaletteSnapshot } from "../lib/commands/catalog";
  import { collectTabOpenPaths } from "../lib/services/tabContextMenuActions";
  import { DEFAULT_CONSOLE_HEIGHT_PX } from "../lib/services/consoleTabPrefs";
  import { normalizeWorkspaceLayout } from "../lib/services/panelLayout";
  import { deriveAppShellDocumentView } from "../lib/services/appShellDocumentView";
  import {
    getHiddenRootPaths,
    setHiddenFromRail,
    subscribeWorkspacePreferences,
  } from "../lib/services/workspacePreferences";
  import {
    flushSessionPersistence,
    registerTabsChangedSessionFlush,
    scheduleSessionPersistence,
  } from "../lib/services/sessionManager";
  import { isWorkspaceLifecycleActive } from "../lib/services/workspaceLifecycle";
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

  let consoleOpen = $state(false);
  let consoleHeightPx = $state(DEFAULT_CONSOLE_HEIGHT_PX);
  /**
   * Normalized workspace root paths hidden from the activity rail (decision 3).
   * Backed by the global `workspacePreferences` store; loaded on startup and
   * kept reactive so toggling "Show in sidebar" in workspace settings updates
   * the rail immediately.
   */
  let workspaceHiddenRootPaths = $state<Set<string>>(new Set());
  let statusMessage = $state("Ready");
  let currentWindowId = $state("main");
  let shellMainRowEl = $state<HTMLDivElement | null>(null);
  let editorShellEl = $state<HTMLElement | null>(null);
  let editorPaneEl = $state<HTMLElement | null>(null);
  let shellMainRowWidth = $state(0);
  let editorPaneWidth = $state(0);
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

  const activeContext = $derived($appActiveContext);
  const session = $derived($appActiveSession);
  const documents = $derived($appActiveDocuments);

  const editorWorkbench = createEditorWorkbenchRuntime({
    getActiveContextId: () => appState.getSnapshot().contexts.activeContextId,
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
    editorSessionCache.retainDocuments($appOpenDocumentIds);
  });

  /** Stable key for external file-watcher sync; ignores non-path snapshot churn. */
  const externalWatcherSyncKey = $derived($appExternalWatcherSyncKey);
  const activeContextId = $derived($appActiveContextId);
  const isChatHttpActive = $derived(activeContextId === CHAT_HTTP_CONTEXT_ID);
  const workspaces = $derived($appContexts.workspaces);
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
  const opencodeMode = $derived($appSettings.opencode.mode);

  /**
   * M5-T1 — TODO panel toggle. Agent-scoped: only rendered when a workspace
   * agent tab with a linked OpenCode session is active. Auto-refresh of
   * `session.todo` is driven by the `todowrite` tool-event effect below.
   *
   * (L14: stays on the page — the panel is rendered by AppShell and its
   * auto-refresh effect couples to retained snapshot state.)
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
   * L14 — the overlay host instance. Owned by this page (mounted inside
   * AppShellHost), captured via `bind:this` so the retained `$effect`s below
   * can drive cross-cutting overlay behavior (close-on-workspace-switch,
   * close-markdown-only-pickers, isAnyOverlayOpen) without the host needing
   * to read the full app snapshot.
   */
  let overlayHost: import("../lib/components/overlays/overlayHostTypes").OverlayHostBound | null = $state(null);
  let appShellHost: AppShellHostBound | null = $state(null);

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
    isModalOpen: () => overlayHost?.api.isAnyOverlayOpen() ?? false,
  });
  setEditorToolController(editorTools);

  /**
   * M1.2 — Quick Open input snapshots. The catalog snapshot and recency
   * inputs are computed here (they read app state) and passed down to the
   * overlay host, which owns the live query and the ranking derivation.
   */
  const quickOpenCatalogSnapshot = $derived(
    workspaceFileCatalogRegistry.getActiveSnapshot(),
  );
  const quickOpenRecencyInputs = $derived(
    deriveQuickOpenRecencyInputs(session, documents, $appRecentFiles, (sessionState, docs) =>
      collectTabOpenPaths(allTabs(sessionState.editorLayout), docs),
    ),
  );

  onDestroy(() => {
    editorWorkbench.dispose();
    editorSessionCache.clear();
    editorTools.dispose();
    workspaceFileCatalog.dispose();
    workspaceFileCatalogRegistry.dispose();
  });

  $effect(() => {
    // Close editor tools on pane/document/context changes or when any overlay
    // opens. L14: read the host's reactive `anyOverlayOpen` derived (not the
    // imperative `api.isAnyOverlayOpen()` call) so flipping an overlay boolean
    // re-runs this effect.
    activeContextId;
    session.editorLayout.activePaneId;
    getSessionActiveTab(session);
    void overlayHost?.anyOverlayOpen;
    if (editorTools.getSnapshot().activeTool === null) {
      return;
    }
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

  const opencodeBaseUrl = $derived($appSettings.opencode.baseUrl);
  const opencodeEnabled = $derived($appSettings.opencode.enabled);
  const opencodeSidecarPort = $derived($appSettings.opencode.sidecarPort);
  const showSessionsSidebar = $derived(
    (isChatHttpActive || (Boolean(activeWorkspaceRoot) && opencodeEnabled)) &&
      !workspaceLayout.sessionsSidebarCollapsed,
  );
  const chatHttpRailVisible = $derived(
    isChatHttpRailVisible(
      $appSettings.providerSettings,
      $appSettings.providerApiKeys,
      $appSettings.providerSettings.debugChat,
      $appSettings.chatHttp,
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
  const notepadSession = $derived($appContexts.notepad.session);
  const notepadOpenTabCount = $derived(allTabs(notepadSession.editorLayout).length);
  const notepadRecentTabs = $derived.by(() => {
    const notepadDocs = $appContexts.notepad.documents;
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
      bindingOverrides: $appSettings.commandBindingOverrides,
    }),
  );

  /**
   * M6.2 — enabled Markdown snippets, fed to OverlayHost (the snippet-insert
   * picker derives its ranking internally).
   */
  const markdownSnippets = $derived(
    listEnabledMarkdownSnippets($appSettings.markdownSnippets),
  );

  const shouldRenderMarkdownPreview = $derived.by(() => {
    if (!activeDocument || activeDocument.language !== "markdown") {
      return false;
    }
    if (activeDocument.markdownViewMode === "preview") {
      return true;
    }
    return activeDocument.markdownViewMode === "split" && (appShellHost?.api.canFitMarkdownSplit() ?? false);
  });
  const documentView = $derived(
    deriveAppShellDocumentView(activeDocument, {
      renderMarkdownHtml: shouldRenderMarkdownPreview,
    }),
  );
  let fileDropTargetPaneId = $state<string | null>(null);

  function notify(message: string): void {
    statusMessage = message;
  }

  function handleToggleTodoPanel(): void {
    todoPanelOpen = !todoPanelOpen;
  }

  function handleToggleDiffPanel(): void {
    diffPanelOpen = !diffPanelOpen;
  }

  function handleFileDropPaneChange(paneId: string | null): void {
    fileDropTargetPaneId = paneId;
  }

  $effect(() => {
    if (!$appSettings.logSettings.canOpenLogsPanel && consoleOpen) {
      consoleOpen = false;
    }
  });

  /** Switches to the notepad context and selects the given tab. */
  function handleSelectNotepadTab(tabId: string): void {
    appState.switchContext("notepad");
    appState.selectTab(tabId);
  }

  onMount(() => {
    // Tab changes schedule a debounced persist (coalescing rapid switching into
    // one write) rather than flushing synchronously on every change. The
    // immediate flush path is reserved for window-close / unload, where
    // durability matters more than batching.
    registerTabsChangedSessionFlush((state) => {
      scheduleSessionPersistence(state, getCurrentWebviewWindow().label);
    });

    // Reflect the global workspace hide-from-rail preferences (loaded during
    // runtime startup) and keep the rail filter reactive to later toggles.
    workspaceHiddenRootPaths = getHiddenRootPaths();
    const unsubscribeWorkspacePreferences = subscribeWorkspacePreferences((hidden) => {
      workspaceHiddenRootPaths = new Set(hidden);
    });

    const shellCleanup = setupAppShellMount({
      registerSettingsDialogOpener,
      setupLayoutObserver: () => appShellHost?.api.setupLayoutObserver(),
      startAppShellRuntime,
      notify,
      runCommand: (commandId) => appShellHost?.api.runCommand(commandId),
      openAndActivatePath: (path, options) =>
        appShellHost?.api.openAndActivatePath(path, options) ?? Promise.resolve(),
      consumeOpenedPaths: () => appShellHost?.api.consumeOpenedPaths() ?? [],
      restoreWorkspaceSession: (root, options) =>
        appShellHost?.api.restoreWorkspaceSession(root, options) ?? Promise.resolve(),
      loadProjectTreeRoot: () => appShellHost?.api.loadProjectTreeRoot() ?? Promise.resolve(),
      notifyProjectTreeFilesystemChange: (path, kind) =>
        appShellHost?.api.notifyProjectTreeFilesystemChange(path, kind),
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
      handleKeydown: (event) => appShellHost?.api.handleKeydown(event),
      stopChatAccessMonitor,
      flushSessionBeforeUnload: () =>
        flushSessionPersistence(appState.getSnapshot(), getCurrentWebviewWindow().label),
      cleanup: {
        disconnectLayoutObserver: () => appShellHost?.api.disconnectLayoutObserver(),
        clearUntitledTitleDebounceTimer: () =>
          appShellHost?.api.clearUntitledTitleDebounceTimer(),
      },
    });
    return () => {
      unsubscribeWorkspacePreferences();
      shellCleanup();
    };
  });

  const activeTabSessionId = $derived(
    activeTab && isSessionTab(activeTab) ? activeTab.sessionId : null,
  );

  $effect(() => {
    activeTabSessionId;
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
      ensureChatHttpSessionTab: () => appShellHost?.api.ensureChatHttpSessionTab(),
      restoreWorkspaceSession: (root, options) =>
        appShellHost?.api.restoreWorkspaceSession(root, options) ?? Promise.resolve(),
      setLastChatScopeKey: (key) => {
        lastChatScopeKey = key;
      },
    });
  });

  $effect(() => {
    runtimeReady;
    currentWindowId;
    activeWorkspaceRoot;
    selectedSessionId;
    session.lastActiveSessionId;
    sessionSelectedTabId;
    lastSelectedTabId;
    syncSessionPersistenceEffect({
      runtimeReady,
      currentWindowId,
      activeWorkspaceRoot,
      selectedSessionId,
      sessionLastActiveSessionId: session.lastActiveSessionId,
      selectedTabId: sessionSelectedTabId,
      lastSelectedTabId,
      onTabActivated: (tabId) => appShellHost?.api.onTabActivated(tabId) ?? Promise.resolve(),
      setLastSelectedTabId: (tabId) => {
        lastSelectedTabId = tabId;
      },
    });
  });

  $effect(() => {
    runtimeReady;
    currentWindowId;
    $appSettings;
    $appEditor.wrapLines;
    $appEditor.zoomPercent;
    syncSettingsPersistenceEffect({
      runtimeReady,
      currentWindowId,
      snapshot: appState.getSnapshot(),
    });
  });

  /**
   * M6-T4/T5 — fire sound + OS notifications when an agent in the active
   * workspace finishes, requests permission/question, or errors. Reacts to
   * chatStore runtime transitions (per agent) and the appearance settings.
   */
  $effect(() => {
    runtimeReady;
    activeRuntimeBySessionId;
    $appSettings.soundSettings;
    $appSettings.osNotificationSettings;
    if (!runtimeReady) {
      return;
    }
    sessionNotificationObserver.update({
      activeScopeKey: activeRuntimeBySessionId.scopeKey,
      runtimeBySessionId: activeRuntimeBySessionId.runtimeBySessionId,
      settings: {
        sound: $appSettings.soundSettings,
        osNotifications: $appSettings.osNotificationSettings,
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
      loadProjectTreeRoot: () => appShellHost?.api.loadProjectTreeRoot() ?? Promise.resolve(),
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
    // L14 — the picker-close + project-search-cancel half moved into the
    // overlay host (closeAllOnWorkspaceSwitch). The catalog-retargeting half
    // stays here because it depends on the shared catalog/registry singletons
    // the page owns.
    overlayHost?.api.closeAllOnWorkspaceSwitch();
  });

  // M6.2/M7.1/M7.2 — close Markdown-only pickers when the active document is no
  // longer Markdown-editable, and close host-scoped pickers when document
  // identity changes (stale host data). L14: delegates to the host's
  // closeMarkdownOnlyPickers (bookmark list NOT closed — pre-existing
  // asymmetry, pinned by overlayCoordinator.test.ts).
  $effect(() => {
    const docId = activeDocument?.id;
    const language = activeDocument?.language;
    void docId;
    overlayHost?.api.closeMarkdownOnlyPickers(language);
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
    // This effect handles *settings-driven* health refreshes (mode/url/port
    // toggle changes). It deliberately does NOT depend on `activeWorkspaceRoot`
    // — the per-workspace status probe is handled by syncOpencodeSidecarEffect
    // above. Without this guard the two effects would both fire on every
    // workspace switch and double-probe the sidecar. activeWorkspaceRoot is
    // still passed through as a value (ensureOpencodeSidecar needs it), read
    // untracked via appState.getSnapshot() so it does not become a dep.
    runtimeReady;
    opencodeEnabled;
    opencodeMode;
    opencodeBaseUrl;
    opencodeSidecarPort;
    if (!runtimeReady) {
      return;
    }
    requestOpencodeHealthRefresh({
      opencodeEnabled,
      opencodeMode,
      opencodeBaseUrl,
      opencodeSidecarPort,
      activeWorkspaceRoot: appState.getWorkspaceRoot(),
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
    const health = $appSettings.opencodeHealth;
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
      snapshot: untrack(() => appState.getSnapshot()),
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
      handleActiveContextSwitch: (contextId) =>
        appShellHost?.api.handleActiveContextSwitch(contextId),
    });
    syncResponsiveLayoutEffect({
      applyResponsiveLayoutRules: () => appShellHost?.api.applyResponsiveLayoutRules(),
    });
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


<AppShellHost
  bind:this={appShellHost}
  bind:shellMainRowEl
  bind:editorShellEl
  bind:editorPaneEl
  bind:workspaceContextMenuEl
  bind:consoleHeightPx
  bind:consoleOpen
  bind:shellMainRowWidth
  bind:editorPaneWidth
  bind:autoProjectPanelCollapsed
  bind:autoSessionsSidebarCollapsed
  activityRailWidthPx={$appActivityRailWidthPx}
  editorPreviewMode={$appEditor.previewMode}
  editorWrapLines={$appEditor.wrapLines}
  editorZoomPercent={$appEditor.zoomPercent}
  editorCursorLine={$appEditor.cursorLine}
  editorCursorColumn={$appEditor.cursorColumn}
  editorSelectionCount={$appEditor.selectionCount}
  decoratePlaintextSymbols={$appSettings.decoratePlaintextSymbols}
  showMinimap={$appSettings.showMinimap}
  showFoldGutter={$appSettings.showFoldGutter}
  autoClosePairs={$appSettings.autoClosePairs}
  autoSuggest={$appSettings.autoSuggest}
  maxBinaryOpenAsTextBytes={$appSettings.externalFiles.maxBinaryOpenAsTextBytes}
  maxOpenWithoutConfirmBytes={$appSettings.externalFiles.maxOpenWithoutConfirmBytes}
  {activeContextId}
  {session}
  {documents}
  {activeDocument}
  {activeMessages}
  {activeOpencodeSessionId}
  activeShareUrl={activeShareUrl ?? null}
  activeParentSessionId={activeParentSessionId ?? null}
  {activeWorkspaceRoot}
  {documentView}
  {workspaceLayout}
  {workspaces}
  {railWorkspaces}
  workspaceSessions={$chatSessionIndex}
  selectedSessionId={$chatActiveSessionId}
  activeSessionEntry={activeSessionEntry ?? null}
  {workspaceHiddenRootPaths}
  {projectTreeControllerState}
  {fileStatusByPath}
  {showProjectPanel}
  {showSessionsSidebar}
  {chatHttpRailVisible}
  {isSessionTabActive}
  {isChatHttpActive}
  {currentWindowId}
  {runtimeReady}
  {notepadOpenTabCount}
  {notepadRecentTabs}
  {fileDropTargetPaneId}
  {statusMessage}
  {openSessionIds}
  opencodeEnabled={$appSettings.opencode.enabled}
  canOpenLogsPanel={$appSettings.logSettings.canOpenLogsPanel}
  {todoPanelOpen}
  {diffPanelOpen}
  onToggleTodoPanel={handleToggleTodoPanel}
  onToggleDiffPanel={handleToggleDiffPanel}
  onFileDropPaneChange={handleFileDropPaneChange}
  {editorWorkbench}
  {editorTools}
  {projectTreeController}
  {workspaceFileCatalog}
  {workspaceFileCatalogRegistry}
  overlayHost={overlayHost}
  {notify}
  {handleSelectNotepadTab}
  {quickOpenCatalogSnapshot}
  {quickOpenRecencyInputs}
  {commandPaletteEntries}
  {markdownSnippets}
/>

<OverlayHost
  bind:this={overlayHost}
  activeWorkspaceRoot={activeWorkspaceRoot}
  activeDocumentMarkdownViewMode={activeDocument?.markdownViewMode}
  activeOpencodeSessionId={activeOpencodeSessionId}
  activeMessages={activeMessages}
  openSessionIds={openSessionIds}
  editorLayoutActivePaneId={session.editorLayout.activePaneId}
  currentWindowId={currentWindowId}
  workspaceRoots={workspaces.map((w) => w.rootPath)}
  quickOpenCatalogSnapshot={quickOpenCatalogSnapshot}
  quickOpenRecencyInputs={quickOpenRecencyInputs}
  commandPaletteEntries={commandPaletteEntries}
  markdownSnippets={markdownSnippets}
  notify={notify}
  runCommand={(commandId) => appShellHost?.api.runCommand(commandId)}
  setMarkdownViewMode={(mode) => appShellHost?.api.setMarkdownViewMode(mode)}
  openAndActivatePath={(path) => appShellHost?.api.openAndActivatePath(path) ?? Promise.resolve()}
  handleListWorkspaceSessions={(options) =>
    appShellHost?.api.handleListWorkspaceSessions(options) ?? Promise.resolve()}
  handleOpenExternalSession={(sessionId) =>
    appShellHost?.api.handleOpenExternalSession(sessionId) ?? Promise.resolve()}
  getWorkspaceFileCatalog={() => workspaceFileCatalog}
  getWorkspaceFileCatalogRegistry={() => workspaceFileCatalogRegistry}
  getEditorWorkbench={() => editorWorkbench}
  getEditorTools={() => editorTools}
/>
