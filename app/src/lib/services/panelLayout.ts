import type { WorkspaceLayoutState } from "../domain/contracts";

export const DEFAULT_PANEL_WIDTH_PX = 240;
export const MIN_PANEL_WIDTH_PX = 180;
export const MAX_PANEL_WIDTH_PX = 520;

/**
 * Default project panel width. Slightly wider than the sessions sidebar so the
 * file/folder tree has more room on fresh installs (~15% over the sidebar
 * default). Independent of {@link DEFAULT_PANEL_WIDTH_PX} so the sidebar can
 * keep its own default.
 */
export const DEFAULT_PROJECT_PANEL_WIDTH_PX = Math.round(DEFAULT_PANEL_WIDTH_PX * 1.15);

/**
 * Activity rail (workspaces sidebar) width bounds. The rail starts in the
 * compact 48px letter form and can be dragged out to the same max as the
 * project panel. Below the expanded threshold it renders compact letter
 * widgets; at/above it renders expanded info cards.
 */
export const DEFAULT_ACTIVITY_RAIL_WIDTH_PX = 48;
export const MIN_ACTIVITY_RAIL_WIDTH_PX = 48;
export const MAX_ACTIVITY_RAIL_WIDTH_PX = MAX_PANEL_WIDTH_PX;
/**
 * The rail switches from the compact letter form to expanded info cards at
 * ~20% of its max width. Kept deliberately low so the expanded state appears
 * early as the user drags the rail out.
 */
export const ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX = Math.round(MAX_ACTIVITY_RAIL_WIDTH_PX * 0.2);

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
    projectPanelWidthPx: DEFAULT_PROJECT_PANEL_WIDTH_PX,
    sessionsSidebarWidthPx: DEFAULT_PANEL_WIDTH_PX,
    projectPanelCollapsed: false,
    sessionsSidebarCollapsed: false,
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
  };
}
