import { chatStore } from "../state/chatStore";

/** Conservative interval while an agent tab is active to detect workspace root loss. */
export const CHAT_ACCESS_POLL_INTERVAL_MS = 15_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastMonitorActive: boolean | null = null;
let visibilityUnlisten: (() => void) | null = null;

/**
 * P03-08-29(c): the access preflight hits the (possibly remote) AI backend.
 * While the window is hidden/backgrounded there is no point polling — the user
 * cannot act on an access change they cannot see, and the poll keeps the chat
 * emit fan-out alive on an idle timer. Pause on `visibilitychange` and resume
 * (with an immediate refresh) when the window comes back.
 */
function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

function runAccessPreflightIfVisible(): void {
  if (isDocumentHidden()) {
    return;
  }
  void chatStore.runAccessPreflight();
}

function bindVisibilityListener(): void {
  if (typeof document === "undefined" || visibilityUnlisten) {
    return;
  }
  const handler = (): void => {
    if (!document.hidden && pollTimer) {
      // Refresh immediately on refocus so a stale access state does not linger
      // until the next 15 s tick.
      runAccessPreflightIfVisible();
    }
  };
  document.addEventListener("visibilitychange", handler);
  visibilityUnlisten = () => document.removeEventListener("visibilitychange", handler);
}

export function syncChatAccessMonitor(active: boolean): void {
  if (lastMonitorActive === active) {
    return;
  }
  lastMonitorActive = active;
  stopChatAccessMonitor();
  if (!active) {
    return;
  }
  bindVisibilityListener();
  pollTimer = setInterval(() => {
    runAccessPreflightIfVisible();
  }, CHAT_ACCESS_POLL_INTERVAL_MS);
}

export function stopChatAccessMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (visibilityUnlisten) {
    visibilityUnlisten();
    visibilityUnlisten = null;
  }
  lastMonitorActive = null;
}
