<script lang="ts">
  import { onMount, tick } from "svelte";
  import DocumentEditor from "../lib/components/DocumentEditor.svelte";
  import MarkdownEditorPane from "../lib/components/MarkdownEditorPane.svelte";
  import DiffPreviewPane from "../lib/components/DiffPreviewPane.svelte";
  import ImagePreviewPane from "../lib/components/ImagePreviewPane.svelte";
  import BinaryFilePane from "../lib/components/BinaryFilePane.svelte";
  import ConsolePanel from "../lib/components/ConsolePanel.svelte";
  import SettingsDialog from "../lib/components/SettingsDialog.svelte";
  import EntryNamePrompt from "../lib/components/EntryNamePrompt.svelte";
  import ThemePane from "../lib/components/ThemePane.svelte";
  import FindReplacePanel from "../lib/components/FindReplacePanel.svelte";
  import TabBar from "../lib/components/TabBar.svelte";
  import ActivityRail from "../lib/components/ActivityRail.svelte";
  import ProjectPanel from "../lib/components/ProjectPanel.svelte";
  import AgentsSidebar from "../lib/components/AgentsSidebar.svelte";
  import ChatPanel from "../lib/components/ChatPanel.svelte";
  import { isChatHttpRailVisible } from "../lib/ai/providers/chatHttpRailGating";
  import { isAgentEditorPaneActive } from "../lib/components/editorRouting";
  import { nextSidebarAgentId, openAgentTabIds, resolveRestoredActiveAgent, selectedTabAfterMissingLastAgent } from "../lib/services/workspaceAgentSession";
  import { closeTabWithUnsavedPrompt } from "../lib/services/closeTabFlow";
  import { dispatchMenuCommand, initializeAppMenu, isEditorGlobalCommand, keymapCommandForEvent, refreshOpenRecentMenu, shouldInitializeAppMenu } from "../lib/commands/registry";
  import { getErrorMessage } from "../lib/commands/commandErrors";
  import type { AppCommandId } from "../lib/domain/contracts";
  import type { EditorCommandRunner } from "../lib/types/editor";
  import { appState } from "../lib/state/appState";
  import { getActiveContextSnapshot } from "../lib/state/appState/contextHelpers";
  import { chatActiveAgentId, chatAgentIndex, chatStore } from "../lib/state/chatStore";
  import { logDiagnostic } from "../lib/services/logging";
  import { describeOpenActivePathResult, openActivePath } from "../lib/services/openActivePath";
  import { startAppShellRuntime } from "../lib/services/appShellRuntime";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { routePathToLastActiveWindow } from "../lib/services/windowManager";
  import { scheduleSessionPersistence } from "../lib/services/sessionManager";
  import { savePersistedSettings, toPersistedSettings } from "../lib/services/settingsStore";
  import { registerSettingsDialogOpener, type SettingsDialogTab } from "../lib/services/settingsDialogUi";
  import { promptEntryName } from "../lib/services/entryNamePrompt";
  import { confirm } from "@tauri-apps/plugin-dialog";
  import { checkDocumentIfDeferred } from "../lib/services/externalFileChanges";
  import { marked } from "marked";
  import type { AppDomainState } from "../lib/domain/contracts";
  import {
    CHAT_HTTP_CONTEXT_ID,
    type ContextId,
    type DocumentState,
  } from "../lib/domain/contracts";
  import { isAgentTab, isFileTab, tabDocumentId } from "../lib/domain/contracts";
  import { createProjectTreeController, type ProjectTreeControllerState } from "../lib/services/projectTreeController";
  import {
    createProjectFile,
    createProjectFolder,
    deleteProjectEntry,
    moveProjectEntry,
    parentDirForRefresh,
    renameProjectEntry,
  } from "../lib/services/projectFileOps";
  import { syncProjectTreeWatcher } from "../lib/services/fileWatcher";
  import type { ProjectTreeNode } from "../lib/services/projectTree";
  import { normalizePathSync } from "../lib/services/diskFingerprint";
  import { scheduleAgentThreadFilePersistence } from "../lib/services/chatPersistence";
  import { ensureWorkspaceReadAccess, probeWorkspaceReadAccess } from "../lib/services/fileSystem";
  import { stopChatAccessMonitor, syncChatAccessMonitor } from "../lib/services/chatAccessMonitor";
  import { DEFAULT_CONSOLE_HEIGHT_PX, writeConsoleHeightPreference } from "../lib/services/consoleTabPrefs";
  import { normalizeWorkspaceLayout } from "../lib/services/panelLayout";
  import { DEFAULT_UNTITLED_TITLE } from "../lib/services/untitledTitle";
  import { canFitMarkdownSplit as canFitMarkdownSplitForWidth, computeResponsiveLayoutFlags, formatStatusPath } from "../lib/services/appShellHelpers";
  import "../lib/styles/app-shell.css";

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
    activeWorkspaceRoot
      ? normalizeWorkspaceLayout(session.layout)
      : normalizeWorkspaceLayout(),
  );
  const showProjectPanel = $derived(
    !isChatHttpActive &&
      Boolean(activeWorkspaceRoot) &&
      !workspaceLayout.projectPanelCollapsed &&
      !autoProjectPanelCollapsed,
  );
  const showAgentsSidebar = $derived(
    isChatHttpActive
      ? !autoAgentsSidebarCollapsed
      : Boolean(activeWorkspaceRoot) &&
          !workspaceLayout.agentsSidebarCollapsed &&
          !autoAgentsSidebarCollapsed,
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
      snapshot.settings.providerSettings.http,
      snapshot.settings.providerApiKeys.http ?? "",
      snapshot.settings.providerModelCatalogs,
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
  const isTextEditorDocument = $derived(
    !isImageDocument && !isBinaryDocument && activeDocument !== undefined,
  );
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

  async function loadProjectTreeRoot(): Promise<void> {
    await projectTreeController.loadProjectTreeRoot({
      workspaceRoot: activeWorkspaceRoot,
      isAgentTabActive,
      onWorkspaceBlocked: () => {
        void chatStore.runAccessPreflight();
      },
    });
  }

  async function loadProjectTreeChildren(directoryPath: string): Promise<void> {
    await projectTreeController.loadProjectTreeChildren(activeWorkspaceRoot, directoryPath);
  }

  async function handleToggleProjectTreeDirectory(path: string): Promise<void> {
    await projectTreeController.handleToggleProjectTreeDirectory(activeWorkspaceRoot, path);
  }

  async function handleOpenProjectTreeFile(path: string): Promise<void> {
    const result = await openActivePath(path, currentWindowId);
    notify(describeOpenActivePathResult(result));
  }

  async function refreshProjectTree(): Promise<void> {
    await projectTreeController.refreshProjectTree(activeWorkspaceRoot, isAgentTabActive);
  }

  function notifyProjectTreeFilesystemChange(path: string): void {
    projectTreeController.handleFilesystemChange(activeWorkspaceRoot, path);
  }

  async function refreshProjectTreeDirectories(directoryPaths: string[]): Promise<void> {
    await projectTreeController.reloadDirectories(activeWorkspaceRoot, directoryPaths);
  }

  async function afterProjectTreeMutation(...paths: string[]): Promise<void> {
    const dirs = new Set<string>();
    if (activeWorkspaceRoot) {
      dirs.add(activeWorkspaceRoot);
    }
    for (const path of paths) {
      dirs.add(parentDirForRefresh(path));
    }
    await refreshProjectTreeDirectories([...dirs]);
    for (const path of paths) {
      notifyProjectTreeFilesystemChange(path);
    }
  }

  async function handleMoveProjectTreeEntry(
    sourcePath: string,
    destDirPath: string,
  ): Promise<void> {
    if (!activeWorkspaceRoot) {
      return;
    }
    const result = await moveProjectEntry(
      activeWorkspaceRoot,
      sourcePath,
      destDirPath,
      currentWindowId,
    );
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Moved to ${destDirPath}`);
    await afterProjectTreeMutation(sourcePath, result.path, destDirPath);
  }

  async function handleNewProjectFile(parentDirPath: string): Promise<void> {
    if (!activeWorkspaceRoot) {
      return;
    }
    const name = await promptEntryName({
      title: "New file name",
      defaultValue: "untitled.txt",
      confirmLabel: "Create",
    });
    if (name === null) {
      return;
    }
    const result = await createProjectFile(activeWorkspaceRoot, parentDirPath, name);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Created ${name}`);
    await afterProjectTreeMutation(result.path);
    await handleOpenProjectTreeFile(result.path);
  }

  async function handleNewProjectFolder(parentDirPath: string): Promise<void> {
    if (!activeWorkspaceRoot) {
      return;
    }
    const name = await promptEntryName({
      title: "New folder name",
      defaultValue: "New Folder",
      confirmLabel: "Create",
    });
    if (name === null) {
      return;
    }
    const result = await createProjectFolder(activeWorkspaceRoot, parentDirPath, name);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Created folder ${name}`);
    await afterProjectTreeMutation(result.path);
  }

  async function handleRenameProjectEntry(
    path: string,
    kind: ProjectTreeNode["kind"],
  ): Promise<void> {
    if (!activeWorkspaceRoot) {
      return;
    }
    const currentName = path.replaceAll("\\", "/").split("/").pop() ?? path;
    const name = await promptEntryName({
      title: "Rename",
      defaultValue: currentName,
      confirmLabel: "Rename",
    });
    if (name === null) {
      return;
    }
    const result = await renameProjectEntry(activeWorkspaceRoot, path, name, currentWindowId);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Renamed to ${name}`);
    await afterProjectTreeMutation(path, result.path);
    if (kind === "file") {
      await handleOpenProjectTreeFile(result.path);
    }
  }

  async function handleDeleteProjectEntry(
    path: string,
    kind: ProjectTreeNode["kind"],
  ): Promise<void> {
    if (!activeWorkspaceRoot) {
      return;
    }
    const label = kind === "directory" ? "folder" : "file";
    const entryLabel = path.replaceAll("\\", "/").split("/").pop() ?? path;
    const confirmed = await confirm(`Delete ${label} "${entryLabel}"?`, {
      title: "Delete",
      okLabel: "Delete",
      cancelLabel: "Cancel",
      kind: "warning",
    });
    if (!confirmed) {
      return;
    }
    const result = await deleteProjectEntry(activeWorkspaceRoot, path);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify("Deleted");
    await afterProjectTreeMutation(path);
  }

  function toggleProjectPanelCollapsed(next: boolean): void {
    appState.setProjectPanelCollapsed(next);
  }

  function toggleAgentsSidebarCollapsed(next: boolean): void {
    appState.setAgentsSidebarCollapsed(next);
  }

  function handleProjectPanelWidthChange(widthPx: number): void {
    appState.updateActiveWorkspaceLayout({ projectPanelWidthPx: widthPx });
  }

  function handleAgentsSidebarWidthChange(widthPx: number): void {
    appState.updateActiveWorkspaceLayout({ agentsSidebarWidthPx: widthPx });
  }

  function handleNewAgent(): void {
    const agentId = chatStore.createDraftAgent();
    if (!agentId) {
      return;
    }
    appState.setLastActiveAgentId(agentId);
    appState.openOrFocusAgentTab(agentId);
  }

  function handleSelectAgent(agentId: string): void {
    chatStore.setActiveAgentId(agentId);
    appState.setLastActiveAgentId(agentId);
    appState.openOrFocusAgentTab(agentId);
    void chatStore.runAccessPreflight();
  }

  async function handleDeleteAgent(agentId: string): Promise<void> {
    appState.closeTabsForAgent(agentId);
    const deleted = await chatStore.deleteAgent(agentId);
    if (!deleted) {
      return;
    }
    const nextAgentId = chatStore.getActiveAgentId();
    if (nextAgentId) {
      appState.openOrFocusAgentTab(nextAgentId);
    }
  }

  function ensureChatHttpAgentTab(): void {
    if (!isChatHttpActive) {
      return;
    }
    const activeScope = chatStore.getActiveChatScopeKey();
    if (activeScope !== CHAT_HTTP_CONTEXT_ID) {
      return;
    }
    const sessionSnapshot = appState.getActiveSession();
    const hasAgentTab = sessionSnapshot.openTabs.some((tab) => isAgentTab(tab));
    if (hasAgentTab) {
      return;
    }
    let agentId = chatStore.getActiveAgentId();
    if (!agentId) {
      agentId = chatStore.createDraftAgent();
    }
    if (!agentId) {
      return;
    }
    chatStore.setActiveAgentId(agentId);
    appState.setLastActiveAgentId(agentId);
    const fileTabIds = sessionSnapshot.openTabs
      .filter((tab) => isFileTab(tab))
      .map((tab) => tab.id);
    if (fileTabIds.length > 0) {
      appState.closeTabsByIds(fileTabIds, null);
    }
    appState.openOrFocusAgentTab(agentId);
  }

  async function handleDeleteAgentFromChat(): Promise<void> {
    const agentId = chatStore.getActiveAgentId();
    if (!agentId) {
      return;
    }
    await handleDeleteAgent(agentId);
  }

  async function restoreWorkspaceAgentSession(normalizedRoot: string): Promise<void> {
    const session = appState.getActiveSession();
    await chatStore.loadWorkspaceAgents(normalizedRoot);
    chatStore.mergeSessionDraftAgents(normalizedRoot, openAgentTabIds(session.openTabs));
    const agentIndex = chatStore.getAgentIndex();
    const restored = resolveRestoredActiveAgent(session, agentIndex);
    if (restored.shouldFocusAgentTab && restored.activeAgentId) {
      chatStore.setActiveAgentId(restored.activeAgentId);
      appState.setLastActiveAgentId(restored.activeAgentId);
      appState.openOrFocusAgentTab(restored.activeAgentId);
      void chatStore.runAccessPreflight();
      return;
    }
    chatStore.setActiveAgentId(null);
    appState.setLastActiveAgentId(null);
    const tabs = appState.getActiveSession().openTabs;
    const selectedTabId = appState.getActiveSession().selectedTabId;
    const nextSelected = selectedTabAfterMissingLastAgent(tabs, selectedTabId);
    if (nextSelected && nextSelected !== selectedTabId) {
      appState.selectTab(nextSelected);
    }
  }

  async function handleCloseTab(tabId: string): Promise<void> {
    const beforeSession = appState.getActiveSession();
    const closingTab = beforeSession.openTabs.find((tab) => tab.id === tabId);
    const closedAgentId =
      closingTab && isAgentTab(closingTab) ? closingTab.agentId : null;
    const wasSelected = beforeSession.selectedTabId === tabId;
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();

    const closed = await closeTabWithUnsavedPrompt(tabId, {
      getWindowId: () => currentWindowId,
      notify,
    });
    if (!closed) {
      return;
    }

    if (closedAgentId && workspaceRoot) {
      chatStore.cancelAgentGeneration(workspaceRoot, closedAgentId);
    }

    if (!closedAgentId || !wasSelected) {
      return;
    }

    const afterSession = appState.getActiveSession();
    const selectedAfter = afterSession.openTabs.find(
      (tab) => tab.id === afterSession.selectedTabId,
    );
    if (selectedAfter && isAgentTab(selectedAfter)) {
      return;
    }

    const nextSidebarId = nextSidebarAgentId(chatStore.getAgentIndex(), closedAgentId);
    if (nextSidebarId) {
      chatStore.setActiveAgentId(nextSidebarId);
      appState.setLastActiveAgentId(nextSidebarId);
      return;
    }
    chatStore.setActiveAgentId(null);
    appState.setLastActiveAgentId(null);
  }

  async function toggleProjectTreeHidden(next: boolean): Promise<void> {
    projectTreeController.setShowHidden(next);
    await refreshProjectTree();
  }

  function handleDocumentScrollTop(documentId: string, scrollTop: number): void {
    appState.setDocumentScrollTop(documentId, scrollTop);
  }

  function notify(message: string): void {
    statusMessage = message;
  }

  function toggleConsole(): void {
    consoleOpen = !consoleOpen;
  }

  function persistConsoleHeightNow(): void {
    void writeConsoleHeightPreference(consoleHeightPx);
  }

  function canFitMarkdownSplit(): boolean {
    return canFitMarkdownSplitForWidth(editorPaneWidth);
  }

  function setMarkdownViewMode(nextMode: "edit" | "split" | "preview"): void {
    if (!activeDocument) {
      return;
    }
    appState.setDocumentMarkdownViewMode(activeDocument.id, nextMode);
  }

  function updateLayoutMeasurements(): void {
    shellMainRowWidth = shellMainRowEl?.clientWidth ?? 0;
    editorPaneWidth = editorPaneEl?.clientWidth ?? 0;
  }

  function applyResponsiveLayoutRules(): void {
    const flags = computeResponsiveLayoutFlags({
      shellMainRowWidth,
      workspaceActive: Boolean(activeWorkspaceRoot) && !isChatHttpActive,
      isAgentTabActive,
      workspaceLayout,
      consoleOpen,
    });
    if (autoProjectPanelCollapsed !== flags.autoProjectPanelCollapsed) {
      autoProjectPanelCollapsed = flags.autoProjectPanelCollapsed;
    }
    if (autoAgentsSidebarCollapsed !== flags.autoAgentsSidebarCollapsed) {
      autoAgentsSidebarCollapsed = flags.autoAgentsSidebarCollapsed;
    }
    if (consoleOpen !== flags.consoleOpen) {
      consoleOpen = flags.consoleOpen;
    }
  }

  function handleActiveContextSwitch(nextContextId: ContextId): void {
    if (previousActiveContextId === null) {
      previousActiveContextId = nextContextId;
      return;
    }
    if (previousActiveContextId === nextContextId) {
      return;
    }
    previousActiveContextId = nextContextId;
    consoleOpen = false;
    closeWorkspaceContextMenu();
    if (nextContextId !== CHAT_HTTP_CONTEXT_ID) {
      void loadProjectTreeRoot();
    }
  }

  function handleSelectContext(contextId: ContextId): void {
    const switched = appState.switchContext(contextId);
    if (!switched) {
      return;
    }
    closeWorkspaceContextMenu();
  }

  function handleAddWorkspace(): void {
    runCommand("workspace.add");
    void loadProjectTreeRoot();
  }

  function handleOpenWorkspaceContextMenu(
    workspaceId: ContextId,
    x: number,
    y: number,
  ): void {
    workspaceContextMenu = { workspaceId, x, y };
    window.addEventListener("pointerdown", onWindowPointerDownWorkspaceMenu);
    window.addEventListener("keydown", onWindowKeydownWorkspaceMenu);
  }

  function closeWorkspaceContextMenu(): void {
    if (!workspaceContextMenu) {
      return;
    }
    workspaceContextMenu = null;
    window.removeEventListener("pointerdown", onWindowPointerDownWorkspaceMenu);
    window.removeEventListener("keydown", onWindowKeydownWorkspaceMenu);
  }

  function onWindowPointerDownWorkspaceMenu(event: PointerEvent): void {
    if (!workspaceContextMenu) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && workspaceContextMenuEl?.contains(target)) {
      return;
    }
    closeWorkspaceContextMenu();
  }

  function onWindowKeydownWorkspaceMenu(event: KeyboardEvent): void {
    if (workspaceContextMenu && event.key === "Escape") {
      closeWorkspaceContextMenu();
    }
  }

  function resolveCloseWorkspaceAction(dirtyDocuments: DocumentState[]): "save-all" | "discard-all" | "cancel" {
    const count = dirtyDocuments.length;
    const saveAll = window.confirm(
      `This workspace has ${count} unsaved file(s). Press OK to Save All, or Cancel for more options.`,
    );
    if (saveAll) {
      return "save-all";
    }
    const discard = window.confirm("Discard all unsaved changes and close this workspace?");
    return discard ? "discard-all" : "cancel";
  }

  function closeWorkspaceFromContextMenu(workspaceId: ContextId): void {
    const closed = appState.closeWorkspace(workspaceId, {
      resolveAction: resolveCloseWorkspaceAction,
      saveAllDirtyDocuments: (dirtyDocuments) => {
        for (const doc of dirtyDocuments) {
          if (!doc.filePath) {
            continue;
          }
          appState.markDocumentSaved(doc.id, doc.filePath, doc.content);
        }
      },
    });
    if (closed) {
      notify("Workspace closed.");
      consoleOpen = false;
      setMarkdownViewMode("edit");
      void loadProjectTreeRoot();
    }
    closeWorkspaceContextMenu();
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

    const setupLayoutObserver = (): void => {
      updateLayoutMeasurements();
      if (typeof ResizeObserver === "undefined") {
        return;
      }
      layoutResizeObserver = new ResizeObserver(() => {
        updateLayoutMeasurements();
      });
      if (shellMainRowEl) {
        layoutResizeObserver.observe(shellMainRowEl);
      }
      if (editorPaneEl) {
        layoutResizeObserver.observe(editorPaneEl);
      }
    };

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
      layoutResizeObserver?.disconnect();
      layoutResizeObserver = null;
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
    if (!activeTab || !isAgentTab(activeTab)) {
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
    if (activeContextId === CHAT_HTTP_CONTEXT_ID) {
      if (lastChatScopeKey !== CHAT_HTTP_CONTEXT_ID) {
        if (lastChatScopeKey !== null) {
          chatStore.cancelAllGenerations(lastChatScopeKey);
        }
        lastChatScopeKey = CHAT_HTTP_CONTEXT_ID;
        chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
        void chatStore.loadWorkspaceAgents(CHAT_HTTP_CONTEXT_ID);
      }
      ensureChatHttpAgentTab();
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

<main class="shell">
  <div class="shell-main-row" bind:this={shellMainRowEl}>
    {#if showActivityRail}
      <ActivityRail
        workspaces={workspaces}
        activeContextId={activeContextId}
        showChatHttp={chatHttpRailVisible}
        onSelectContext={handleSelectContext}
        onAddWorkspace={handleAddWorkspace}
        onRequestCloseWorkspace={handleOpenWorkspaceContextMenu}
      />
    {/if}
    {#if activeWorkspaceRoot || isChatHttpActive}
      <AgentsSidebar
        agents={workspaceAgents}
        activeAgentId={selectedAgentId}
        sidebarTitle={isChatHttpActive ? "Chats" : "Agents"}
        collapsed={!showAgentsSidebar}
        panelWidthPx={workspaceLayout.agentsSidebarWidthPx}
        onToggleCollapsed={toggleAgentsSidebarCollapsed}
        onPanelWidthChange={handleAgentsSidebarWidthChange}
        onSelectAgent={handleSelectAgent}
        onNewAgent={handleNewAgent}
        onDeleteAgent={(agentId) => void handleDeleteAgent(agentId)}
      />
    {/if}
    <section class="editor-shell" bind:this={editorShellEl} style="--console-height: {consoleHeightPx}px;">
      <header class="tab-header">
    <div class="header-left">
      <TabBar
        openTabs={session.openTabs}
        documents={documents}
        selectedTabId={session.selectedTabId}
        windowId={currentWindowId}
        notify={notify}
        onCloseTab={handleCloseTab}
      />
      {#if !isChatHttpActive}
        <button
          class="toolbar-button add-file-button"
          type="button"
          aria-label="Create new untitled file"
          title="New Untitled File"
          onclick={() => runCommand("file.new")}
        >
          +
        </button>
      {/if}
    </div>
    <div class="header-right">
      <button class="toolbar-button" type="button" onclick={() => runCommand("app.toggleThemePane")}>
        Theme
      </button>
    </div>
      </header>

      <section class="editor-pane" class:editor-pane-agent={isAgentTabActive} bind:this={editorPaneEl}>
    {#if isChatHttpActive || isAgentTabActive}
      <ChatPanel onDeleteAgent={handleDeleteAgentFromChat} />
    {:else if snapshot.editor.previewMode === "diff"}
      <DiffPreviewPane
        savedContent={activeDocument?.savedContent ?? ""}
        currentContent={activeDocument?.content ?? ""}
      />
    {:else if isImageDocument}
      <ImagePreviewPane
        filePath={activeDocument?.filePath ?? null}
        title={activeDocument?.title ?? "Image"}
        sizeBytes={previewFileSizeBytes}
      />
    {:else if isBinaryDocument}
      <BinaryFilePane
        filePath={activeDocument?.filePath ?? null}
        title={activeDocument?.title ?? "Binary file"}
        sizeBytes={previewFileSizeBytes}
        maxOpenAsTextBytes={snapshot.settings.externalFiles.maxBinaryOpenAsTextBytes}
      />
    {:else}
      {#if isMarkdownDocument}
        <MarkdownEditorPane
          content={activeDocument?.content ?? ""}
          documentId={activeDocument?.id ?? null}
          documentFilePath={activeDocument?.filePath ?? null}
          scrollTop={activeDocument?.scrollTop ?? 0}
          language={activeDocument?.language ?? "markdown"}
          wrapLines={snapshot.editor.wrapLines}
          zoomPercent={snapshot.editor.zoomPercent}
          decoratePlaintextSymbols={snapshot.settings.decoratePlaintextSymbols}
          {markdownHtml}
          storedMarkdownViewMode={activeDocument?.markdownViewMode ?? "edit"}
          canFitSplit={canFitMarkdownSplit()}
          windowId={currentWindowId}
          onStatusMessage={notify}
          onMarkdownViewModeChange={setMarkdownViewMode}
          onUntitledTitleRefresh={scheduleUntitledTitleRefresh}
          onScrollTopChange={handleDocumentScrollTop}
          registerEditorCommandRunner={(runner) => {
            editorRunner = runner;
          }}
        />
      {:else}
        <DocumentEditor
          content={activeDocument?.content ?? ""}
          documentId={activeDocument?.id ?? null}
          scrollTop={activeDocument?.scrollTop ?? 0}
          wrapLines={snapshot.editor.wrapLines}
          zoomPercent={snapshot.editor.zoomPercent}
          language={activeDocument?.language ?? "plaintext"}
          decoratePlaintextSymbols={snapshot.settings.decoratePlaintextSymbols}
          onStatusMessage={notify}
          onUntitledTitleRefresh={scheduleUntitledTitleRefresh}
          onScrollTopChange={handleDocumentScrollTop}
          registerEditorCommandRunner={(runner) => {
            editorRunner = runner;
          }}
        />
      {/if}
    {/if}

    {#if isTextEditorDocument && !isAgentTabActive && !isChatHttpActive && snapshot.editor.findReplaceOpen}
      <FindReplacePanel
        bind:findQuery
        bind:replaceValue
        bind:findCaseSensitive
        {editorRunner}
        {notify}
        documentId={activeDocument?.id ?? null}
      />
    {/if}

    {#if isTextEditorDocument && !isAgentTabActive && !isChatHttpActive && snapshot.editor.goToOpen}
      <div class="floating-tool goto-tool">
        <h3>Go To Line</h3>
        <input placeholder="Line number..." bind:value={goToLineValue} />
        <div class="tool-actions">
          <button type="button" class="toolbar-button" onclick={runGoToLine}>Go</button>
          <button type="button" class="toolbar-button" onclick={() => appState.setGoToOpen(false)}>
            Close
          </button>
        </div>
      </div>
    {/if}
        <ThemePane open={themePaneOpen} />
      </section>

      <div class="bottom-panel">
        {#if consoleOpen}
          <ConsolePanel
            bind:heightPx={consoleHeightPx}
            onHeightCommit={persistConsoleHeightNow}
          />
        {/if}

        <footer class="status-bar" class:status-bar-console-open={consoleOpen}>
          <button
            type="button"
            class="status-bar-button"
            title={consoleOpen ? "Hide console" : "Show console"}
            onclick={toggleConsole}
          >
            <span class="status-segment optional-segment optional-cursor">
              Ln {snapshot.editor.cursorLine}, Col {snapshot.editor.cursorColumn}
            </span>
            <span class="status-segment optional-segment optional-encoding">
              {#if isImageDocument}
                Image
              {:else if isBinaryDocument}
                Binary
              {:else}
                {activeDocument?.encoding.toUpperCase() ?? "UTF-8"}
              {/if}
            </span>
            <span class="status-segment optional-segment optional-line-ending">
              {activeDocument?.lineEnding.toUpperCase() ?? "LF"}
            </span>
            <span class="status-segment optional-segment optional-zoom">
              {snapshot.editor.zoomPercent}%
            </span>
            <span class="status-segment optional-segment optional-wrap">
              {snapshot.editor.wrapLines ? "Wrap: On" : "Wrap: Off"}
            </span>
            <span class="status-segment">{activeDocument?.isDirty ? "Modified" : "Saved"}</span>
            {#if activeDocument?.fileMissing}
              <span class="status-segment status-missing" title="File no longer exists on disk">
                File missing
              </span>
            {/if}
            <span class="status-segment status-message optional-segment optional-message">{statusMessage}</span>
            <span class="status-segment path-segment" title={activeDocument?.filePath ?? statusPath}>
              {statusPath}
            </span>
          </button>
        </footer>
      </div>
    </section>
    {#if activeWorkspaceRoot}
      <ProjectPanel
        workspaceRoot={activeWorkspaceRoot}
        rootNodes={projectTreeControllerState.rootNodes}
        expandedPaths={projectTreeControllerState.expandedPaths}
        childrenByPath={projectTreeControllerState.childrenByPath}
        loadingPaths={projectTreeControllerState.loadingPaths}
        activeFilePath={activeDocumentPath}
        showHidden={projectTreeControllerState.showHidden}
        collapsed={!showProjectPanel}
        panelWidthPx={workspaceLayout.projectPanelWidthPx}
        onRefresh={refreshProjectTree}
        onToggleHidden={toggleProjectTreeHidden}
        onToggleCollapsed={toggleProjectPanelCollapsed}
        onPanelWidthChange={handleProjectPanelWidthChange}
        onToggleDirectory={handleToggleProjectTreeDirectory}
        onOpenFile={handleOpenProjectTreeFile}
        onMoveEntry={handleMoveProjectTreeEntry}
        onNewFile={(parent) => void handleNewProjectFile(parent)}
        onNewFolder={(parent) => void handleNewProjectFolder(parent)}
        onRenameEntry={(path, kind) => void handleRenameProjectEntry(path, kind)}
        onDeleteEntry={(path, kind) => void handleDeleteProjectEntry(path, kind)}
        {notify}
      />
    {/if}
  </div>

</main>

<SettingsDialog
  open={settingsDialogOpen}
  initialTab={settingsDialogInitialTab}
  onClose={() => (settingsDialogOpen = false)}
/>

<EntryNamePrompt onNotify={notify} />

{#if workspaceContextMenu}
  <div
    bind:this={workspaceContextMenuEl}
    class="workspace-context-menu"
    style={`left:${workspaceContextMenu.x}px; top:${workspaceContextMenu.y}px;`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    <button
      class="workspace-context-item"
      type="button"
      role="menuitem"
      onpointerdown={(event) => {
        event.stopPropagation();
        if (!workspaceContextMenu) {
          return;
        }
        closeWorkspaceFromContextMenu(workspaceContextMenu.workspaceId);
      }}
    >
      Close Workspace
    </button>
  </div>
{/if}
