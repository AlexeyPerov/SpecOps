import { describe, expect, it } from "vitest";
import { centerDialogPosition, clampDialogPosition } from "./settingsDialogGeometry";

describe("settingsDialogGeometry", () => {
  it("centers the dialog in the viewport", () => {
    expect(centerDialogPosition(400, 300, 1000, 800)).toEqual({
      left: 300,
      top: 250,
    });
  });

  it("clamps position when the dialog is dragged past viewport edges", () => {
    expect(clampDialogPosition(-100, -50, 400, 300, 1000, 800)).toEqual({
      left: 12,
      top: 12,
    });
    expect(clampDialogPosition(900, 700, 400, 300, 1000, 800)).toEqual({
      left: 588,
      top: 488,
    });
  });
});
