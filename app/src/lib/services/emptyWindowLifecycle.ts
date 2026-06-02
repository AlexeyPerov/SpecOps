import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppDomainState } from "../domain/contracts";
import { isFileTab } from "../domain/contracts";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import { isEmptyUnsavedDocument } from "./untitledDocument";

export function shouldCloseWindowAfterTabTransfer(snapshot: AppDomainState): boolean {
  const session = getActiveSession(snapshot);
  if (session.openTabs.length === 0) {
    return true;
  }
  if (session.openTabs.length !== 1) {
    return false;
  }
  const tab = session.openTabs[0];
  if (!isFileTab(tab)) {
    return false;
  }
  const document = getActiveDocuments(snapshot).find((entry) => entry.id === tab.documentId);
  return document ? isEmptyUnsavedDocument(document) : false;
}

export async function closeCurrentWindowIfEmptyAfterTransfer(
  snapshot: AppDomainState,
): Promise<boolean> {
  if (!shouldCloseWindowAfterTabTransfer(snapshot)) {
    return false;
  }
  const window = getCurrentWebviewWindow();
  await window.close();
  return true;
}
