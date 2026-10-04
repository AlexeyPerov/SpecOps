import { expect, it, vi } from 'vitest';
import { observeTurnStream } from './observedTurnStream';
import type { SessionEvent } from '../session/events';
const event = (type: SessionEvent['type'], extra = {}) => ({ type, turnId: 'turn', nativeSessionId: 'native', seq: 1, at: 't', ...extra }) as SessionEvent;
it('receives terminal while UI awaits permission and closes producer on early consumer exit', async () => {
  let closed = false; let release!: () => void;
  async function* source() { try { yield event('permission.requested'); await new Promise<void>(resolve => { release = resolve; }); yield event('turn.failed', { message: 'child lost' }); } finally { closed = true; } }
  const observed = observeTurnStream(source()); const iterator = observed.events()[Symbol.asyncIterator](); expect((await iterator.next()).value.type).toBe('permission.requested');
  await new Promise(resolve => setTimeout(resolve, 5)); release(); await new Promise(resolve => setTimeout(resolve, 5)); expect(observed.signal.aborted).toBe(true); expect((await iterator.next()).value.type).toBe('turn.failed'); expect((await iterator.next()).done).toBe(true); expect(closed).toBe(true);
});
it('consumer return cancels native source and disposes its iterator', async () => {
  let release!: () => void; let closed = false;
  async function* source() { try { yield event('turn.started'); await new Promise<void>(resolve => { release = resolve; }); yield event('turn.cancelled'); } finally { closed = true; } }
  const cancel = vi.fn(async () => release()); const observed = observeTurnStream(source(), cancel); const iterator = observed.events()[Symbol.asyncIterator](); await iterator.next(); await iterator.return?.(); await new Promise(resolve => setTimeout(resolve, 5)); expect(cancel).toHaveBeenCalledOnce(); expect(closed).toBe(true); expect(observed.signal.aborted).toBe(true);
});
it('UTF-8 byte overflow cancels producer even though pump ended with error', async () => {
  let closed = false; const cancel = vi.fn(async () => {});
  async function* source() { try { yield event('text.delta', { delta: 'я'.repeat(3 * 1024 * 1024) }); yield event('turn.finished'); } finally { closed = true; } }
  const observed = observeTurnStream(source(), cancel); await expect(observed.events()[Symbol.asyncIterator]().next()).rejects.toThrow('queue exceeded'); await new Promise(resolve => setTimeout(resolve, 5)); expect(cancel).toHaveBeenCalledOnce(); expect(closed).toBe(true);
});
