import { emitTo } from "@tauri-apps/api/event";
import { allTabs } from "../domain/contracts";
import { appState } from "../state/appState";
import { confirmDirtyTabBeforeTransfer } from "./closeTabFlow";
import { closeCurrentWindowIfEmptyAfterTransfer } from "./emptyWindowLifecycle";
import { syncOpenFileRegistryForWindow } from "./openFileRegistry";
import {
  createNewWindowWithTransfer,
  WINDOW_EVENT_MERGE_TAB,
  type MergeTabPayload,
} from "./windowManager";
import { findWebviewWindowAtScreenPoint, focusWebviewWindow } from "./windowTargeting";

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

  try {
    await emitTo<MergeTabPayload>(targetWindowId, WINDOW_EVENT_MERGE_TAB, {
      ...payload,
      sourceWindowId,
      sourceTabId: tabId,
    });
  } catch {
    notify("Failed to move tab to the target window.");
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
