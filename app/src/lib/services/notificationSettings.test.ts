import { describe, expect, it } from "vitest";
import { NOTIFICATION_EVENT_IDS } from "../domain/contracts";
import {
  DEFAULT_SOUND_VOLUME,
  defaultOsNotificationSettings,
  defaultSoundSettings,
  normalizeOsNotificationSettings,
  normalizeSoundSettings,
} from "./notificationSettings";

describe("defaultSoundSettings", () => {
  it("enables sound with all four events on", () => {
    expect(defaultSoundSettings.enabled).toBe(true);
    expect(defaultSoundSettings.volume).toBe(DEFAULT_SOUND_VOLUME);
    for (const eventId of NOTIFICATION_EVENT_IDS) {
      expect(defaultSoundSettings.events[eventId]).toBe(true);
    }
  });
});

describe("defaultOsNotificationSettings", () => {
  it("enables OS notifications with all four events on", () => {
    expect(defaultOsNotificationSettings.enabled).toBe(true);
    for (const eventId of NOTIFICATION_EVENT_IDS) {
      expect(defaultOsNotificationSettings.events[eventId]).toBe(true);
    }
  });
});

describe("normalizeSoundSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(normalizeSoundSettings(null)).toEqual(defaultSoundSettings);
    expect(normalizeSoundSettings("x")).toEqual(defaultSoundSettings);
  });

  it("preserves valid partial input, filling missing fields with defaults", () => {
    const result = normalizeSoundSettings({
      enabled: false,
      events: { sessionDone: false },
    });
    expect(result.enabled).toBe(false);
    expect(result.volume).toBe(DEFAULT_SOUND_VOLUME);
    expect(result.events.sessionDone).toBe(false);
    expect(result.events.permission).toBe(true); // default fills the rest
  });

  it("clamps volume into 0–100", () => {
    expect(normalizeSoundSettings({ volume: 150 }).volume).toBe(DEFAULT_SOUND_VOLUME);
    expect(normalizeSoundSettings({ volume: -1 }).volume).toBe(DEFAULT_SOUND_VOLUME);
    expect(normalizeSoundSettings({ volume: 42 }).volume).toBe(42);
    expect(normalizeSoundSettings({ volume: 0 }).volume).toBe(0);
  });

  it("ignores non-boolean event flags", () => {
    const result = normalizeSoundSettings({
      events: { sessionDone: "yes", error: 1 },
    });
    expect(result.events.sessionDone).toBe(true); // default
    expect(result.events.error).toBe(true); // default
  });
});

describe("normalizeOsNotificationSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(normalizeOsNotificationSettings(null)).toEqual(defaultOsNotificationSettings);
  });

  it("preserves valid partial input", () => {
    const result = normalizeOsNotificationSettings({
      enabled: false,
      events: { permission: false, question: false },
    });
    expect(result.enabled).toBe(false);
    expect(result.events.permission).toBe(false);
    expect(result.events.question).toBe(false);
    expect(result.events.sessionDone).toBe(true); // default
    expect(result.events.error).toBe(true); // default
  });
});

describe("NOTIFICATION_EVENT_IDS", () => {
  it("lists the four feedback events in display order", () => {
    expect([...NOTIFICATION_EVENT_IDS]).toEqual([
      "sessionDone",
      "permission",
      "question",
      "error",
    ]);
  });
});
