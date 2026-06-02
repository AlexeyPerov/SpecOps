import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { findWebviewWindowAtScreenPoint } from "./windowTargeting";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
  WebviewWindow: {
    getAll: vi.fn(),
    getByLabel: vi.fn(),
  },
}));

const getAllMock = vi.mocked(WebviewWindow.getAll);

function mockWindow(
  label: string,
  bounds: { left: number; top: number; width: number; height: number; scale?: number },
) {
  const scale = bounds.scale ?? 1;
  return {
    label,
    outerPosition: vi.fn().mockResolvedValue({ x: bounds.left * scale, y: bounds.top * scale }),
    innerSize: vi.fn().mockResolvedValue({ width: bounds.width * scale, height: bounds.height * scale }),
    scaleFactor: vi.fn().mockResolvedValue(scale),
    show: vi.fn(),
    setFocus: vi.fn(),
  } as unknown as WebviewWindow;
}

describe("findWebviewWindowAtScreenPoint", () => {
  beforeEach(() => {
    getAllMock.mockReset();
  });

  it("returns the smallest window containing the point", async () => {
    getAllMock.mockResolvedValue([
      mockWindow("main", { left: 0, top: 0, width: 1200, height: 800 }),
      mockWindow("window-2", { left: 100, top: 100, width: 400, height: 300 }),
    ]);

    await expect(findWebviewWindowAtScreenPoint(200, 200, "main")).resolves.toBe("window-2");
  });

  it("returns null when the point is outside other windows", async () => {
    getAllMock.mockResolvedValue([
      mockWindow("main", { left: 0, top: 0, width: 200, height: 200 }),
    ]);

    await expect(findWebviewWindowAtScreenPoint(500, 500, "main")).resolves.toBeNull();
  });
});
