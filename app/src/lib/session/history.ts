import type { ChatMessage } from '../domain/contracts';
import type { NativeSessionRef } from './adapter';
import { foldSessionEvent, initialTurnFoldState } from './host/hostTurnReducer';

/** Full native snapshot replaces cached runtime truth; only current unsent work survives. */
export function reconcileNativeHistory(cached: readonly ChatMessage[], native: NonNullable<NativeSessionRef['history']>, pendingMessageIds: readonly string[]): ChatMessage[] {
  const history = new Map<string, ChatMessage>();
  for (const message of native) {
    const fold = (message.events ?? []).reduce(foldSessionEvent, initialTurnFoldState());
    const key = message.role === 'assistant' ? `assistant:${message.nativeTurnId}` : `user:${message.nativeTurnId}:${message.nativeItemId ?? message.id}`;
    history.set(key, {
      id: message.id, role: message.role, content: message.content, createdAt: message.createdAt,
      nativeTurnId: message.nativeTurnId, ...(message.nativeItemId ? { nativeItemId: message.nativeItemId } : {}),
      ...(message.completionState ? { completionState: message.completionState } : {}),
      ...(message.role === 'assistant' ? { parts: fold.parts, toolCalls: fold.toolCalls } : {}),
    });
  }
  const ids = new Set([...history.values()].map(message => message.id));
  const pending = new Set(pendingMessageIds);
  const tail = cached.filter(message => pending.has(message.id) && !message.nativeTurnId && !ids.has(message.id));
  return [...history.values(), ...tail];
}
