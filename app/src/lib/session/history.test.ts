import { expect, it } from 'vitest';
import { reconcileNativeHistory } from './history';
import type { ChatMessage } from '../domain/contracts';
import type { NativeSessionRef } from './adapter';
const native: NonNullable<NativeSessionRef['history']> = [
  { id: 'user-native', nativeTurnId: 'turn', nativeItemId: 'user-item', role: 'user', content: 'native prompt', createdAt: 't' },
  { id: 'native-assistant:turn', nativeTurnId: 'turn', nativeItemId: 'text-item', role: 'assistant', content: 'native answer', createdAt: 't' },
];
it('authoritative history removes divergent/duplicate/stale cache and retains only current unsent work', () => {
  const cached: ChatMessage[] = [
    { id: 'user-native', role: 'user', content: 'corrupt', createdAt: 't' },
    { id: 'duplicate', nativeTurnId: 'turn', role: 'assistant', content: 'stale', createdAt: 't' },
    { id: 'orphan', nativeTurnId: 'absent', role: 'assistant', content: 'stale', createdAt: 't' },
    { id: 'next', role: 'user', content: 'new prompt', createdAt: 't' },
    { id: 'pending', role: 'assistant', content: '', createdAt: 't' },
  ];
  const result = reconcileNativeHistory(cached, [...native, ...native], ['next', 'pending']);
  expect(result.map(m => m.id)).toEqual(['user-native', 'native-assistant:turn', 'next', 'pending']); expect(result[0]?.content).toBe('native prompt');
  expect(reconcileNativeHistory(result, native, ['next', 'pending'])).toEqual(result);
  expect(reconcileNativeHistory(cached, [], ['next', 'pending']).map(m => m.id)).toEqual(['next', 'pending']);
});
