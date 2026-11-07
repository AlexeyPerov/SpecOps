import { addWorkspaceToWindow } from "../../services/addWorkspaceToWindow";
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

import { tick } from "svelte";
import type { EditorHostIdentity } from "../../types/editor";
import type { EditorToolController } from "../../editor/editorToolController";
import type { EditorWorkbenchRuntime } from "../../editor/editorWorkbenchRuntime";
import type { WorkspaceFileCatalogRegistry } from "../../services/workspaceFileCatalogRegistry";
import {
  searchInProject,
  totalMatchCount,
  MAX_SEARCH_TOTAL_MATCHES,
  type ProjectSearchResult,
} from "../../services/projectSearch";
import { replaceInProjectFile } from "../../services/projectFileOps";
import {
  createSearchQuery,
  validateSearchQuery,
  type SearchQuery,
} from "../../editor/searchQuery";
import { requestConfirm } from "../../services/confirmDialogUi";
import { anchorFromElement } from "../../services/promptAnchor";
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
import { appState } from "../../state/appState";

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
  /** Shared catalog registry — passed in from the page (which owns its lifecycle). */
  getWorkspaceFileCatalogRegistry: () => WorkspaceFileCatalogRegistry;
  /** Active document markdown view mode — pickers switch preview → edit. */
  getActiveDocumentMarkdownViewMode: () => "edit" | "split" | "preview" | undefined;
  /** Switch markdown view mode (delegates to layout handlers). */
  setMarkdownViewMode: (mode: "edit" | "split" | "preview") => void;
  /** Open a path through the gated open pipeline (project-search result jump). */
  openAndActivatePath: (path: string) => Promise<unknown>;

  // --- Project search setters ---
  setProjectSearchResults: (results: ProjectSearchResult[]) => void;
  setProjectSearchStatus: (status: string) => void;
  setProjectSearchRunning: (running: boolean) => void;
  bumpProjectSearchGeneration: () => number;
  getProjectSearchGeneration: () => number;

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
      text: state.text,
      replacement: state.replacement,
      caseSensitive: state.caseSensitive,
      wholeWord: state.wholeWord,
      regexp: state.regex,
    });
  }

  async function runProjectSearch(state: ProjectSearchQueryState): Promise<void> {
    const generation = deps.bumpProjectSearchGeneration();
    deps.setProjectSearchRunning(false);
    deps.setProjectSearchResults([]);
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
    deps.setProjectSearchStatus("Preparing workspace files…");
    const isCurrent = () => generation === deps.getProjectSearchGeneration()
      && root === deps.getActiveWorkspaceRoot();
    let catalogTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const registry = deps.getWorkspaceFileCatalogRegistry();
      const catalog = registry.getActive();
      registry.ensureReady();
      await Promise.race([
        registry.waitForReady(),
        new Promise<never>((_, reject) => {
          catalogTimer = setTimeout(() => reject(new Error("File listing timed out. Retry the search.")), 30_000);
        }),
      ]);
      clearTimeout(catalogTimer);
      if (!isCurrent()) return;
      const snapshot = catalog?.getSnapshot();
      if (snapshot?.status === "error") {
        throw new Error(snapshot.errorMessage ?? "Could not list workspace files.");
      }
      // Capture entries rather than asking the active registry again after an await.
      // A watcher may already have started rebuilding this same catalog.
      const paths = snapshot?.entries.map(entry => entry.absolutePath);
      const directorySuffix = snapshot?.partialErrors.length
        ? `, ${snapshot.partialErrors.length} folders unreadable` : "";
      let scannedCount = 0;
      let lastProgress = 0;
      deps.setProjectSearchStatus(`Searching… 0/${paths?.length ?? "?"} files`);
      const outcome = await searchInProject(root, query, {
        files: paths,
        isCancelled: () => !isCurrent(),
        onProgress: () => {
          if (!isCurrent()) return false;
          scannedCount += 1;
          if (scannedCount % 200 === 0 || Date.now() - lastProgress > 100) {
            lastProgress = Date.now();
            deps.setProjectSearchStatus(`Searching… ${scannedCount} files`);
          }
          return isCurrent();
        },
      });
      if (!isCurrent()) {
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
      const unreadableSuffix =
        outcome.unreadableFiles > 0 ? `, ${outcome.unreadableFiles} unreadable` : "";
      const largeSuffix = outcome.skippedLarge ? `, ${outcome.skippedLarge} oversized skipped` : "";
      deps.setProjectSearchStatus(
        matches === 0
          ? `No results (${outcome.scannedFiles} files scanned${unreadableSuffix}${largeSuffix}${directorySuffix})`
          : `${matches} result${matches === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}${
              outcome.truncated ? " (capped — refine the search to see all matches)" : ""
            }${unreadableSuffix}${largeSuffix}${directorySuffix}`,
      );
    } catch (error: unknown) {
      if (generation === deps.getProjectSearchGeneration()) {
        deps.setProjectSearchStatus(`Search failed: ${getErrorMessage(error)}`);
      }
    } finally {
      clearTimeout(catalogTimer);
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
    if (totalMatchCount(results) >= MAX_SEARCH_TOTAL_MATCHES) {
      deps.notify("Refine the search before replacing: the result limit was reached.");
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
    const confirmationGeneration = deps.getProjectSearchGeneration();
    const confirmed = await requestConfirm({
      title: "Replace in Project",
      message: `Replace ${totalMatches} match${totalMatches === 1 ? "" : "es"} in ${totalFiles} file${totalFiles === 1 ? "" : "s"}?`,
      confirmLabel: "Replace All",
      danger: true,
      // Beside the panel's Replace All button when it is on screen (the
      // command can also run from the keyboard).
      anchor: anchorFromElement(document.querySelector("[data-project-replace-all]")),
    });
    if (!confirmed || confirmationGeneration !== deps.getProjectSearchGeneration()
      || root !== deps.getActiveWorkspaceRoot()) {
      return;
    }
    deps.setProjectSearchRunning(true);
    deps.setProjectSearchStatus("Replacing…");
    let replaced = 0;
    let files = 0;
    let failures = 0;
    let skippedDirty = 0;
    let skippedNonUtf8 = 0;
    let cancelled = false;
    // P03-08-31: the replace loop is a long mutation; report progress so the
    // status bar reflects how far along it is, and honor the search generation
    // so starting a new search (or closing the panel) cancels an in-flight
    // replace instead of letting it run to completion in the background.
    const replaceGeneration = deps.bumpProjectSearchGeneration();
    const progressInterval = Math.max(1, Math.floor(totalFiles / 20));
    try {
      for (let index = 0; index < results.length; index += 1) {
        if (replaceGeneration !== deps.getProjectSearchGeneration()
          || root !== deps.getActiveWorkspaceRoot()) {
          cancelled = true;
          break;
        }
        if (index % progressInterval === 0 && index > 0) {
          deps.setProjectSearchStatus(
            `Replacing… ${index}/${totalFiles} files`,
          );
        }
        const result = results[index]!;
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
          syncOpenDocumentAfterReplaceService(
            result.path,
            outcome.content,
            outcome.fingerprint,
            { lineEnding: outcome.lineEnding, hasBom: outcome.hasBom },
          );
        } else if (outcome.reason === "File is not valid UTF-8 text and was skipped.") {
          // Non-UTF-8 files are skipped rather than corrupted (C5); surface the
          // count so the user knows matches were left untouched.
          skippedNonUtf8 += 1;
        } else if (outcome.reason !== "No matches.") {
          failures += 1;
        }
      }
      if (cancelled || replaceGeneration !== deps.getProjectSearchGeneration()) {
        deps.notify(`Replace cancelled — ${replaced} occurrence(s) replaced before cancel.`);
        return;
      }
      deps.setProjectSearchStatus(
        `Replaced ${replaced} occurrence(s) in ${files} file(s)${
          failures > 0 ? `; ${failures} file(s) failed` : ""
        }${skippedDirty > 0 ? `; skipped ${skippedDirty} file(s) with unsaved changes` : ""}${
          skippedNonUtf8 > 0 ? `; skipped ${skippedNonUtf8} non-UTF-8 file(s)` : ""
        }`,
      );
      deps.notify(
        [
          `Replaced ${replaced} occurrence(s) in ${files} file(s).`,
          skippedDirty > 0 ? `Skipped ${skippedDirty} with unsaved changes.` : "",
          skippedNonUtf8 > 0 ? `Skipped ${skippedNonUtf8} non-UTF-8 file(s).` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      await rerunSearch();
    } catch (error: unknown) {
      if (replaceGeneration === deps.getProjectSearchGeneration()) {
        deps.setProjectSearchStatus(`Replace failed: ${getErrorMessage(error)}`);
      }
    } finally {
      if (replaceGeneration === deps.getProjectSearchGeneration()) {
        deps.setProjectSearchRunning(false);
      }
    }
  }

  async function openProjectSearchResult(path: string, line: number): Promise<void> {
    await deps.openAndActivatePath(path);
    if (line > 0) {
      // Wait for Svelte to flush the open-pipeline DOM update so the new
      // editor runner is installed before goToLine runs (pre-L14 behavior).
      await tick();
      deps.getEditorWorkbench().getActiveRunner()?.goToLine(line);
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
      const created = await addWorkspaceToWindow(path);
      if (created) {
        added += 1;
      } else {
        blocked += 1;
      }
    }
    if (added > 0) {
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
    void new RegExp(query, "mu");
    return "";
  } catch (error: unknown) {
    return error instanceof Error ? error.message : "Invalid regular expression.";
  }
}
