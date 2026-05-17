import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppDomainState } from "../domain/contracts";
import { getLastActiveWindowId, updateLastActiveWindow } from "./sessionManager";

export const WINDOW_EVENT_ACTIVATE_FILE = "spec-ops/window/activate-file";
export const WINDOW_EVENT_TRANSFER_TAB = "spec-ops/window/transfer-tab";

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

export async function createNewWindowWithTransfer(
  snapshot: AppDomainState,
  transferPayload?: { filePath: string | null; content: string; title: string } | null,
): Promise<void> {
  windowCounter += 1;
  const label = `window-${windowCounter}`;
  const windowRef = new WebviewWindow(label, {
    title: "spec-ops",
    width: 1000,
    height: 720,
    url: "/",
  });

  windowRef.once("tauri://created", async () => {
    await updateLastActiveWindow(label);
    if (transferPayload) {
      await emitTo(label, WINDOW_EVENT_TRANSFER_TAB, transferPayload);
    } else if (snapshot.session.selectedTabId) {
      const selected = snapshot.session.openTabs.find(
        (tab) => tab.id === snapshot.session.selectedTabId,
      );
      const doc = snapshot.documents.find(
        (documentState) => documentState.id === selected?.documentId,
      );
      if (doc) {
        await emitTo(label, WINDOW_EVENT_TRANSFER_TAB, {
          filePath: doc.filePath,
          content: doc.content,
          title: doc.title,
        });
      }
    }
  });
}

export async function routePathToLastActiveWindow(path: string): Promise<void> {
  const target = await resolveActivationWindow(null);
  await activateFileInWindow(path, target);
}
