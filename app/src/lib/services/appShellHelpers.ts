import type { AppDomainState, WorkspaceLayoutState } from "../domain/contracts";
import { allTabs, isFileTab } from "../domain/contracts";
import { allContextSnapshots } from "../state/appState/contextHelpers";
import { buildDocumentByIdMap } from "./tabDocumentLookup";

export const DEFAULT_MARKDOWN_SPLIT_MIN_EDITOR_WIDTH = 760;

export const RESPONSIVE_CONSOLE_CLOSE_WIDTH = 900;
export const RESPONSIVE_PANEL_COLLAPSE_WIDTH = 1100;
export const RESPONSIVE_PANEL_COLLAPSE_WIDTH_SESSION = 1200;
export const RESPONSIVE_SESSIONS_COLLAPSE_WIDTH = 1320;
export const RESPONSIVE_SESSIONS_COLLAPSE_WIDTH_SESSION = 1400;

/**
 * Defensive cap on the number of file paths handed to the native watcher.
 * Re-subscribing a very large path set on every tab/context churn is costly;
 * past this bound the watcher sync stops growing and relies on per-file
 * focus/startup checks instead. Typical sessions stay well under this.
 */
export const MAX_WATCHED_PATHS = 500;

/**
 * Collect file paths from open file tabs across the notepad, chat-http, and
 * every workspace context — not just the active one. The external file watcher
 * must observe files that live in a workspace which is not currently active,
 * otherwise external edits to those background files go undetected until the
 * user switches back to that workspace.
 *
 * Paths are sorted before returning so the result is order-independent: which
 * workspace is active changes the iteration order of `allContextSnapshots`, but
 * not the underlying path set. Without sorting, the watcher sync key churned on
 * every switch (firing a watcher-resync IPC for an identical watched set), and
 * the `MAX_WATCHED_PATHS` truncation picked a different subset per active
 * workspace when the total exceeded the cap (genuine watch/unwatch churn).
 */
export function watchedPathsFromState(state: AppDomainState): string[] {
  const paths = new Set<string>();
  for (const entry of allContextSnapshots(state)) {
    const documentById = buildDocumentByIdMap(entry.snapshot.documents);
    for (const tab of allTabs(entry.snapshot.session.editorLayout)) {
      if (!isFileTab(tab)) {
        continue;
      }
      const documentState = documentById.get(tab.documentId);
      if (documentState?.filePath) {
        paths.add(documentState.filePath);
      }
    }
  }
  // Sort so the key (and any truncation) is deterministic across switches.
  return [...paths].sort();
}

/**
 * Truncate the watched path list to the defensive cap, keeping a deterministic
 * sorted subset so re-entry to a workspace with > 500 open tabs reuses the same
 * truncated set as the prior visit (no churn).
 */
export function truncateWatchedPaths(paths: readonly string[]): string[] {
  if (paths.length <= MAX_WATCHED_PATHS) {
    return [...paths];
  }
  // `paths` is expected to be pre-sorted (from `watchedPathsFromState`); sort
  // again defensively so callers that pass an unsorted list still get a stable
  // truncation.
  return [...paths].sort().slice(0, MAX_WATCHED_PATHS);
}

/** Stable dedupe key for external file-watcher sync (watch flag + watched paths). */
export function externalFileWatcherSyncKey(state: AppDomainState): string {
  const paths = truncateWatchedPaths(watchedPathsFromState(state));
  return `${state.settings.externalFiles.watchExternalChanges}:${paths.join("\0")}`;
}

export function formatStatusPath(
  filePath: string | null,
  fallbackTitle: string | undefined,
  defaultUntitledTitle: string,
): string {
  if (!filePath) {
    return fallbackTitle ?? defaultUntitledTitle;
  }
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] ?? normalized;
}

export function canFitMarkdownSplit(
  editorPaneWidth: number,
  minWidth = DEFAULT_MARKDOWN_SPLIT_MIN_EDITOR_WIDTH,
): boolean {
  return editorPaneWidth >= minWidth;
}

export interface ResponsiveLayoutInput {
  shellMainRowWidth: number;
  workspaceActive: boolean;
  isSessionTabActive: boolean;
  workspaceLayout: WorkspaceLayoutState;
  consoleOpen: boolean;
}

export interface ResponsiveLayoutFlags {
  autoProjectPanelCollapsed: boolean;
  autoSessionsSidebarCollapsed: boolean;
  consoleOpen: boolean;
}

export function computeResponsiveLayoutFlags(
  input: ResponsiveLayoutInput,
): ResponsiveLayoutFlags {
  const sessionTabLayout = input.isSessionTabActive && input.workspaceActive;
  const panelCollapseWidth = sessionTabLayout
    ? RESPONSIVE_PANEL_COLLAPSE_WIDTH_SESSION
    : RESPONSIVE_PANEL_COLLAPSE_WIDTH;
  const sessionsCollapseWidth = sessionTabLayout
    ? RESPONSIVE_SESSIONS_COLLAPSE_WIDTH_SESSION
    : RESPONSIVE_SESSIONS_COLLAPSE_WIDTH;

  const autoProjectPanelCollapsed =
    input.shellMainRowWidth > 0 &&
    input.shellMainRowWidth < panelCollapseWidth &&
    input.workspaceActive;

  const autoSessionsSidebarCollapsed =
    input.shellMainRowWidth > 0 &&
    input.shellMainRowWidth < sessionsCollapseWidth &&
    input.workspaceActive;

  const projectPanelCollapsed =
    input.workspaceLayout.projectPanelCollapsed || autoProjectPanelCollapsed;

  const consoleOpen =
    input.shellMainRowWidth > 0 &&
    input.shellMainRowWidth < RESPONSIVE_CONSOLE_CLOSE_WIDTH &&
    projectPanelCollapsed
      ? false
      : input.consoleOpen;

  return {
    autoProjectPanelCollapsed,
    autoSessionsSidebarCollapsed,
    consoleOpen,
  };
}
