import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { allTabs } from "../domain/contracts";
import { appState } from "../state/appState";
import { confirmDirtyTabBeforeTransfer } from "./closeTabFlow";
import { closeCurrentWindowIfEmptyAfterTransfer } from "./emptyWindowLifecycle";
import { syncOpenFileRegistryForWindow } from "./openFileRegistry";
import {
  createNewWindowWithTransfer,
  WINDOW_EVENT_MERGE_TAB,
  WINDOW_EVENT_MERGE_TAB_ACK,
  type MergeTabAckPayload,
  type MergeTabPayload,
} from "./windowManager";
import { findWebviewWindowAtScreenPoint, focusWebviewWindow } from "./windowTargeting";

/** How long the source window waits for the target to acknowledge MERGE_TAB. */
export const MERGE_TAB_ACK_TIMEOUT_MS = 10_000;

const FAILED_TRANSFER_MESSAGE = "Failed to move tab to the target window.";
const TIMEOUT_TRANSFER_MESSAGE =
  "Timed out waiting for the target window. The tab was kept in this window.";

type MoveTabInput = {
  tabId: string;
  sourceWindowId: string;
  screenX: number;
  screenY: number;
  notify: (message: string) => void;
};

async function finalizeSourceAfterTransfer(
  tabId: string,
  sourceWindowId: string,
  notify: (message: string) => void,
): Promise<void> {
  appState.removeTransferredTab(tabId);
  await syncOpenFileRegistryForWindow(sourceWindowId, appState.getSnapshot());
  const closed = await closeCurrentWindowIfEmptyAfterTransfer(appState.getSnapshot());
  if (closed) {
    notify("Closed empty window.");
  }
}

/**
 * Emit MERGE_TAB to the target and wait for MERGE_TAB_ACK before removing the
 * source tab. On timeout/error the source tab is left in place.
 */
export async function requestMergeTabAck(
  targetWindowId: string,
  payload: MergeTabPayload,
  timeoutMs: number = MERGE_TAB_ACK_TIMEOUT_MS,
): Promise<MergeTabAckPayload> {
  return new Promise((resolve) => {
    let settled = false;
    let unlisten: UnlistenFn | null = null;
    const timeoutId = setTimeout(() => {
      finish({
        sourceTabId: payload.sourceTabId,
        ok: false,
        error: TIMEOUT_TRANSFER_MESSAGE,
      });
    }, timeoutMs);

    function finish(result: MergeTabAckPayload): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      void unlisten?.();
      resolve(result);
    }

    void listen<MergeTabAckPayload>(WINDOW_EVENT_MERGE_TAB_ACK, (event) => {
      if (event.payload.sourceTabId !== payload.sourceTabId) {
        return;
      }
      finish(event.payload);
    })
      .then(async (fn) => {
        unlisten = fn;
        try {
          await emitTo<MergeTabPayload>(targetWindowId, WINDOW_EVENT_MERGE_TAB, payload);
        } catch {
          finish({
            sourceTabId: payload.sourceTabId,
            ok: false,
            error: FAILED_TRANSFER_MESSAGE,
          });
        }
      })
      .catch(() => {
        finish({
          sourceTabId: payload.sourceTabId,
          ok: false,
          error: FAILED_TRANSFER_MESSAGE,
        });
      });
  });
}

export async function moveTabToExistingWindow({
  tabId,
  sourceWindowId,
  targetWindowId,
  notify,
}: {
  tabId: string;
  sourceWindowId: string;
  targetWindowId: string;
  notify: (message: string) => void;
}): Promise<boolean> {
  if (targetWindowId === sourceWindowId) {
    return false;
  }

  const tab = allTabs(appState.getActiveSession().editorLayout).find((entry) => entry.id === tabId);
  if (!tab) {
    notify("No active tab to transfer.");
    return false;
  }

  const mayTransfer = await confirmDirtyTabBeforeTransfer(tab, {
    getWindowId: () => sourceWindowId,
    notify,
  });
  if (!mayTransfer) {
    return false;
  }

  const payload = appState.buildTabTransferPayload(tabId);
  if (!payload) {
    notify("No active tab to transfer.");
    return false;
  }

  const ack = await requestMergeTabAck(targetWindowId, {
    ...payload,
    sourceWindowId,
    sourceTabId: tabId,
  });

  if (!ack.ok) {
    notify(ack.error ?? FAILED_TRANSFER_MESSAGE);
    return false;
  }

  await finalizeSourceAfterTransfer(tabId, sourceWindowId, notify);
  await focusWebviewWindow(targetWindowId);
  return true;
}

export async function moveTabFromDrag({
  tabId,
  sourceWindowId,
  screenX,
  screenY,
  notify,
}: MoveTabInput): Promise<boolean> {
  const targetWindowId = await findWebviewWindowAtScreenPoint(
    screenX,
    screenY,
    sourceWindowId,
  );
  if (targetWindowId) {
    const merged = await moveTabToExistingWindow({
      tabId,
      sourceWindowId,
      targetWindowId,
      notify,
    });
    if (merged) {
      notify("Moved tab to window.");
    }
    return merged;
  }

  return moveTabToNewWindow({ tabId, sourceWindowId, notify });
}

export async function moveTabToNewWindow({
  tabId,
  sourceWindowId,
  notify,
}: {
  tabId: string;
  sourceWindowId: string;
  notify: (message: string) => void;
}): Promise<boolean> {
  if (!appState.isNotepadActive()) {
    notify("Move to new window is only available for Notepad tabs.");
    return false;
  }

  const snapshot = appState.getSnapshot();
  const tab = allTabs(appState.getActiveSession().editorLayout).find((entry) => entry.id === tabId);
  if (!tab) {
    notify("No active tab to transfer.");
    return false;
  }

  const mayTransfer = await confirmDirtyTabBeforeTransfer(tab, {
    getWindowId: () => sourceWindowId,
    notify,
  });
  if (!mayTransfer) {
    return false;
  }

  const payload = appState.buildTabTransferPayload(tabId);
  if (!payload) {
    notify("No active tab to transfer.");
    return false;
  }

  const createdWindowId = await createNewWindowWithTransfer(snapshot, payload);
  if (!createdWindowId) {
    notify("Failed to open new window.");
    return false;
  }

  await finalizeSourceAfterTransfer(tabId, sourceWindowId, notify);
  return true;
}
