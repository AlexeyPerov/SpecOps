import type {
  NotificationEventId,
  SoundSettings,
} from "../domain/contracts";

/**
 * Per-event tone recipe. Each event gets a distinct two-note arpeggio so users
 * can learn to recognize them without looking. Frequencies are in Hz; durations
 * in seconds.
 */
interface ToneRecipe {
  notes: Array<{ frequency: number; duration: number }>;
}

const EVENT_TONES: Record<NotificationEventId, ToneRecipe> = {
  // Rising major third — "finished, good news".
  sessionDone: {
    notes: [
      { frequency: 660, duration: 0.09 },
      { frequency: 880, duration: 0.14 },
    ],
  },
  // Soft two-note knock — "your input is needed".
  permission: {
    notes: [
      { frequency: 523, duration: 0.1 },
      { frequency: 392, duration: 0.12 },
    ],
  },
  // Gentle question interval — "answer me".
  question: {
    notes: [
      { frequency: 587, duration: 0.1 },
      { frequency: 784, duration: 0.12 },
    ],
  },
  // Descending dissonant pair — "something went wrong".
  error: {
    notes: [
      { frequency: 392, duration: 0.12 },
      { frequency: 277, duration: 0.2 },
    ],
  },
};

/**
 * Lazily-created shared AudioContext. Browsers require a user gesture before
 * audio can play; in practice the first event after the app gains focus primes
 * it. We recreate if the context was closed.
 */
let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  // Return an already-created (or test-injected) context first so we don't
  // require a native AudioContext constructor just to reuse it.
  if (sharedContext && sharedContext.state !== "closed") {
    return sharedContext;
  }
  if (typeof window === "undefined") {
    return null;
  }
  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!ctor) {
    return null;
  }
  try {
    sharedContext = new ctor();
    return sharedContext;
  } catch {
    return null;
  }
}

/** A test seam: inject a fake context. Reset with `undefined`. */
export function setSoundContextForTests(
  context: AudioContext | null,
): void {
  sharedContext = context;
}

function playRecipe(
  context: AudioContext,
  recipe: ToneRecipe,
  volume: number,
): void {
  // gain normalized 0..1 from the 0..100 user volume.
  const gain = Math.max(0, Math.min(1, volume / 100)) * 0.3;
  let offset = context.currentTime;
  for (const note of recipe.notes) {
    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = note.frequency;
    // Short attack/decay to avoid clicks.
    noteGain.gain.setValueAtTime(0, offset);
    noteGain.gain.linearRampToValueAtTime(gain, offset + 0.01);
    noteGain.gain.exponentialRampToValueAtTime(
      0.0001,
      offset + note.duration,
    );
    oscillator.connect(noteGain);
    noteGain.connect(context.destination);
    oscillator.start(offset);
    oscillator.stop(offset + note.duration + 0.02);
    offset += note.duration;
  }
}

/**
 * Plays the tone for `event` unless the master toggle or per-event toggle is
 * off. No-ops when WebAudio is unavailable (SSR / unsupported webview).
 */
export function playSound(
  event: NotificationEventId,
  settings: SoundSettings,
): void {
  if (!settings.enabled || !settings.events[event]) {
    return;
  }
  const context = getAudioContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    void context.resume().catch(() => {
      /* best-effort; ignore autoplay failures */
    });
  }
  playRecipe(context, EVENT_TONES[event], settings.volume);
}

/** Pure accessor used by tests and the appearance panel preview. */
export function getEventTone(
  event: NotificationEventId,
): Readonly<ToneRecipe> {
  return EVENT_TONES[event];
}
