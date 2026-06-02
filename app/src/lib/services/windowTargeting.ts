import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { markWindowActive } from "./windowManager";

export async function findWebviewWindowAtScreenPoint(
  screenX: number,
  screenY: number,
  excludeLabel: string,
): Promise<string | null> {
  const windows = await WebviewWindow.getAll();
  let match: string | null = null;
  let topArea = Number.POSITIVE_INFINITY;

  for (const window of windows) {
    if (window.label === excludeLabel) {
      continue;
    }
    const [position, size, scaleFactor] = await Promise.all([
      window.outerPosition(),
      window.innerSize(),
      window.scaleFactor(),
    ]);
    const left = position.x / scaleFactor;
    const top = position.y / scaleFactor;
    const right = left + size.width / scaleFactor;
    const bottom = top + size.height / scaleFactor;

    if (screenX < left || screenX > right || screenY < top || screenY > bottom) {
      continue;
    }

    const area = (right - left) * (bottom - top);
    if (area < topArea) {
      topArea = area;
      match = window.label;
    }
  }

  return match;
}

export async function focusWebviewWindow(label: string): Promise<void> {
  const window = await WebviewWindow.getByLabel(label);
  if (!window) {
    return;
  }
  await window.show();
  await window.setFocus();
  await markWindowActive(label);
}

export function getCurrentWebviewLabel(): string {
  return getCurrentWebviewWindow().label;
}
