import type { WorkspaceLayoutState } from "../domain/contracts";

export const DEFAULT_PANEL_WIDTH_PX = 240;
export const MIN_PANEL_WIDTH_PX = 180;
export const MAX_PANEL_WIDTH_PX = 520;

/** Clamps panel width for resize and persisted workspace layout. */
export function normalizePanelWidthPx(value: unknown): number {
  const fallback = DEFAULT_PANEL_WIDTH_PX;
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(MIN_PANEL_WIDTH_PX, Math.min(MAX_PANEL_WIDTH_PX, parsed));
}

export function defaultWorkspaceLayout(): WorkspaceLayoutState {
  return {
    projectPanelWidthPx: DEFAULT_PANEL_WIDTH_PX,
    agentsSidebarWidthPx: DEFAULT_PANEL_WIDTH_PX,
    projectPanelCollapsed: false,
    agentsSidebarCollapsed: false,
  };
}

export function normalizeWorkspaceLayout(
  layout?: Partial<WorkspaceLayoutState> | null,
): WorkspaceLayoutState {
  const defaults = defaultWorkspaceLayout();
  if (!layout) {
    return defaults;
  }
  return {
    projectPanelWidthPx:
      layout.projectPanelWidthPx !== undefined
        ? normalizePanelWidthPx(layout.projectPanelWidthPx)
        : defaults.projectPanelWidthPx,
    agentsSidebarWidthPx:
      layout.agentsSidebarWidthPx !== undefined
        ? normalizePanelWidthPx(layout.agentsSidebarWidthPx)
        : defaults.agentsSidebarWidthPx,
    projectPanelCollapsed:
      typeof layout.projectPanelCollapsed === "boolean"
        ? layout.projectPanelCollapsed
        : defaults.projectPanelCollapsed,
    agentsSidebarCollapsed:
      typeof layout.agentsSidebarCollapsed === "boolean"
        ? layout.agentsSidebarCollapsed
        : defaults.agentsSidebarCollapsed,
  };
}
