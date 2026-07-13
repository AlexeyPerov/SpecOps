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
        if (paths.size >= MAX_WATCHED_PATHS) {
          return [...paths];
        }
      }
    }
  }
  return [...paths];
}

/** Stable dedupe key for external file-watcher sync (watch flag + watched paths). */
export function externalFileWatcherSyncKey(state: AppDomainState): string {
  const paths = watchedPathsFromState(state);
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
