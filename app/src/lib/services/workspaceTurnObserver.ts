import { getAgentHostClient } from './agentHostRuntime';
import type { WorkspaceTurnCheckpoint } from '../ai/chatSendPipeline';
import type { SessionEvent } from '../session/events';
/** Subscribe before the source releases its stream; sequence ids remove overlap. */
export async function prepareWorkspaceTurnObserver(checkpoint: WorkspaceTurnCheckpoint) {
  const queue: SessionEvent[] = []; let wake: (() => void) | undefined; let disposed = false; let terminal = false; let failure: Error | undefined;
  const client = getAgentHostClient();
  let checking = false; let generation = client.status?.generation;
  const unlisten = await client.subscribeSession(checkpoint.native, event => {
    if (disposed || terminal || !('turnId' in event) || event.turnId !== checkpoint.turnId) return;
    if (queue.length >= 4096) { failure = new Error('Workspace transfer event queue exceeded.'); terminal = true; }
    else queue.push(event);
    if (['turn.finished', 'turn.failed', 'turn.cancelled'].includes(event.type)) terminal = true;
    wake?.(); wake = undefined;
  });
  const monitor = setInterval(() => {
    if (checking || disposed || terminal) return; checking = true;
    void client.getStatus().then(status => {
      generation ??= status.generation;
      if (!status.running || status.generation !== generation) throw new Error('Agent Host exited or was replaced. Resume the session to continue.');
    }).catch(error => { failure = error instanceof Error ? error : new Error(String(error)); terminal = true; wake?.(); wake = undefined; }).finally(() => { checking = false; });
  }, 1000);
  const dispose = () => { disposed = true; clearInterval(monitor); unlisten(); wake?.(); wake = undefined; };
  return { dispose, events(checkpoint: WorkspaceTurnCheckpoint): AsyncIterable<SessionEvent> {
    return { async *[Symbol.asyncIterator]() {
      let lastSeq = checkpoint.lastSeq;
      // Pending interaction was received but not answered; include it exactly once.
      queue.unshift(...checkpoint.pending);
      queue.sort((a, b) => a.seq - b.seq);
      try {
        while (!disposed && (!terminal || queue.length)) {
          const event = queue.shift();
          if (!event) { await new Promise<void>(resolve => { wake = resolve; }); continue; }
          if (event.seq <= lastSeq) continue;
          lastSeq = event.seq;
          yield event;
        }
        if (failure) throw failure;
      } finally { dispose(); }
    } };
  } };
}
