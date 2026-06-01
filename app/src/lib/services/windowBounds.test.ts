import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyWindowBounds, readWindowBounds } from "./windowBounds";

function createMockWindow(
  overrides: Partial<{
    scaleFactor: number;
    innerSize: { width: number; height: number };
    outerPosition: { x: number; y: number };
    maximized: boolean;
  }> = {},
): WebviewWindow {
  const scaleFactor = overrides.scaleFactor ?? 2;
  const innerSize = overrides.innerSize ?? { width: 1920, height: 1080 };
  const outerPosition = overrides.outerPosition ?? { x: 200, y: 100 };
  const maximized = overrides.maximized ?? false;

  return {
    scaleFactor: vi.fn().mockResolvedValue(scaleFactor),
    innerSize: vi.fn().mockResolvedValue(innerSize),
    outerPosition: vi.fn().mockResolvedValue(outerPosition),
    isMaximized: vi.fn().mockResolvedValue(maximized),
    maximize: vi.fn().mockResolvedValue(undefined),
    unmaximize: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebviewWindow;
}

describe("readWindowBounds", () => {
  it("divides pixel values by scale factor", async () => {
    const window = createMockWindow({ scaleFactor: 2 });

    const bounds = await readWindowBounds(window);

    expect(bounds).toEqual({
      width: 960,
      height: 540,
      x: 100,
      y: 50,
      maximized: false,
    });
  });

  it("passes through maximized flag", async () => {
    const window = createMockWindow({ maximized: true });

    const bounds = await readWindowBounds(window);

    expect(bounds.maximized).toBe(true);
  });
});

describe("applyWindowBounds", () => {
  let window: WebviewWindow;

  beforeEach(() => {
    window = createMockWindow();
  });

  it("calls maximize only when bounds are maximized", async () => {
    await applyWindowBounds(window, {
      width: 800,
      height: 600,
      x: 10,
      y: 20,
      maximized: true,
    });

    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.setSize).not.toHaveBeenCalled();
    expect(window.setPosition).not.toHaveBeenCalled();
    expect(window.unmaximize).not.toHaveBeenCalled();
  });

  it("unmaximizes then sets size and position with logical units", async () => {
    vi.mocked(window.isMaximized).mockResolvedValue(true);

    await applyWindowBounds(window, {
      width: 800,
      height: 600,
      x: 10,
      y: 20,
      maximized: false,
    });

    expect(window.unmaximize).toHaveBeenCalledOnce();
    expect(window.setSize).toHaveBeenCalledWith(new LogicalSize(800, 600));
    expect(window.setPosition).toHaveBeenCalledWith(new LogicalPosition(10, 20));
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it("sets size and position without unmaximize when window is not maximized", async () => {
    vi.mocked(window.isMaximized).mockResolvedValue(false);

    await applyWindowBounds(window, {
      width: 800,
      height: 600,
      x: 10,
      y: 20,
      maximized: false,
    });

    expect(window.unmaximize).not.toHaveBeenCalled();
    expect(window.setSize).toHaveBeenCalledWith(new LogicalSize(800, 600));
    expect(window.setPosition).toHaveBeenCalledWith(new LogicalPosition(10, 20));
    expect(window.maximize).not.toHaveBeenCalled();
  });
});
