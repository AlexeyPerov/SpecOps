import type { SessionEvent } from '../session/events';
/** Receive terminal/failure while interaction UI waits, with bounded buffering and disposal. */
export function observeTurnStream(source: AsyncIterable<SessionEvent>, onDispose?: () => Promise<void>) {
  const abort = new AbortController(); const iterator = source[Symbol.asyncIterator]();
  const queue: SessionEvent[] = []; let bytes = 0; let wake: (() => void) | undefined; let done = false; let error: unknown; let disposed = false; let sourceCompleted = false; let terminalReceived = false;
  const sizeOf = (event: SessionEvent) => new TextEncoder().encode(JSON.stringify(event)).byteLength;
  const pump = (async () => {
    try {
      while (!disposed) {
        const next = await iterator.next(); if (next.done) { sourceCompleted = true; break; }
        const event = next.value; const size = sizeOf(event);
        if (queue.length >= 4096 || bytes + size > 4 * 1024 * 1024) throw new Error('Turn event queue exceeded');
        queue.push(event); bytes += size;
        if (['turn.finished', 'turn.failed', 'turn.cancelled'].includes(event.type)) { terminalReceived = true; abort.abort(); }
        wake?.(); wake = undefined;
        if (event.type === 'permission.requested' || event.type === 'question.requested') await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (e) { error = e; }
    finally { done = true; abort.abort(); wake?.(); wake = undefined; }
  })();
  return { signal: abort.signal, async *events(): AsyncIterable<SessionEvent> {
    try { while (!done || queue.length) { const event = queue.shift(); if (event) { bytes -= sizeOf(event); yield event; } else await new Promise<void>(resolve => { wake = resolve; }); } if (error) throw error; }
    finally { disposed = true; abort.abort(); if (!sourceCompleted && !terminalReceived) { await onDispose?.().catch(() => {}); void iterator.return?.().catch(() => {}); } void pump; queue.length = 0; }
  } };
}
