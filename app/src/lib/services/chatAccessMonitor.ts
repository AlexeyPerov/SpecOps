import { chatStore } from "../state/chatStore";

/** Conservative interval while Chat tab is active to detect workspace root loss. */
export const CHAT_ACCESS_POLL_INTERVAL_MS = 15_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function syncChatAccessMonitor(active: boolean): void {
  stopChatAccessMonitor();
  if (!active) {
    return;
  }
  pollTimer = setInterval(() => {
    void chatStore.runAccessPreflight();
  }, CHAT_ACCESS_POLL_INTERVAL_MS);
}

export function stopChatAccessMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
