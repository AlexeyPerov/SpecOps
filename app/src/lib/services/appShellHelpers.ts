import type { AppDomainState, WorkspaceLayoutState } from "../domain/contracts";
import { isFileTab } from "../domain/contracts";

export const DEFAULT_MARKDOWN_SPLIT_MIN_EDITOR_WIDTH = 760;

export const RESPONSIVE_CONSOLE_CLOSE_WIDTH = 900;
export const RESPONSIVE_PANEL_COLLAPSE_WIDTH = 1100;
export const RESPONSIVE_PANEL_COLLAPSE_WIDTH_AGENT = 1200;
export const RESPONSIVE_AGENTS_COLLAPSE_WIDTH = 1320;
export const RESPONSIVE_AGENTS_COLLAPSE_WIDTH_AGENT = 1400;

export function watchedPathsFromState(state: AppDomainState): string[] {
  const paths = new Set<string>();
  for (const tab of state.session.openTabs) {
    if (!isFileTab(tab)) {
      continue;
    }
    const documentState = state.documents.find((doc) => doc.id === tab.documentId);
    if (documentState?.filePath) {
      paths.add(documentState.filePath);
    }
  }
  return [...paths];
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
  isAgentTabActive: boolean;
  workspaceLayout: WorkspaceLayoutState;
  consoleOpen: boolean;
}

export interface ResponsiveLayoutFlags {
  autoProjectPanelCollapsed: boolean;
  autoAgentsSidebarCollapsed: boolean;
  consoleOpen: boolean;
}

export function computeResponsiveLayoutFlags(
  input: ResponsiveLayoutInput,
): ResponsiveLayoutFlags {
  const agentTabLayout = input.isAgentTabActive && input.workspaceActive;
  const panelCollapseWidth = agentTabLayout
    ? RESPONSIVE_PANEL_COLLAPSE_WIDTH_AGENT
    : RESPONSIVE_PANEL_COLLAPSE_WIDTH;
  const agentsCollapseWidth = agentTabLayout
    ? RESPONSIVE_AGENTS_COLLAPSE_WIDTH_AGENT
    : RESPONSIVE_AGENTS_COLLAPSE_WIDTH;

  const autoProjectPanelCollapsed =
    input.shellMainRowWidth > 0 &&
    input.shellMainRowWidth < panelCollapseWidth &&
    input.workspaceActive;

  const autoAgentsSidebarCollapsed =
    input.shellMainRowWidth > 0 &&
    input.shellMainRowWidth < agentsCollapseWidth &&
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
    autoAgentsSidebarCollapsed,
    consoleOpen,
  };
}
