import type { WorkspaceLayoutState } from "../domain/contracts";

export const DEFAULT_PANEL_WIDTH_PX = 240;
export const MIN_PANEL_WIDTH_PX = 180;
export const MAX_PANEL_WIDTH_PX = 520;

/**
 * Activity rail (workspaces sidebar) width bounds. The rail starts in the
 * compact 48px letter form and can be dragged out to the same max as the
 * project panel. Below the expanded threshold it renders compact letter
 * widgets; at/above it renders expanded info cards.
 */
export const DEFAULT_ACTIVITY_RAIL_WIDTH_PX = 48;
export const MIN_ACTIVITY_RAIL_WIDTH_PX = 48;
export const MAX_ACTIVITY_RAIL_WIDTH_PX = MAX_PANEL_WIDTH_PX;
export const ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX = Math.round(MAX_ACTIVITY_RAIL_WIDTH_PX / 2);

/** Clamps panel width for resize and persisted workspace layout. */
export function normalizePanelWidthPx(value: unknown): number {
  const fallback = DEFAULT_PANEL_WIDTH_PX;
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(MIN_PANEL_WIDTH_PX, Math.min(MAX_PANEL_WIDTH_PX, parsed));
}

/** Clamps the activity-rail width to its [MIN, MAX] bounds. */
export function normalizeActivityRailWidthPx(value: unknown): number {
  const fallback = DEFAULT_ACTIVITY_RAIL_WIDTH_PX;
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(MIN_ACTIVITY_RAIL_WIDTH_PX, Math.min(MAX_ACTIVITY_RAIL_WIDTH_PX, parsed));
}

/** True when the rail is wide enough to render expanded info cards. */
export function isActivityRailExpanded(width: number): boolean {
  return width >= ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX;
}

export function defaultWorkspaceLayout(): WorkspaceLayoutState {
  return {
    projectPanelWidthPx: DEFAULT_PANEL_WIDTH_PX,
    sessionsSidebarWidthPx: DEFAULT_PANEL_WIDTH_PX,
    projectPanelCollapsed: false,
    sessionsSidebarCollapsed: false,
    activityRailWidthPx: DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
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
    sessionsSidebarWidthPx:
      layout.sessionsSidebarWidthPx !== undefined
        ? normalizePanelWidthPx(layout.sessionsSidebarWidthPx)
        : defaults.sessionsSidebarWidthPx,
    projectPanelCollapsed:
      typeof layout.projectPanelCollapsed === "boolean"
        ? layout.projectPanelCollapsed
        : defaults.projectPanelCollapsed,
    sessionsSidebarCollapsed:
      typeof layout.sessionsSidebarCollapsed === "boolean"
        ? layout.sessionsSidebarCollapsed
        : defaults.sessionsSidebarCollapsed,
    activityRailWidthPx:
      layout.activityRailWidthPx !== undefined
        ? normalizeActivityRailWidthPx(layout.activityRailWidthPx)
        : defaults.activityRailWidthPx,
  };
}
