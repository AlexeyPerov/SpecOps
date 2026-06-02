import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import type { AppDomainState, WindowBounds } from "../domain/contracts";
import { getActiveSession } from "../state/appState/contextHelpers";
import { applyWindowBounds, readWindowBounds } from "./windowBounds";
import { getLastActiveWindowId, updateLastActiveWindow } from "./sessionManager";

export const WINDOW_EVENT_ACTIVATE_FILE = "spec-ops/window/activate-file";
export const WINDOW_EVENT_TRANSFER_TAB = "spec-ops/window/transfer-tab";
export const WINDOW_EVENT_SELECT_TAB_FOR_PATH = "spec-ops/window/select-tab-for-path";
export const WINDOW_EVENT_WINDOW_READY = "spec-ops/window/ready";
export const WINDOW_EVENT_MERGE_TAB = "spec-ops/window/merge-tab";

export type MergeTabPayload = TabTransferPayload & {
  sourceWindowId: string;
  sourceTabId: string;
};

export type TabTransferPayload = {
  filePath: string | null;
  content: string;
  title: string;
};

const WINDOW_READY_TIMEOUT_MS = 10_000;

let windowCounter = 1;

export async function markWindowActive(windowId: string): Promise<void> {
  await updateLastActiveWindow(windowId);
}

export async function resolveActivationWindow(
  explicitWindowId: string | null,
): Promise<string> {
  if (explicitWindowId) {
    return explicitWindowId;
  }
  const lastActive = await getLastActiveWindowId();
  return lastActive ?? "main";
}

export async function activateFileInWindow(
  path: string,
  targetWindowId: string | null = null,
): Promise<void> {
  const windowId = await resolveActivationWindow(targetWindowId);
  await emitTo(windowId, WINDOW_EVENT_ACTIVATE_FILE, { path });
}

const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  width: 800,
  height: 1020,
  x: 0,
  y: 0,
  maximized: false,
};

function cascadeWindowBounds(bounds: WindowBounds): WindowBounds {
  if (bounds.maximized) {
    return bounds;
  }
  return {
    ...bounds,
    x: bounds.x + 24,
    y: bounds.y + 24,
  };
}

export async function resolveNewWindowBounds(snapshot: AppDomainState): Promise<WindowBounds> {
  try {
    const parent = getCurrentWebviewWindow();
    return cascadeWindowBounds(await readWindowBounds(parent));
  } catch {
    const persisted = getActiveSession(snapshot).windowBounds;
    if (persisted) {
      return cascadeWindowBounds(persisted);
    }
    return { ...DEFAULT_WINDOW_BOUNDS };
  }
}

export async function createNewWindowWithTransfer(
  snapshot: AppDomainState,
  transferPayload?: TabTransferPayload | null,
): Promise<string | null> {
  windowCounter += 1;
  const label = `window-${windowCounter}`;
  const bounds = await resolveNewWindowBounds(snapshot);

  return new Promise((resolve) => {
    let settled = false;
    let readyUnlisten: UnlistenFn | null = null;
    let readyTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (readyTimeoutId !== null) {
        clearTimeout(readyTimeoutId);
      }
      void readyUnlisten?.();
      resolve(result);
    };

    if (transferPayload) {
      void listen<{ windowId: string }>(WINDOW_EVENT_WINDOW_READY, async (event) => {
        if (event.payload.windowId !== label) {
          return;
        }
        try {
          await emitTo(label, WINDOW_EVENT_TRANSFER_TAB, transferPayload);
          finish(label);
        } catch {
          finish(null);
        }
      }).then((unlisten) => {
        readyUnlisten = unlisten;
      });

      readyTimeoutId = setTimeout(() => finish(null), WINDOW_READY_TIMEOUT_MS);
    }

    const windowRef = new WebviewWindow(label, {
      title: "SpecOps",
      url: "/",
    });

    windowRef.once("tauri://error", () => {
      finish(null);
    });

    windowRef.once("tauri://created", async () => {
      try {
        await applyWindowBounds(windowRef, bounds);
        await updateLastActiveWindow(label);
        await windowRef.show();
        await windowRef.setFocus();
        if (!transferPayload) {
          finish(label);
        }
      } catch {
        finish(null);
      }
    });
  });
}

export async function routePathToLastActiveWindow(path: string): Promise<void> {
  const target = await resolveActivationWindow(null);
  await activateFileInWindow(path, target);
}
