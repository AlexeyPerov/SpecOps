import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WindowBounds } from "../domain/contracts";

export async function readWindowBounds(window: WebviewWindow): Promise<WindowBounds> {
  const scaleFactor = await window.scaleFactor();
  const size = await window.innerSize();
  const position = await window.outerPosition();
  const maximized = await window.isMaximized();
  return {
    width: size.width / scaleFactor,
    height: size.height / scaleFactor,
    x: position.x / scaleFactor,
    y: position.y / scaleFactor,
    maximized,
  };
}

export async function applyWindowBounds(
  window: WebviewWindow,
  bounds: WindowBounds,
): Promise<void> {
  if (bounds.maximized) {
    await window.maximize();
    return;
  }
  if (await window.isMaximized()) {
    await window.unmaximize();
  }
  await window.setSize(new LogicalSize(bounds.width, bounds.height));
  await window.setPosition(new LogicalPosition(bounds.x, bounds.y));
}
