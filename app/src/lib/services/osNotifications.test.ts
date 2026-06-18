import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOsNotificationSettings } from "./notificationSettings";
import {
  defaultCopyForEvent,
  isWindowFocused,
  notifyOs,
  resetOsNotificationImplementationsForTests,
  setOsNotificationImplementationsForTests,
} from "./osNotifications";

afterEach(() => {
  resetOsNotificationImplementationsForTests();
});

describe("defaultCopyForEvent", () => {
  it("returns a title and body for every event", () => {
    for (const eventId of ["agentDone", "permission", "question", "error"] as const) {
      const copy = defaultCopyForEvent(eventId);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });
});

describe("isWindowFocused", () => {
  it("returns true when document is visible", () => {
    expect(isWindowFocused()).toBe(!document.hidden);
  });
});

describe("notifyOs", () => {
  let createdNotifications: Array<{ title: string; body: string }>;
  let granted = true;
  type NotificationCtor = typeof Notification;
  let originalNotification: NotificationCtor | undefined;

  beforeEach(() => {
    createdNotifications = [];
    granted = true;
    // jsdom does not ship a Notification constructor; install a minimal stub so
    // the `typeof Notification` guard inside notifyOs passes.
    originalNotification = (globalThis as { Notification?: NotificationCtor })
      .Notification;
    class NotificationStub {
      static permission: NotificationPermission = "default";
      constructor(public title: string, public options?: NotificationOptions) {}
      close() {}
    }
    (globalThis as { Notification?: NotificationCtor }).Notification =
      NotificationStub as unknown as NotificationCtor;
    setOsNotificationImplementationsForTests({
      permissionRequestor: async () => (granted ? "granted" : "denied"),
      notificationFactory: (title, options) => {
        createdNotifications.push({
          title,
          body: options?.body ?? "",
        });
        return { close: vi.fn() };
      },
    });
  });

  afterEach(() => {
    if (originalNotification) {
      (globalThis as { Notification?: NotificationCtor }).Notification =
        originalNotification;
    } else {
      delete (globalThis as { Notification?: NotificationCtor }).Notification;
    }
  });

  it("no-ops when the master toggle is off", async () => {
    await notifyOs(
      "agentDone",
      { ...defaultOsNotificationSettings, enabled: false },
    );
    expect(createdNotifications).toHaveLength(0);
  });

  it("no-ops when the per-event toggle is off", async () => {
    await notifyOs("permission", {
      ...defaultOsNotificationSettings,
      events: { ...defaultOsNotificationSettings.events, permission: false },
    });
    expect(createdNotifications).toHaveLength(0);
  });

  it("no-ops when the window is focused", async () => {
    // jsdom defaults to document.hidden === false (focused).
    expect(document.hidden).toBe(false);
    await notifyOs("agentDone", defaultOsNotificationSettings);
    expect(createdNotifications).toHaveLength(0);
  });

  it("fires a notification when the window is not focused and permission is granted", async () => {
    // Simulate an unfocused window.
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    try {
      await notifyOs("error", defaultOsNotificationSettings, {
        title: "Custom title",
      });
      expect(createdNotifications).toHaveLength(1);
      expect(createdNotifications[0]?.title).toBe("Custom title");
    } finally {
      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      });
    }
  });

  it("no-ops when permission is denied", async () => {
    granted = false;
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    try {
      await notifyOs("agentDone", defaultOsNotificationSettings);
      expect(createdNotifications).toHaveLength(0);
    } finally {
      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      });
    }
  });
});
