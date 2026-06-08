import { describe, expect, it } from "vitest";
import {
  clampDialogSize,
  centerDialogInViewport,
  SETTINGS_DIALOG_WIDTH_SCALE,
  syncDialogBoundsToViewport,
} from "./settingsDialogChrome";

describe("settingsDialogChrome", () => {
  describe("clampDialogSize", () => {
    it("clamps to viewport fraction and enforces minimum initial size", () => {
      const result = clampDialogSize(2000, 2000, 560, 640, 1000, 800);
      expect(result.width).toBe(960);
      expect(result.height).toBe(768);
    });

    it("does not shrink below initial size", () => {
      const result = clampDialogSize(400, 500, 560, 640, 1000, 800);
      expect(result.width).toBe(560);
      expect(result.height).toBe(640);
    });
  });

  describe("centerDialogInViewport", () => {
    it("centers dialog within viewport margins", () => {
      const result = centerDialogInViewport(560, 640, 1200, 900);
      expect(result.left).toBe(320);
      expect(result.top).toBe(130);
    });
  });

  it("applies width scale for wider default dialog", () => {
    expect(SETTINGS_DIALOG_WIDTH_SCALE).toBe(1.5);
  });

  describe("syncDialogBoundsToViewport", () => {
    it("clamps oversized dialog to viewport and keeps position in bounds", () => {
      const result = syncDialogBoundsToViewport(
        { dialogWidthPx: 900, dialogHeightPx: 850, dialogLeftPx: 100, dialogTopPx: 50 },
        560,
        640,
        800,
        600,
      );
      expect(result.dialogWidthPx).toBe(768);
      expect(result.dialogHeightPx).toBe(640);
      expect(result.dialogLeftPx).toBeGreaterThanOrEqual(12);
      expect(result.dialogTopPx).toBeGreaterThanOrEqual(12);
    });
  });
});
