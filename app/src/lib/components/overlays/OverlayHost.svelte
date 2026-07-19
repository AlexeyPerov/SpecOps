<script lang="ts">
  /**
   * OverlayHost — owns the state and coordination for the 10 overlays that
   * used to live inline in `+page.svelte`:
   *
   *   5 pickers ......... QuickOpen, CommandPalette, HeadingJump,
   *                       BookmarkList, SnippetInsert
   *   3 dialogs ......... SessionList, AddMultipleWorkspaces, SessionTimeline
   *   2 inline panels ... ProjectSearch (bottom panel), WorkspaceContextMenu
   *                       (positioned menu)
   *
   * The pickers and the three dialogs are rendered here (they were previously
   * rendered inside `AppShell.svelte`). ProjectSearch and WorkspaceContextMenu
   * stay rendered inside `AppShell` (they need AppShell's bottom-panel
   * container and the `bind:this` element ref respectively) — this host just
   * owns their state and exposes it upward via `$bindable`-friendly getters
   * so `AppShellHost` can thread the props.
   *
   * The parent captures the imperative {@link OverlayHostApi} via `bind:this`
   * and uses it from the three cross-cutting `$effect`s that stayed on the
   * page (they fuse retained snapshot state with picker state — see the L14
   * changelog).
   */
  import SessionListPanel from "../SessionListPanel.svelte";
  import AddMultipleWorkspacesModal from "../AddMultipleWorkspacesModal.svelte";
  import SessionTimelineDialog from "../SessionTimelineDialog.svelte";
  import { loadLazyPicker } from "../lazyPicker";
  import { DEFAULT_CONSOLE_HEIGHT_PX } from "../../services/consoleTabPrefs";
  import { rankCommands } from "../../picker/commandRanking";
  import { rankFiles } from "../../picker/fileRanking";
  import { rankHeadings } from "../../picker/headingRanking";
  import { rankSnippets } from "../../picker/snippetRanking";
  import type { AppCommandId, ContextId } from "../../domain/contracts";
  import type { ProjectSearchResult } from "../../services/projectSearch";
  import type {
    MarkdownHeadingSnapshot,
    EditorBookmarkSnapshot,
    EditorHostIdentity,
  } from "../../types/editor";
  import type {
    SessionListSort,
  } from "../../ai/backends/opencodeSessionList";
  import type { WorkspaceAgentSessionDetails } from "../../ai/backends/workspaceAgentBackend";
  import {
    createOverlayHostHandlers,
    computeProjectSearchQueryError,
    type ProjectSearchQueryState,
  } from "./overlayHostHandlers";
  import { createOverlayCoordinator } from "./overlayCoordinator";
  import type {
    OverlayHostApi,
    OverlayKind,
    ProjectSearchPanelState,
    WorkspaceContextMenuState,
  } from "./overlayHostTypes";

  interface Props {
    activeWorkspaceRoot: string | null;
    activeDocumentMarkdownViewMode: "edit" | "split" | "preview" | undefined;
    activeOpencodeSessionId: string | null;
    activeMessages: readonly import("../../domain/contracts").ChatMessage[];
    /** OpenCode session ids already opened as agent tabs (sidebar index). */
    openSessionIds: ReadonlySet<string>;
    editorLayoutActivePaneId: string;
    currentWindowId: string;
    workspaceRoots: string[];
    quickOpenCatalogSnapshot: import("../../services/workspaceFileCatalog").WorkspaceFileCatalogSnapshot;
    quickOpenRecencyInputs: {
      openPaths: string[];
      recentPaths: readonly string[];
    };
    commandPaletteEntries: import("../../commands/catalog").PaletteCommandEntry[];
    markdownSnippets: import("../../domain/snippets").ResolvedMarkdownSnippet[];
    notify: (message: string) => void;
    runCommand: (commandId: AppCommandId) => void;
    setMarkdownViewMode: (mode: "edit" | "split" | "preview") => void;
    openAndActivatePath: (path: string) => Promise<void>;
    handleListWorkspaceSessions: (options: {
      search?: string;
    }) => Promise<WorkspaceAgentSessionDetails[]>;
    handleOpenExternalSession: (sessionId: string, title?: string) => Promise<void>;
    getWorkspaceFileCatalog: () => import("../../services/workspaceFileCatalog").WorkspaceFileCatalog;
    getWorkspaceFileCatalogRegistry: () => import("../../services/workspaceFileCatalogRegistry").WorkspaceFileCatalogRegistry;
    getEditorWorkbench: () => import("../../editor/editorWorkbenchRuntime").EditorWorkbenchRuntime;
    getEditorTools: () => import("../../editor/editorToolController").EditorToolController;
  }

  let {
    activeWorkspaceRoot,
    activeDocumentMarkdownViewMode,
    activeOpencodeSessionId,
    activeMessages,
    openSessionIds,
    editorLayoutActivePaneId,
    currentWindowId,
    workspaceRoots,
    quickOpenCatalogSnapshot,
    quickOpenRecencyInputs,
    commandPaletteEntries,
    markdownSnippets,
    notify,
    runCommand,
    setMarkdownViewMode,
    openAndActivatePath,
    handleListWorkspaceSessions,
    handleOpenExternalSession,
    getWorkspaceFileCatalog,
    getWorkspaceFileCatalogRegistry,
    getEditorWorkbench,
    getEditorTools,
  }: Props = $props();

  // -------------------------------------------------------------------------
  // Picker open + query state (was +page.svelte:387-411)
  // -------------------------------------------------------------------------
  let quickOpenOpen = $state(false);
  let quickOpenQuery = $state("");
  let quickOpenOpenerPaneId = $state<string | null>(null);

  let commandPaletteOpen = $state(false);
  let commandPaletteQuery = $state("");

  let headingJumpOpen = $state(false);
  let headingJumpQuery = $state("");

  let bookmarkListOpen = $state(false);
  let bookmarkListQuery = $state("");

  let snippetInsertOpen = $state(false);
  let snippetInsertQuery = $state("");
  let snippetInsertHostIdentity = $state<EditorHostIdentity | null>(null);

  // -------------------------------------------------------------------------
  // Project search state (was +page.svelte:167-192)
  // -------------------------------------------------------------------------
  let projectSearchOpen = $state(false);
  let projectSearchHeightPx = $state(DEFAULT_CONSOLE_HEIGHT_PX);
  let projectSearchFocusReplace = $state(false);
  let projectSearchQuery = $state("");
  let projectSearchReplace = $state("");
  let projectSearchCaseSensitive = $state(false);
  let projectSearchWholeWord = $state(false);
  let projectSearchRegex = $state(false);
  const projectSearchQueryError = $derived(
    computeProjectSearchQueryError(projectSearchQuery, projectSearchRegex),
  );
  let projectSearchResults = $state<ProjectSearchResult[]>([]);
  let projectSearchRunning = $state(false);
  let projectSearchStatus = $state("");
  let projectSearchNonce = $state(0);
  /** Monotonic generation to cancel in-flight searches. */
  let projectSearchGeneration = $state(0);

  // -------------------------------------------------------------------------
  // Session list panel state (was +page.svelte:344-353)
  // -------------------------------------------------------------------------
  let sessionListOpen = $state(false);
  let sessionListSessions = $state<WorkspaceAgentSessionDetails[]>([]);
  let sessionListLoading = $state(false);
  let sessionListError = $state<string | null>(null);
  let sessionListSort = $state<SessionListSort>("updated");
  let sessionListSearch = $state("");

  // -------------------------------------------------------------------------
  // Add-multiple workspaces modal state (was +page.svelte:201-206)
  // -------------------------------------------------------------------------
  let addMultipleOpen = $state(false);
  let addMultipleLoading = $state(false);
  let addMultipleError = $state<string | null>(null);
  let addMultipleParentPath = $state<string | null>(null);
  let addMultipleEntries = $state<
    ReadonlyArray<{ path: string; name: string; exists: boolean }>
  >([]);
  let addMultipleSelected = $state<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Session timeline dialog state (was +page.svelte:379-380)
  // -------------------------------------------------------------------------
  let timelineOpen = $state(false);
  let timelineSearch = $state("");

  // -------------------------------------------------------------------------
  // Workspace context menu state (was +page.svelte:229-233)
  // -------------------------------------------------------------------------
  let workspaceContextMenu = $state<{
    workspaceId: ContextId;
    x: number;
    y: number;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Picker derived rankings (was +page.svelte:451-462, 608-673)
  // -------------------------------------------------------------------------
  const quickOpenResults = $derived(
    rankFiles(quickOpenCatalogSnapshot, quickOpenQuery, quickOpenRecencyInputs),
  );
  const commandPaletteResults = $derived(
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
    const host = getEditorWorkbench().getActiveHost();
    if (!host) {
      return [];
    }
    const result = host.queries.markdown.getHeadings();
    return result.ok ? result.value : [];
  });

  const headingJumpCursorPos = $derived.by((): number => {
    void landmarkPickerTick;
    const host = getEditorWorkbench().getActiveHost();
    if (!host) {
      return 0;
    }
    const selection = host.queries.selection.getSelection();
    return selection.ok ? selection.value.head : 0;
  });

  const headingJumpResults = $derived(
    rankHeadings(headingJumpHeadings, headingJumpQuery, headingJumpCursorPos),
  );

  const bookmarkListSnapshots = $derived.by((): EditorBookmarkSnapshot[] => {
    void landmarkPickerTick;
    if (!bookmarkListOpen) {
      return [];
    }
    const host = getEditorWorkbench().getActiveHost();
    if (!host) {
      return [];
    }
    const result = host.queries.bookmarks.list();
    return result.ok ? result.value : [];
  });

  const snippetInsertResults = $derived(
    rankSnippets(markdownSnippets, snippetInsertQuery),
  );

  const openSessionIdsForPanel = $derived(openSessionIds);

  // -------------------------------------------------------------------------
  // Handler factory (delegates state setters back into local $state)
  // -------------------------------------------------------------------------
  const handlers = createOverlayHostHandlers({
    notify: (message) => notify(message),
    getActiveWorkspaceRoot: () => activeWorkspaceRoot,
    getCurrentWindowId: () => currentWindowId,
    getEditorLayoutActivePaneId: () => editorLayoutActivePaneId,
    getEditorWorkbench: () => getEditorWorkbench(),
    getEditorTools: () => getEditorTools(),
    getWorkspaceFileCatalog: () => getWorkspaceFileCatalog(),
    getWorkspaceFileCatalogRegistry: () => getWorkspaceFileCatalogRegistry(),
    getActiveDocumentMarkdownViewMode: () => activeDocumentMarkdownViewMode,
    setMarkdownViewMode: (mode) => setMarkdownViewMode(mode),
    openAndActivatePath: (path) => openAndActivatePath(path),
    setProjectSearchResults: (results) => {
      projectSearchResults = results;
    },
    setProjectSearchStatus: (status) => {
      projectSearchStatus = status;
    },
    setProjectSearchRunning: (running) => {
      projectSearchRunning = running;
    },
    bumpProjectSearchGeneration: () => {
      projectSearchGeneration += 1;
      return projectSearchGeneration;
    },
    getProjectSearchGeneration: () => projectSearchGeneration,
    setSessionListLoading: (loading) => {
      sessionListLoading = loading;
    },
    setSessionListSessions: (sessions) => {
      sessionListSessions = sessions;
    },
    getSessionListSearch: () => sessionListSearch,
    handleListWorkspaceSessions: (options) => handleListWorkspaceSessions(options),
    handleOpenExternalSession: (sessionId, title) =>
      handleOpenExternalSession(sessionId, title),
    setSessionListOpen: (open) => {
      sessionListOpen = open;
    },
    setAddMultipleOpen: (open) => {
      addMultipleOpen = open;
    },
    setAddMultipleLoading: (loading) => {
      addMultipleLoading = loading;
    },
    setAddMultipleError: (error) => {
      addMultipleError = error;
    },
    setAddMultipleParentPath: (path) => {
      addMultipleParentPath = path;
    },
    setAddMultipleEntries: (entries) => {
      addMultipleEntries = entries;
    },
    setAddMultipleSelected: (selected) => {
      addMultipleSelected = selected;
    },
    getWorkspaceRoots: () => workspaceRoots,
    getQuickOpenOpenerPaneId: () => quickOpenOpenerPaneId,
    setQuickOpenOpen: (open) => {
      quickOpenOpen = open;
    },
    getSnippetInsertHostIdentity: () => snippetInsertHostIdentity,
    setSnippetInsertOpen: (open) => {
      snippetInsertOpen = open;
    },
    setSnippetInsertHostIdentity: (identity) => {
      snippetInsertHostIdentity = identity;
    },
    setHeadingJumpOpen: (open) => {
      headingJumpOpen = open;
    },
    setBookmarkListOpen: (open) => {
      bookmarkListOpen = open;
    },
  });

  // -------------------------------------------------------------------------
  // Local UI helpers (close handlers, etc.) — kept here because they read /
  // write multiple $state fields at once.
  // -------------------------------------------------------------------------
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

  /** Build the unified project-search query state from the local fields. */
  function projectSearchQueryState(): ProjectSearchQueryState {
    return {
      text: projectSearchQuery,
      replacement: projectSearchReplace,
      caseSensitive: projectSearchCaseSensitive,
      wholeWord: projectSearchWholeWord,
      regex: projectSearchRegex,
    };
  }

  function closeProjectSearch(): void {
    projectSearchGeneration += 1;
    projectSearchOpen = false;
    projectSearchResults = [];
    projectSearchStatus = "";
    projectSearchRunning = false;
  }

  /**
   * Find-in-Project panel height is not persisted yet (no dedicated pref store);
   * the commit hook is a no-op so the resize handle still works in-session.
   */
  function persistProjectSearchHeightNow(): void {
    // intentionally empty — height resets to default each session.
  }

  function refreshQuickOpenCatalog(): void {
    getWorkspaceFileCatalogRegistry().refresh();
  }

  // -------------------------------------------------------------------------
  // Cross-overlay close-others coordinator.
  //
  // Pre-refactor the openPicker handlers in +page.svelte each had their own
  // inline "close the other pickers" block. The matrix is extracted into a
  // pure-logic coordinator (overlayCoordinator.ts) so it is unit-testable
  // without mounting the component.
  // -------------------------------------------------------------------------
  const coordinator = createOverlayCoordinator({
    getState: () => ({
      quickOpenOpen,
      commandPaletteOpen,
      headingJumpOpen,
      bookmarkListOpen,
      snippetInsertOpen,
      projectSearchOpen,
      sessionListOpen,
      addMultipleOpen,
      timelineOpen,
      workspaceContextMenu,
    }),
    patch: (p) => {
      if (p.quickOpenOpen !== undefined) quickOpenOpen = p.quickOpenOpen;
      if (p.commandPaletteOpen !== undefined) commandPaletteOpen = p.commandPaletteOpen;
      if (p.headingJumpOpen !== undefined) headingJumpOpen = p.headingJumpOpen;
      if (p.bookmarkListOpen !== undefined) bookmarkListOpen = p.bookmarkListOpen;
      if (p.snippetInsertOpen !== undefined) {
        if (p.snippetInsertOpen) {
          snippetInsertOpen = true;
        } else {
          closeSnippetInsert();
        }
      }
      if (p.projectSearchOpen !== undefined) projectSearchOpen = p.projectSearchOpen;
      if (p.sessionListOpen !== undefined) sessionListOpen = p.sessionListOpen;
      if (p.addMultipleOpen !== undefined) addMultipleOpen = p.addMultipleOpen;
      if (p.timelineOpen !== undefined) timelineOpen = p.timelineOpen;
      if (p.workspaceContextMenu !== undefined) {
        workspaceContextMenu = p.workspaceContextMenu;
      }
    },
    clearSnippetInsertHostIdentity: () => {
      snippetInsertHostIdentity = null;
    },
  });

  /**
   * The pickers that close the editor inline-tools when they open. Mirrors
   * the pre-refactor openHeadingJump/openBookmarkList/openSnippetInsert/
   * openCommandPalette calls to `editorTools.close({ restoreFocus: false })`.
   * (openQuickOpen did NOT close editor tools pre-refactor — preserved.)
   */
  function maybeCloseEditorTools(kind: OverlayKind): void {
    if (!coordinator.shouldCloseEditorTools(kind)) {
      return;
    }
    getEditorTools().close({ restoreFocus: false });
  }

  // -------------------------------------------------------------------------
  // Imperative API (captured by the parent via bind:this)
  // -------------------------------------------------------------------------
  function isAnyOverlayOpen(): boolean {
    return coordinator.isAnyOverlayOpen();
  }

  function openOverlay(kind: OverlayKind, options?: { focusReplace?: boolean }): void {
    switch (kind) {
      case "quickOpen":
        coordinator.closeOtherPickers("quickOpen");
        quickOpenOpenerPaneId = editorLayoutActivePaneId;
        // Query is reset by the picker component on open (via onQueryInput).
        quickOpenOpen = true;
        break;
      case "commandPalette":
        coordinator.closeOtherPickers("commandPalette");
        maybeCloseEditorTools("commandPalette");
        commandPaletteQuery = "";
        commandPaletteOpen = true;
        break;
      case "headingJump":
        coordinator.closeOtherPickers("headingJump");
        maybeCloseEditorTools("headingJump");
        headingJumpQuery = "";
        headingJumpOpen = true;
        break;
      case "bookmarkList":
        coordinator.closeOtherPickers("bookmarkList");
        maybeCloseEditorTools("bookmarkList");
        bookmarkListQuery = "";
        bookmarkListOpen = true;
        break;
      case "snippetInsert": {
        coordinator.closeOtherPickers("snippetInsert");
        maybeCloseEditorTools("snippetInsert");
        const host = getEditorWorkbench().getActiveHost();
        snippetInsertHostIdentity = host ? { ...host.identity } : null;
        snippetInsertQuery = "";
        snippetInsertOpen = true;
        break;
      }
      case "projectSearch":
        projectSearchOpen = true;
        projectSearchFocusReplace = options?.focusReplace ?? false;
        projectSearchNonce += 1;
        break;
      case "sessionList":
        void handlers.openSessionListPanel();
        break;
      case "addMultiple":
        void handlers.openAddMultipleWorkspaces();
        break;
      case "timeline":
        timelineOpen = true;
        break;
      case "workspaceContextMenu":
        // opened via openWorkspaceContextMenu (needs coords)
        break;
    }
  }

  function closeOverlay(kind: OverlayKind): void {
    switch (kind) {
      case "quickOpen":
        quickOpenOpen = false;
        break;
      case "commandPalette":
        commandPaletteOpen = false;
        break;
      case "headingJump":
        headingJumpOpen = false;
        break;
      case "bookmarkList":
        bookmarkListOpen = false;
        break;
      case "snippetInsert":
        closeSnippetInsert();
        break;
      case "projectSearch":
        closeProjectSearch();
        break;
      case "sessionList":
        sessionListOpen = false;
        break;
      case "addMultiple":
        handlers.cancelAddMultiple();
        break;
      case "timeline":
        timelineOpen = false;
        break;
      case "workspaceContextMenu":
        workspaceContextMenu = null;
        break;
    }
  }

  /**
   * Mirrors the pre-refactor workspace-switch picker-clear block at
   * +page.svelte:1553-1575. The catalog-retargeting half stayed on the page
   * (it depends on retained snapshot state + the catalog/registry singletons);
   * this method handles ONLY the picker-close + project-search-cancel half.
   *
   * Project search stays open but its in-flight search is cancelled and its
   * results/status/running flags are cleared (pre-refactor behavior).
   */
  function closeAllOnWorkspaceSwitch(): void {
    coordinator.closeAllOnWorkspaceSwitch();
    // M8 — cancel and clear project search on workspace switch so results
    // from the previous workspace never open after the switch.
    if (projectSearchOpen) {
      projectSearchGeneration += 1;
      projectSearchResults = [];
      projectSearchStatus = "";
      projectSearchRunning = false;
    }
    // NOTE: sessionList / addMultiple / timeline / workspaceContextMenu are
    // intentionally NOT closed here — pre-existing behavior pinned by L14.
  }

  /**
   * Mirrors the pre-refactor markdown-only picker closer at +page.svelte:1581-
   * 1591. Asymmetric with closeAllOnWorkspaceSwitch: bookmarkList is NOT
   * closed here (pre-existing behavior — bookmarks exist for any document).
   */
  function closeMarkdownOnlyPickers(language: string | undefined): void {
    coordinator.closeMarkdownOnlyPickers(language);
  }

  function openWorkspaceContextMenu(workspaceId: ContextId, x: number, y: number): void {
    workspaceContextMenu = { workspaceId, x, y };
  }

  const api: OverlayHostApi = {
    isAnyOverlayOpen,
    openOverlay,
    closeOverlay,
    closeAllOnWorkspaceSwitch,
    closeMarkdownOnlyPickers,
    openWorkspaceContextMenu,
    refreshQuickOpenCatalog,
  };
  export { api };

  // -------------------------------------------------------------------------
  // Exposed read snapshots for AppShell-rendered overlays (project search +
  // workspace context menu). The parent reads these via $derived on the
  // bound host instance and feeds them as AppShell props.
  // -------------------------------------------------------------------------
  const projectSearchPanelState = $derived<ProjectSearchPanelState>({
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
  });

  const workspaceContextMenuState = $derived<WorkspaceContextMenuState>({
    menu: workspaceContextMenu,
    workspaceId: workspaceContextMenu?.workspaceId ?? null,
  });

  const sessionListActiveSessionId = $derived(
    activeOpencodeSessionId, // surfaced for the panel's "active" highlight
  );

  // -------------------------------------------------------------------------
  // Project-search handlers exposed upward so AppShellHost can wire the
  // AppShell-rendered ProjectSearchPanel's callbacks directly into the host.
  // (No event-bus back-channel — straight function refs through the exported
  // instance surface.)
  // -------------------------------------------------------------------------
  async function runProjectSearch(): Promise<void> {
    await handlers.runProjectSearch(projectSearchQueryState());
  }
  async function replaceAllInProject(): Promise<void> {
    await handlers.replaceAllInProjectWithResults(
      projectSearchQueryState(),
      projectSearchResults,
      runProjectSearch,
    );
  }
  async function openProjectSearchResult(path: string, line: number): Promise<void> {
    await handlers.openProjectSearchResult(path, line);
  }
  function setProjectSearchQuery(value: string): void {
    projectSearchQuery = value;
  }
  function setProjectSearchReplace(value: string): void {
    projectSearchReplace = value;
  }
  function setProjectSearchCaseSensitive(value: boolean): void {
    projectSearchCaseSensitive = value;
  }
  function setProjectSearchWholeWord(value: boolean): void {
    projectSearchWholeWord = value;
  }
  function setProjectSearchRegex(value: boolean): void {
    projectSearchRegex = value;
  }
  function setProjectSearchHeight(heightPx: number): void {
    projectSearchHeightPx = heightPx;
  }

  export {
    projectSearchPanelState,
    workspaceContextMenuState,
    workspaceContextMenu,
    sessionListActiveSessionId,
    persistProjectSearchHeightNow as persistProjectSearchHeight,
    runProjectSearch,
    replaceAllInProject,
    openProjectSearchResult,
    setProjectSearchQuery,
    setProjectSearchReplace,
    setProjectSearchCaseSensitive,
    setProjectSearchWholeWord,
    setProjectSearchRegex,
    setProjectSearchHeight,
  };

  function onCommandPaletteSelect(commandId: string): void {
    commandPaletteOpen = false;
    runCommand(commandId as AppCommandId);
  }
</script>

<!-- The 5 lazy pickers (were inside AppShell.svelte) -->
{#await loadLazyPicker("command-palette", () => import("../CommandPalettePicker.svelte")) then Cmp}
  <Cmp.default
    open={commandPaletteOpen}
    results={commandPaletteResults}
    onSelect={onCommandPaletteSelect}
    onClose={closeCommandPalette}
    onQueryInput={(value: string) => {
      commandPaletteQuery = value;
    }}
  />
{/await}

{#await loadLazyPicker("quick-open", () => import("../QuickOpenPicker.svelte")) then Cmp}
  <Cmp.default
    open={quickOpenOpen}
    results={quickOpenResults}
    onSelect={(path: string) => {
      void handlers.handleQuickOpenSelect(path);
    }}
    onClose={closeQuickOpen}
    onRefresh={refreshQuickOpenCatalog}
    onQueryInput={(value: string) => {
      quickOpenQuery = value;
    }}
  />
{/await}

{#await loadLazyPicker("heading-jump", () => import("../HeadingJumpPicker.svelte")) then Cmp}
  <Cmp.default
    open={headingJumpOpen}
    results={headingJumpResults}
    onSelect={handlers.handleHeadingJumpSelect}
    onClose={closeHeadingJump}
    onQueryInput={(value: string) => {
      headingJumpQuery = value;
    }}
  />
{/await}

{#await loadLazyPicker("bookmark-list", () => import("../BookmarkListPicker.svelte")) then Cmp}
  <Cmp.default
    open={bookmarkListOpen}
    bookmarks={bookmarkListSnapshots}
    onSelect={handlers.handleBookmarkListSelect}
    onClose={closeBookmarkList}
    onQueryInput={(value: string) => {
      bookmarkListQuery = value;
    }}
  />
{/await}

{#await loadLazyPicker("snippet-insert", () => import("../SnippetInsertPicker.svelte")) then Cmp}
  <Cmp.default
    open={snippetInsertOpen}
    results={snippetInsertResults}
    onSelect={handlers.handleSnippetInsertSelect}
    onClose={closeSnippetInsert}
    onQueryInput={(value: string) => {
      snippetInsertQuery = value;
    }}
  />
{/await}

<!-- The 3 conditionally-rendered dialogs (were inside AppShell.svelte) -->
<SessionListPanel
  open={sessionListOpen}
  sessions={sessionListSessions}
  openSessionIds={openSessionIdsForPanel}
  activeSessionId={sessionListActiveSessionId}
  loading={sessionListLoading}
  errorMessage={sessionListError}
  sort={sessionListSort}
  searchQuery={sessionListSearch}
  onOpenSession={(sessionId, title) => {
    void handlers.handleOpenSessionFromList(sessionId, title);
  }}
  onClose={() => handlers.closeSessionListPanel()}
  onSearchChange={(query) => {
    sessionListSearch = query;
    void handlers.refreshSessionList();
  }}
  onSortChange={(next) => {
    sessionListSort = next;
  }}
  onRefresh={() => {
    void handlers.refreshSessionList();
  }}
/>

<AddMultipleWorkspacesModal
  open={addMultipleOpen}
  loading={addMultipleLoading}
  errorMessage={addMultipleError}
  parentPath={addMultipleParentPath}
  entries={addMultipleEntries}
  selected={addMultipleSelected}
  onToggleEntry={(path, checked) => {
    addMultipleSelected = handlers.toggleAddMultipleEntry(path, checked, addMultipleSelected);
  }}
  onConfirm={() => {
    void handlers.confirmAddMultiple([...addMultipleSelected]);
  }}
  onCancel={handlers.cancelAddMultiple}
/>

<SessionTimelineDialog
  open={timelineOpen}
  messages={activeMessages}
  searchQuery={timelineSearch}
  onJumpToMessage={(messageId) => {
    // Dispatch a custom event the ChatMessageList can listen for to scroll
    // the target message into view. Best-effort: a no-op when no listener.
    window.dispatchEvent(
      new CustomEvent("specops:scroll-to-message", { detail: { messageId } }),
    );
  }}
  onClose={() => {
    timelineOpen = false;
  }}
  onSearchChange={(query) => {
    timelineSearch = query;
  }}
/>
