import { appState } from "../state/appState";
import { syncOpenFileRegistryForWindow } from "./openFileRegistry";
import { createNewWindowWithTransfer } from "./windowManager";

type MoveTabToNewWindowInput = {
  tabId: string;
  sourceWindowId: string;
  notify: (message: string) => void;
};

export async function moveTabToNewWindow({
  tabId,
  sourceWindowId,
  notify,
}: MoveTabToNewWindowInput): Promise<boolean> {
  if (!appState.isNotepadActive()) {
    notify("Move to new window is only available for Notepad tabs.");
    return false;
  }

  const payload = appState.buildTabTransferPayload(tabId);
  if (!payload) {
    notify("No active tab to transfer.");
    return false;
  }

  const createdWindowId = await createNewWindowWithTransfer(
    appState.getSnapshot(),
    payload,
  );
  if (!createdWindowId) {
    notify("Failed to open new window.");
    return false;
  }

  appState.removeTransferredTab(tabId);
  await syncOpenFileRegistryForWindow(sourceWindowId, appState.getSnapshot());
  return true;
}
