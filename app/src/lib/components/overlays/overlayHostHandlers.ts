/**
 * Overlay host handler factories.
 *
 * Pure-logic handler bodies extracted from `+page.svelte` for the overlays now
 * owned by `OverlayHost.svelte`: project search (run / replace / open-result),
 * the per-picker select handlers, the session-list refresh flow, and the
 * add-multiple-workspaces modal flow. The component owns the `$state` and the
 * cross-overlay close-others coordination; this module owns the imperative
 * workflows that read that state and call back into setter hooks the component
 * provides.
 *
 * Mirrors the `createAppShellXxxHandlers(deps)` pattern shared across
 * `appShellPageHandlers.ts` / `appShellLayoutHandlers.ts` / etc.
 */

import type { EditorHostIdentity } from "../../types/editor";
import type { EditorToolController } from "../../editor/editorToolController";
import type { EditorWorkbenchRuntime } from "../../editor/editorWorkbenchRuntime";
import type { WorkspaceFileCatalog } from "../../services/workspaceFileCatalog";
import type { WorkspaceFileCatalogRegistry } from "../../services/workspaceFileCatalogRegistry";
import {
  searchInProject,
  totalMatchCount,
  type ProjectSearchResult,
} from "../../services/projectSearch";
import { replaceInProjectFile } from "../../services/projectFileOps";
import {
  createSearchQuery,
  validateSearchQuery,
  type SearchQuery,
} from "../../editor/searchQuery";
import { requestConfirm } from "../../services/confirmDialogUi";
import {
  decideReplaceAllForPath,
  syncOpenDocumentAfterReplace as syncOpenDocumentAfterReplaceService,
} from "../../services/projectReplaceSync";
import { getErrorMessage } from "../../commands/commandErrors";
import {
  describeOpenActivePathResult,
  openActivePathInPane,
} from "../../services/openActivePath";
import { collectImmediateSubfolders } from "../../services/workspaceSubfolders";
import { normalizePathSync } from "../../services/diskFingerprint";
import { openFolderDialog } from "../../services/fileSystem";
import { markWorkspaceLifecycleActive } from "../../services/workspaceLifecycle";
import { appState } from "../../state/appState";
import type { WorkspaceAgentSessionDetails } from "../../ai/backends/workspaceAgentBackend";

/** Inputs shared by every project-search handler. */
export interface ProjectSearchQueryState {
  text: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface OverlayHostHandlersDeps {
  notify: (message: string) => void;
  /** Active workspace root for search scoping + add-multiple de-dup. */
  getActiveWorkspaceRoot: () => string | null;
  /** Current window id (used by openActivePathInPane). */
  getCurrentWindowId: () => string;
  /** Active editor layout pane id — quick-open opens into this pane. */
  getEditorLayoutActivePaneId: () => string;
  /** The workbench runtime — picker reads host queries (headings, bookmarks). */
  getEditorWorkbench: () => EditorWorkbenchRuntime;
  /** Editor tool controller — used to close inline tools when pickers open. */
  getEditorTools: () => EditorToolController;
  /** Shared catalogs — passed in from the page (which owns their lifecycle). */
  getWorkspaceFileCatalog: () => WorkspaceFileCatalog;
  getWorkspaceFileCatalogRegistry: () => WorkspaceFileCatalogRegistry;
  /** Active document markdown view mode — pickers switch preview → edit. */
  getActiveDocumentMarkdownViewMode: () => "edit" | "split" | "preview" | undefined;
  /** Switch markdown view mode (delegates to layout handlers). */
  setMarkdownViewMode: (mode: "edit" | "split" | "preview") => void;
  /** Open a path through the gated open pipeline (project-search result jump). */
  openAndActivatePath: (path: string) => Promise<void>;

  // --- Project search setters ---
  setProjectSearchResults: (results: ProjectSearchResult[]) => void;
  setProjectSearchStatus: (status: string) => void;
  setProjectSearchRunning: (running: boolean) => void;
  bumpProjectSearchGeneration: () => number;
  getProjectSearchGeneration: () => number;

  // --- Session list setters + backend hooks ---
  setSessionListLoading: (loading: boolean) => void;
  setSessionListSessions: (sessions: WorkspaceAgentSessionDetails[]) => void;
  /** Returns the current session-list search query (controlled input). */
  getSessionListSearch: () => string;
  handleListWorkspaceSessions: (options: {
    search?: string;
  }) => Promise<WorkspaceAgentSessionDetails[]>;
  handleOpenExternalSession: (sessionId: string, title?: string) => Promise<void>;
  setSessionListOpen: (open: boolean) => void;

  // --- Add-multiple setters ---
  setAddMultipleOpen: (open: boolean) => void;
  setAddMultipleLoading: (loading: boolean) => void;
  setAddMultipleError: (error: string | null) => void;
  setAddMultipleParentPath: (path: string | null) => void;
  setAddMultipleEntries: (
    entries: ReadonlyArray<{ path: string; name: string; exists: boolean }>,
  ) => void;
  setAddMultipleSelected: (selected: Set<string>) => void;
  /** Snapshot of all current workspaces (for add-multiple de-dup). */
  getWorkspaceRoots: () => string[];

  // --- Quick open ---
  /** Captured pane id at invocation; picker opens the file into this pane. */
  getQuickOpenOpenerPaneId: () => string | null;
  setQuickOpenOpen: (open: boolean) => void;

  // --- Snippet insert ---
  /** Snippet insert captures host identity at invocation for stale-pane guard. */
  getSnippetInsertHostIdentity: () => EditorHostIdentity | null;
  setSnippetInsertOpen: (open: boolean) => void;
  setSnippetInsertHostIdentity: (identity: EditorHostIdentity | null) => void;

  // --- Heading / bookmark ---
  setHeadingJumpOpen: (open: boolean) => void;
  setBookmarkListOpen: (open: boolean) => void;
}

export function createOverlayHostHandlers(deps: OverlayHostHandlersDeps) {
  // -----------------------------------------------------------------------
  // Project search
  // -----------------------------------------------------------------------

  function buildProjectSearchQuery(state: ProjectSearchQueryState): SearchQuery {
    return createSearchQuery({
      text: state.text.trim(),
      replacement: state.replacement,
      caseSensitive: state.caseSensitive,
      wholeWord: state.wholeWord,
      regexp: state.regex,
    });
  }

  async function runProjectSearch(state: ProjectSearchQueryState): Promise<void> {
    const root = deps.getActiveWorkspaceRoot();
    const query = buildProjectSearchQuery(state);
    const validation = validateSearchQuery(query);
    if (!root) {
      deps.setProjectSearchResults([]);
      deps.setProjectSearchStatus("Open a workspace to search.");
      return;
    }
    if (!validation.ok) {
      deps.setProjectSearchResults([]);
      deps.setProjectSearchStatus(validation.reason);
      return;
    }
    deps.setProjectSearchRunning(true);
    deps.setProjectSearchStatus("Searching…");
    // Invalidate any in-flight search so stale results never land.
    const generation = deps.bumpProjectSearchGeneration();
    try {
      const outcome = await searchInProject(root, query, {
        files:
          deps.getWorkspaceFileCatalogRegistry().getActive()?.getOpenablePaths() ??
          deps.getWorkspaceFileCatalog().getOpenablePaths() ??
          undefined,
        onProgress: () => generation === deps.getProjectSearchGeneration(),
      });
      if (generation !== deps.getProjectSearchGeneration()) {
        return;
      }
      if (!outcome.ok) {
        deps.setProjectSearchResults([]);
        deps.setProjectSearchStatus(outcome.reason);
        return;
      }
      const results = outcome.results;
      deps.setProjectSearchResults(results);
      const files = results.length;
      const matches = totalMatchCount(results);
      deps.setProjectSearchStatus(
        matches === 0
          ? "No results"
          : `${matches} result${matches === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}`,
      );
    } catch (error: unknown) {
      if (generation === deps.getProjectSearchGeneration()) {
        deps.setProjectSearchStatus(`Search failed: ${getErrorMessage(error)}`);
      }
    } finally {
      if (generation === deps.getProjectSearchGeneration()) {
        deps.setProjectSearchRunning(false);
      }
    }
  }

  /**
   * Replace-all across the project. Takes the *current* search results so the
   * handler can be pure logic — the component owns the live result array.
   */
  async function replaceAllInProjectWithResults(
    state: ProjectSearchQueryState,
    results: ProjectSearchResult[],
    rerunSearch: () => Promise<void>,
  ): Promise<void> {
    const root = deps.getActiveWorkspaceRoot();
    if (!root || results.length === 0) {
      deps.notify("Nothing to replace.");
      return;
    }
    const query = buildProjectSearchQuery(state);
    const validation = validateSearchQuery(query);
    if (!validation.ok) {
      deps.notify(validation.reason);
      return;
    }
    const totalFiles = results.length;
    const totalMatches = totalMatchCount(results);
    const confirmed = await requestConfirm({
      title: "Replace in Project",
      message: `Replace ${totalMatches} match${totalMatches === 1 ? "" : "es"} in ${totalFiles} file${totalFiles === 1 ? "" : "s"}?`,
      confirmLabel: "Replace All",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    deps.setProjectSearchRunning(true);
    deps.setProjectSearchStatus("Replacing…");
    let replaced = 0;
    let files = 0;
    let failures = 0;
    let skippedDirty = 0;
    try {
      for (const result of results) {
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
      deps.setProjectSearchStatus(
        `Replaced ${replaced} occurrence(s) in ${files} file(s)${
          failures > 0 ? `; ${failures} file(s) failed` : ""
        }${skippedDirty > 0 ? `; skipped ${skippedDirty} file(s) with unsaved changes` : ""}`,
      );
      deps.notify(
        skippedDirty > 0
          ? `Replaced ${replaced} occurrence(s) in ${files} file(s); skipped ${skippedDirty} with unsaved changes.`
          : `Replaced ${replaced} occurrence(s) in ${files} file(s).`,
      );
      await rerunSearch();
    } finally {
      deps.setProjectSearchRunning(false);
    }
  }

  async function openProjectSearchResult(path: string, line: number): Promise<void> {
    await deps.openAndActivatePath(path);
    if (line > 0) {
      const workbench = deps.getEditorWorkbench();
      // Mirror the page's `await tick()` boundary: the runner is captured
      // after the open pipeline has installed the new editor.
      await new Promise<void>((resolve) => {
        // Defer to the next microtask + one frame so the editor host mounts.
        requestAnimationFrame(() => resolve());
      });
      workbench.getActiveRunner()?.goToLine(line);
    }
  }

  // -----------------------------------------------------------------------
  // Quick open
  // -----------------------------------------------------------------------

  async function handleQuickOpenSelect(path: string): Promise<void> {
    const targetPaneId = deps.getQuickOpenOpenerPaneId() ?? deps.getEditorLayoutActivePaneId();
    const result = await openActivePathInPane(path, deps.getCurrentWindowId(), targetPaneId);
    deps.notify(describeOpenActivePathResult(result));
    if (result.kind === "failed" || result.kind === "missing") {
      // Keep the picker open so the user sees the failure and can retry.
      return;
    }
    deps.setQuickOpenOpen(false);
  }

  // -----------------------------------------------------------------------
  // Heading jump / bookmark list / snippet insert
  // -----------------------------------------------------------------------

  function handleHeadingJumpSelect(headingKey: string): void {
    // Preview-only: switch to edit so the CodeMirror host can reveal the heading.
    if (deps.getActiveDocumentMarkdownViewMode() === "preview") {
      deps.setMarkdownViewMode("edit");
    }
    const workbench = deps.getEditorWorkbench();
    const host = workbench.getActiveHost();
    host?.actions.navigation.jumpToHeading(headingKey);
    host?.focus();
    deps.setHeadingJumpOpen(false);
  }

  function handleBookmarkListSelect(line: number): void {
    const workbench = deps.getEditorWorkbench();
    const host = workbench.getActiveHost();
    if (host) {
      host.actions.navigation.goToLine(line);
      host.focus();
    }
    deps.setBookmarkListOpen(false);
  }

  function handleSnippetInsertSelect(snippetId: string): void {
    const captured = deps.getSnippetInsertHostIdentity();
    const workbench = deps.getEditorWorkbench();
    const host = workbench.getActiveHost();
    // Reject stale pane/document after a context switch while the picker was open.
    if (
      !host ||
      !captured ||
      host.identity.paneId !== captured.paneId ||
      host.identity.documentId !== captured.documentId ||
      host.identity.generation !== captured.generation
    ) {
      deps.notify("Snippet insert cancelled — editor context changed.");
      deps.setSnippetInsertOpen(false);
      deps.setSnippetInsertHostIdentity(null);
      return;
    }
    if (deps.getActiveDocumentMarkdownViewMode() === "preview") {
      deps.setMarkdownViewMode("edit");
    }
    host.actions.snippets.insert(snippetId);
    host.focus();
    deps.setSnippetInsertOpen(false);
    deps.setSnippetInsertHostIdentity(null);
  }

  // -----------------------------------------------------------------------
  // Session list panel
  // -----------------------------------------------------------------------

  async function refreshSessionList(): Promise<void> {
    deps.setSessionListLoading(true);
    try {
      // handleListWorkspaceSessions degrades to [] and never throws (M7-T5
      // surfaces failures via diagnostics instead), so there's nothing to
      // catch here — kept in try/finally purely for the loading toggle.
      const sessions = await deps.handleListWorkspaceSessions({
        ...(deps.getSessionListSearch().trim()
          ? { search: deps.getSessionListSearch().trim() }
          : {}),
      });
      deps.setSessionListSessions(sessions);
    } finally {
      deps.setSessionListLoading(false);
    }
  }

  async function openSessionListPanel(): Promise<void> {
    deps.setSessionListOpen(true);
    await refreshSessionList();
  }

  function closeSessionListPanel(): void {
    deps.setSessionListOpen(false);
  }

  async function handleOpenSessionFromList(sessionId: string, title?: string): Promise<void> {
    await deps.handleOpenExternalSession(sessionId, title);
    closeSessionListPanel();
  }

  // -----------------------------------------------------------------------
  // Add multiple workspaces
  // -----------------------------------------------------------------------

  /**
   * "Add multiple…" flow (decision 8): folder picker → list immediate
   * subfolders → modal with checkboxes (default unchecked, existing excluded)
   * → batch add. Reuses the same add logic per path as `workspace.add`
   * (duplicates skipped, access errors notified).
   */
  async function openAddMultipleWorkspaces(): Promise<void> {
    const parent = await openFolderDialog();
    if (!parent) {
      return;
    }
    deps.setAddMultipleOpen(true);
    deps.setAddMultipleLoading(true);
    deps.setAddMultipleError(null);
    deps.setAddMultipleParentPath(parent);
    deps.setAddMultipleEntries([]);
    deps.setAddMultipleSelected(new Set());
    try {
      const existing = new Set(
        deps.getWorkspaceRoots().map((root) => normalizePathSync(root)),
      );
      const entries = await collectImmediateSubfolders(parent, existing);
      deps.setAddMultipleEntries(entries);
    } catch (error) {
      deps.setAddMultipleError(error instanceof Error ? error.message : String(error));
    } finally {
      deps.setAddMultipleLoading(false);
    }
  }

  function toggleAddMultipleEntry(path: string, checked: boolean, selected: Set<string>): Set<string> {
    const next = new Set(selected);
    if (checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    return next;
  }

  async function confirmAddMultiple(selectedPaths: string[]): Promise<void> {
    deps.setAddMultipleOpen(false);
    deps.setAddMultipleEntries([]);
    deps.setAddMultipleSelected(new Set());
    deps.setAddMultipleParentPath(null);
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
      deps.notify(parts.join(" "));
    }
  }

  function cancelAddMultiple(): void {
    deps.setAddMultipleOpen(false);
    deps.setAddMultipleEntries([]);
    deps.setAddMultipleSelected(new Set());
    deps.setAddMultipleError(null);
    deps.setAddMultipleParentPath(null);
  }

  return {
    buildProjectSearchQuery,
    runProjectSearch,
    replaceAllInProjectWithResults,
    openProjectSearchResult,
    handleQuickOpenSelect,
    handleHeadingJumpSelect,
    handleBookmarkListSelect,
    handleSnippetInsertSelect,
    refreshSessionList,
    openSessionListPanel,
    closeSessionListPanel,
    handleOpenSessionFromList,
    openAddMultipleWorkspaces,
    toggleAddMultipleEntry,
    confirmAddMultiple,
    cancelAddMultiple,
  };
}

export type OverlayHostHandlers = ReturnType<typeof createOverlayHostHandlers>;

/**
 * Compute the search-query regex validation error string (empty when valid or
 * when regex mode is off / the query is blank). Lifted verbatim from the
 * inline `$derived.by` so the component's reactive derivation can call into
 * pure logic.
 */
export function computeProjectSearchQueryError(query: string, regex: boolean): string {
  if (!regex || !query.trim()) {
    return "";
  }
  try {
    void new RegExp(query.trim());
    return "";
  } catch (error: unknown) {
    return error instanceof Error ? error.message : "Invalid regular expression.";
  }
}
