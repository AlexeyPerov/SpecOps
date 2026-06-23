import type {
  NotificationEventId,
  OsNotificationSettings,
} from "../domain/contracts";

export interface OsNotificationPayload {
  title: string;
  body: string;
}

const EVENT_DEFAULT_COPY: Record<NotificationEventId, OsNotificationPayload> = {
  agentDone: { title: "Session finished", body: "The session completed its run." },
  permission: {
    title: "Permission requested",
    body: "The session is waiting for your approval.",
  },
  question: {
    title: "Question asked",
    body: "The session needs an answer to continue.",
  },
  error: { title: "Session error", body: "The session run failed." },
};

export function defaultCopyForEvent(
  event: NotificationEventId,
): OsNotificationPayload {
  return EVENT_DEFAULT_COPY[event];
}

/**
 * Window-focus gate. OS notifications should only fire when the SpecOps window
 * is NOT focused so the user is alerted when they've switched away. Override
 * point for tests.
 */
export function isWindowFocused(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return !document.hidden;
}

let permissionRequestor: () => Promise<NotificationPermission> = async () =>
  typeof Notification !== "undefined" ? Notification.permission : "denied";
let notificationFactory: (
  title: string,
  options?: NotificationOptions,
) => { close: () => void } | null = (title, options) =>
  typeof Notification !== "undefined" ? new Notification(title, options) : null;

/** Test seams. Pass `undefined` to each to restore defaults. */
export function setOsNotificationImplementationsForTests(input: {
  permissionRequestor?: () => Promise<NotificationPermission>;
  notificationFactory?: (
    title: string,
    options?: NotificationOptions,
  ) => { close: () => void } | null;
}): void {
  if (input.permissionRequestor) {
    permissionRequestor = input.permissionRequestor;
  }
  if (input.notificationFactory) {
    notificationFactory = input.notificationFactory;
  }
}

export function resetOsNotificationImplementationsForTests(): void {
  permissionRequestor = async () =>
    typeof Notification !== "undefined" ? Notification.permission : "denied";
  notificationFactory = (title, options) =>
    typeof Notification !== "undefined" ? new Notification(title, options) : null;
}

/**
 * Fires an OS notification for `event` unless: the master toggle is off, the
 * per-event toggle is off, or the window is currently focused (no need to
 * interrupt). Requests permission on first use. No-ops in environments without
 * the Notification API.
 */
export async function notifyOs(
  event: NotificationEventId,
  settings: OsNotificationSettings,
  payloadOverride?: Partial<OsNotificationPayload>,
): Promise<void> {
  if (!settings.enabled || !settings.events[event]) {
    return;
  }
  // Only notify when the user isn't already looking at the app.
  if (isWindowFocused()) {
    return;
  }
  if (typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission === "denied") {
    return;
  }
  if (Notification.permission !== "granted") {
    try {
      const permission = await permissionRequestor();
      if (permission !== "granted") {
        return;
      }
    } catch {
      return;
    }
  }
  const copy = { ...defaultCopyForEvent(event), ...payloadOverride };
  try {
    notificationFactory(copy.title, { body: copy.body });
  } catch {
    /* some webviews throw when notifications are disabled at the OS level */
  }
}
