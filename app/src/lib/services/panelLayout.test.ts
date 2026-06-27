import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
  DEFAULT_PANEL_WIDTH_PX,
  DEFAULT_PROJECT_PANEL_WIDTH_PX,
  MAX_ACTIVITY_RAIL_WIDTH_PX,
  MAX_PANEL_WIDTH_PX,
  MIN_ACTIVITY_RAIL_WIDTH_PX,
  MIN_PANEL_WIDTH_PX,
  ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX,
  isActivityRailExpanded,
  normalizeActivityRailWidthPx,
  normalizePanelWidthPx,
  normalizeWorkspaceLayout,
} from "./panelLayout";

describe("panelLayout", () => {
  it("clamps panel width to supported bounds", () => {
    expect(normalizePanelWidthPx(100)).toBe(MIN_PANEL_WIDTH_PX);
    expect(normalizePanelWidthPx(999)).toBe(MAX_PANEL_WIDTH_PX);
    expect(normalizePanelWidthPx(DEFAULT_PANEL_WIDTH_PX)).toBe(DEFAULT_PANEL_WIDTH_PX);
  });

  it("clamps the activity-rail width to supported bounds", () => {
    expect(normalizeActivityRailWidthPx(1)).toBe(MIN_ACTIVITY_RAIL_WIDTH_PX);
    expect(normalizeActivityRailWidthPx(999)).toBe(MAX_ACTIVITY_RAIL_WIDTH_PX);
    expect(normalizeActivityRailWidthPx(DEFAULT_ACTIVITY_RAIL_WIDTH_PX)).toBe(
      DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
    );
  });

  it("treats the activity rail as expanded at/above ~20% of max", () => {
    expect(isActivityRailExpanded(DEFAULT_ACTIVITY_RAIL_WIDTH_PX)).toBe(false);
    expect(isActivityRailExpanded(ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX)).toBe(true);
    expect(isActivityRailExpanded(ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX - 1)).toBe(false);
  });

  it("returns defaults when layout is missing", () => {
    expect(normalizeWorkspaceLayout()).toEqual({
      projectPanelWidthPx: DEFAULT_PROJECT_PANEL_WIDTH_PX,
      sessionsSidebarWidthPx: DEFAULT_PANEL_WIDTH_PX,
      projectPanelCollapsed: false,
      sessionsSidebarCollapsed: false,
    });
  });

  it("normalizes partial layout values", () => {
    expect(
      normalizeWorkspaceLayout({
        projectPanelWidthPx: 500,
        sessionsSidebarCollapsed: true,
      }),
    ).toEqual({
      projectPanelWidthPx: 500,
      sessionsSidebarWidthPx: DEFAULT_PANEL_WIDTH_PX,
      projectPanelCollapsed: false,
      sessionsSidebarCollapsed: true,
    });
  });
});
