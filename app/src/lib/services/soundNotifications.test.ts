import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSoundSettings } from "./notificationSettings";
import {
  getEventTone,
  playSound,
  setSoundContextForTests,
} from "./soundNotifications";

afterEach(() => {
  setSoundContextForTests(null);
});

/**
 * Minimal AudioContext mock. We assert via spy counts rather than instrumenting
 * the audio graph (jsdom has no real WebAudio and the mock's connect graph is
 * opaque). Each created oscillator records its configured frequency.
 */
function createMockContext() {
  const frequencies: number[] = [];
  const createOscillator = vi.fn(() => {
    const frequency = { value: 0 };
    return {
      type: "sine",
      frequency,
      connect: vi.fn(),
      start: vi.fn(() => {
        frequencies.push(frequency.value);
      }),
      stop: vi.fn(),
    };
  });
  const context = {
    currentTime: 100,
    state: "running",
    destination: {},
    createOscillator,
    createGain() {
      return {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
    },
    resume: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;
  return { context, createOscillator, frequencies };
}

describe("getEventTone", () => {
  it("returns a distinct multi-note recipe per event", () => {
    const ids = ["agentDone", "permission", "question", "error"] as const;
    const tones = ids.map((event) => getEventTone(event));
    for (const tone of tones) {
      expect(tone.notes.length).toBeGreaterThan(0);
    }
    // Recipes are distinct.
    const serialized = tones.map((tone) =>
      tone.notes.map((note) => `${note.frequency}@${note.duration}`).join(","),
    );
    expect(new Set(serialized).size).toBe(4);
  });
});

describe("playSound", () => {
  it("no-ops when the master toggle is off", () => {
    const mock = createMockContext();
    setSoundContextForTests(mock.context);

    playSound("agentDone", { ...defaultSoundSettings, enabled: false });

    expect(mock.createOscillator).not.toHaveBeenCalled();
  });

  it("no-ops when the per-event toggle is off", () => {
    const mock = createMockContext();
    setSoundContextForTests(mock.context);

    playSound("permission", {
      ...defaultSoundSettings,
      events: { ...defaultSoundSettings.events, permission: false },
    });

    expect(mock.createOscillator).not.toHaveBeenCalled();
  });

  it("schedules one oscillator per note when enabled", () => {
    const mock = createMockContext();
    setSoundContextForTests(mock.context);

    playSound("agentDone", defaultSoundSettings);

    const expectedNotes = getEventTone("agentDone").notes.length;
    expect(mock.createOscillator).toHaveBeenCalledTimes(expectedNotes);
    // Each scheduled note carries a positive frequency.
    expect(mock.frequencies).toHaveLength(expectedNotes);
    for (const frequency of mock.frequencies) {
      expect(frequency).toBeGreaterThan(0);
    }
  });

  it("no-ops when no AudioContext is available", () => {
    setSoundContextForTests(null);
    expect(() => playSound("agentDone", defaultSoundSettings)).not.toThrow();
  });
});
