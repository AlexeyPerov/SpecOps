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
/** Target → source acknowledgment after adopting (or failing to adopt) a merged tab. */
export const WINDOW_EVENT_MERGE_TAB_ACK = "spec-ops/window/merge-tab-ack";
/**
 * App-quit coordination. The window that received Cmd+Q emits this to every
 * other live window; each runs its own unsaved-changes prompt + session flush
 * and replies with {@link WINDOW_EVENT_PREPARE_QUIT_ACK}. If any window reports
 * that the user cancelled (or fails to ack within the deadline), the quit is
 * aborted so secondary windows are not silently killed mid-edit.
 */
export const WINDOW_EVENT_PREPARE_QUIT = "spec-ops/window/prepare-quit";
export const WINDOW_EVENT_PREPARE_QUIT_ACK = "spec-ops/window/prepare-quit-ack";

export type MergeTabPayload = TabTransferPayload & {
  sourceWindowId: string;
  sourceTabId: string;
};

export type MergeTabAckPayload = {
  sourceTabId: string;
  ok: boolean;
  error?: string;
};

export type PrepareQuitAckPayload = {
  windowId: string;
  /** True when this window has no unsaved work or the user confirmed save/discard. */
  mayQuit: boolean;
};

export type TabTransferPayload = {
  filePath: string | null;
  content: string;
  title: string;
  /**
   * On-disk line ending of the source document. The editor always works in LF,
   * so this is what converts back on the first save in the target window.
   * Absent for legacy payloads (treated as LF by `buildDocument`).
   */
  lineEnding?: "lf" | "crlf";
  /** Whether the source document began with a UTF-8 BOM (restored on save). */
  hasBom?: boolean;
};

const WINDOW_READY_TIMEOUT_MS = 10_000;

/**
 * Mint a window label that is unique across the whole app, not just this
 * webview. A module-level counter cannot do that: each webview window is its
 * own JS realm with its own copy of the module, so "New Window" from window-2
 * would mint `window-2` again and the `WebviewWindow` constructor fails with
 * `tauri://error` (label already in use). Timestamp + random suffix cannot
 * collide across realms.
 */
export function generateWindowLabel(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `window-${Date.now().toString(36)}-${random}`;
}

export async function markWindowActive(
  windowId: string,
  options?: { skipBackup?: boolean },
): Promise<void> {
  await updateLastActiveWindow(windowId, options);
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
  const label = generateWindowLabel();
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
        // If the timeout already fired before registration completed, detach the
        // listener immediately so it does not leak for the process lifetime.
        if (settled) {
          void unlisten();
        } else {
          readyUnlisten = unlisten;
        }
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

/** Per-window ack deadline for the prepare-quit handshake. */
const PREPARE_QUIT_ACK_TIMEOUT_MS = 60_000;

/**
 * Ask every *other* live window to run its unsaved-changes prompt and session
 * flush, returning false if any window reports the user cancelled (or fails to
 * ack within the deadline).
 *
 * Cmd+Q calls `app_handle.exit(0)`, which fires `ExitRequested`/`Exit` but not
 * per-window `CloseRequested` — so without this, secondary windows get no prompt
 * and no awaited flush, only the fire-and-forget `pagehide` backstop (the exact
 * race the close flow was written to close). Each window's existing
 * `confirmWindowClose` runs locally (prompt + flush), so this only adds the
 * cross-window fan-out and ack collection.
 */
export async function prepareOtherWindowsForQuit(
  initiatorWindowId: string,
): Promise<boolean> {
  let otherWindows: WebviewWindow[] = [];
  try {
    otherWindows = (await WebviewWindow.getAll()).filter(
      (window) => window.label !== initiatorWindowId,
    );
  } catch {
    // No multi-window API available (single-window env / tests): nothing to
    // coordinate, the initiator's own confirm is the whole quit.
    return true;
  }
  if (otherWindows.length === 0) {
    return true;
  }

  const pending = new Set(otherWindows.map((window) => window.label));
  let cancelled = false;

  const ackUnlisten = await listen<PrepareQuitAckPayload>(
    WINDOW_EVENT_PREPARE_QUIT_ACK,
    (event) => {
      const { windowId, mayQuit } = event.payload;
      pending.delete(windowId);
      if (!mayQuit) {
        cancelled = true;
      }
    },
  );

  try {
    await Promise.all(
      otherWindows.map((window) =>
        emitTo(window.label, WINDOW_EVENT_PREPARE_QUIT, {
          initiatorWindowId,
        }).catch(() => {
          // A window that can't be reached is treated as consenting; its
          // pagehide backstop still runs on exit. Failing the whole quit
          // because one window's IPC dropped would trap the user.
          pending.delete(window.label);
        }),
      ),
    );

    const deadline = Date.now() + PREPARE_QUIT_ACK_TIMEOUT_MS;
    // Poll until every window has acked or the deadline lapses. The user may
    // be staring at a save prompt in another window, so a tight loop with a
    // short sleep keeps latency low without busy-spinning.
    while (pending.size > 0 && Date.now() < deadline && !cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // A timed-out window is assumed to still be running its prompt (or stuck);
    // we do not force-quit past it. The user can re-issue Cmd+Q.
    return !cancelled && pending.size === 0;
  } finally {
    ackUnlisten();
  }
}
