import type { AppDomainState, WorkspaceLayoutState } from "../domain/contracts";
import { getSessionTabs, isFileTab } from "../domain/contracts";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import { buildDocumentByIdMap } from "./tabDocumentLookup";

export const DEFAULT_MARKDOWN_SPLIT_MIN_EDITOR_WIDTH = 760;

export const RESPONSIVE_CONSOLE_CLOSE_WIDTH = 900;
export const RESPONSIVE_PANEL_COLLAPSE_WIDTH = 1100;
export const RESPONSIVE_PANEL_COLLAPSE_WIDTH_SESSION = 1200;
export const RESPONSIVE_SESSIONS_COLLAPSE_WIDTH = 1320;
export const RESPONSIVE_SESSIONS_COLLAPSE_WIDTH_SESSION = 1400;

export function watchedPathsFromState(state: AppDomainState): string[] {
  const paths = new Set<string>();
  const session = getActiveSession(state);
  const documents = getActiveDocuments(state);
  const documentById = buildDocumentByIdMap(documents);
  for (const tab of getSessionTabs(session)) {
    if (!isFileTab(tab)) {
      continue;
    }
    const documentState = documentById.get(tab.documentId);
    if (documentState?.filePath) {
      paths.add(documentState.filePath);
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
