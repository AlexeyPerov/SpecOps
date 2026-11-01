import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { selectTabForNormalizedPath } from "./openFileGate";
import { getErrorMessage } from "../commands/commandErrors";
import { WINDOW_EVENT_ACTIVATE_FILE, WINDOW_EVENT_SELECT_TAB_FOR_PATH } from "./windowManager";

/** Addressed commands must not use Tauri's default, application-wide Any target. */
export async function listenForWindowFileCommands(
  windowId: string,
  deps: { openAndActivatePath: (path: string) => Promise<unknown>; notify: (message: string) => void },
): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];
  try {
    unlisteners.push(await listen<{ path: string }>(WINDOW_EVENT_ACTIVATE_FILE, async ({ payload }) => {
      try {
        await deps.openAndActivatePath(payload.path);
      } catch (error) {
        deps.notify(`Failed to open routed file: ${getErrorMessage(error)}`);
      }
    }, { target: windowId }));
    unlisteners.push(await listen<{ path: string }>(WINDOW_EVENT_SELECT_TAB_FOR_PATH, async ({ payload }) => {
      if (selectTabForNormalizedPath(payload.path)) return;
      // Recover an ownership claim whose tab was already closed.
      try {
        await deps.openAndActivatePath(payload.path);
      } catch (error) {
        deps.notify(`Failed to open routed file: ${getErrorMessage(error)}`);
      }
    }, { target: windowId }));
  } catch (error) {
    unlisteners.forEach(unlisten => unlisten());
    throw error;
  }
  return () => unlisteners.forEach(unlisten => unlisten());
}
