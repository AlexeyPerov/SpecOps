import type {
  NotificationEventId,
  SoundSettings,
  OsNotificationSettings,
} from "../domain/contracts";
import type { ChatThreadRuntimeState } from "../state/chatStore/types";
import { playSound } from "./soundNotifications";
import { notifyOs, defaultCopyForEvent } from "./osNotifications";

/**
 * Pure derivation: given the previous and current per-session runtime state,
 * returns the feedback events that occurred on this transition. Centralizing
 * this makes the trigger rules unit-testable without a DOM.
 *
 * - sessionDone: isGenerating went true → false without a fresh failure.
 * - permission: isWaitingForPermission went false → true.
 * - question: isWaitingForQuestion went false → true.
 * - error: lastFailedTurnId changed (a new failed turn).
 */
export function deriveNotificationEvents(
  previous: ChatThreadRuntimeState | undefined,
  current: ChatThreadRuntimeState,
): NotificationEventId[] {
  const events: NotificationEventId[] = [];
  const prev = previous ?? current;

  const wasGenerating = prev.isGenerating;
  const nowGenerating = current.isGenerating;
  if (wasGenerating && !nowGenerating) {
    // A failure also flips isGenerating to false; treat a new failed turn as
    // an error event rather than a done event.
    const newFailure = current.lastFailedTurnId !== prev.lastFailedTurnId;
    if (!newFailure) {
      events.push("sessionDone");
    }
  }

  if (!prev.isWaitingForPermission && current.isWaitingForPermission) {
    events.push("permission");
  }

  if (!prev.isWaitingForQuestion && current.isWaitingForQuestion) {
    events.push("question");
  }

  if (current.lastFailedTurnId && current.lastFailedTurnId !== prev.lastFailedTurnId) {
    events.push("error");
  }

  return events;
}

export interface NotificationSettingsSnapshot {
  sound: SoundSettings;
  osNotifications: OsNotificationSettings;
}

export interface SessionNotificationObserver {
  /** Call on every chatStore snapshot change. */
  update(state: {
    activeScopeKey: string | null;
    runtimeBySessionId: Record<string, ChatThreadRuntimeState>;
    settings: NotificationSettingsSnapshot;
  }): void;
  /** Release per-session history. Call when the active workspace changes. */
  reset(): void;
  /** Teardown: clears all history. */
  dispose(): void;
}

/** Sinks the observer dispatches to; overridable for tests. */
export interface NotificationSinks {
  playSound: typeof playSound;
  notifyOs: typeof notifyOs;
}

const defaultSinks: NotificationSinks = { playSound, notifyOs };

/**
 * Tracks the previous runtime state per session id within the active workspace
 * and fires sound + OS notifications on the transitions reported by
 * {@link deriveNotificationEvents}. Call `update` on every chatStore change;
 * call `reset` when the active workspace changes so we don't carry stale
 * history across scopes.
 */
export function createSessionNotificationObserver(
  sinks: NotificationSinks = defaultSinks,
): SessionNotificationObserver {
  let previousBySessionId: Record<string, ChatThreadRuntimeState> = {};
  let trackedScopeKey: string | null = null;

  function emit(
    events: NotificationEventId[],
    settings: NotificationSettingsSnapshot,
  ): void {
    for (const event of events) {
      sinks.playSound(event, settings.sound);
      const copy = defaultCopyForEvent(event);
      void sinks.notifyOs(event, settings.osNotifications, copy);
    }
  }

  return {
    update({ activeScopeKey, runtimeBySessionId, settings }) {
      if (activeScopeKey !== trackedScopeKey) {
        trackedScopeKey = activeScopeKey;
        previousBySessionId = {};
      }
      // Only observe the active workspace's sessions.
      for (const [sessionId, runtime] of Object.entries(runtimeBySessionId)) {
        const previous = previousBySessionId[sessionId];
        const events = deriveNotificationEvents(previous, runtime);
        previousBySessionId[sessionId] = runtime;
        if (events.length > 0) {
          emit(events, settings);
        }
      }
    },
    reset() {
      previousBySessionId = {};
    },
    dispose() {
      previousBySessionId = {};
      trackedScopeKey = null;
    },
  };
}
