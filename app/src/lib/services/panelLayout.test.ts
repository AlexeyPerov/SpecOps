import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_WIDTH_PX,
  MAX_PANEL_WIDTH_PX,
  MIN_PANEL_WIDTH_PX,
  normalizePanelWidthPx,
  normalizeWorkspaceLayout,
} from "./panelLayout";

describe("panelLayout", () => {
  it("clamps panel width to supported bounds", () => {
    expect(normalizePanelWidthPx(100)).toBe(MIN_PANEL_WIDTH_PX);
    expect(normalizePanelWidthPx(999)).toBe(MAX_PANEL_WIDTH_PX);
    expect(normalizePanelWidthPx(DEFAULT_PANEL_WIDTH_PX)).toBe(DEFAULT_PANEL_WIDTH_PX);
  });

  it("returns defaults when layout is missing", () => {
    expect(normalizeWorkspaceLayout()).toEqual({
      projectPanelWidthPx: DEFAULT_PANEL_WIDTH_PX,
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
