import { describe, it, expect, vi } from 'vitest';
import { asNativeSessionId } from '../session';
import type { SessionEvent } from '../session/events';
import type { WorkspaceTurnCheckpoint } from '../ai/chatSendPipeline';
const host = vi.hoisted(() => ({ listener: undefined as ((event: SessionEvent) => void) | undefined, stop: vi.fn(), getStatus: vi.fn(async () => ({ running: true, generation: 1 })) }));
vi.mock('./agentHostRuntime', () => ({ getAgentHostClient: () => ({ status: { generation: 1 }, getStatus: host.getStatus, subscribeSession: async (_native: unknown, listener: (event: SessionEvent) => void) => { host.listener = listener; return host.stop; } }) }));
import { prepareWorkspaceTurnObserver } from './workspaceTurnObserver';
const event = (seq: number, type = 'text.delta', turnId = 'turn-1') => ({ seq, type, turnId, delta: String(seq), nativeSessionId: 'native', at: '' }) as SessionEvent;
const checkpoint = { root: '/project', activeSessionId: 'session-1', turnId: 'turn-1', native: { runtimeId: 'fake', nativeSessionId: asNativeSessionId('native') }, userMessageId: 'user', assistantMessageId: 'assistant', fold: { content: '12', parts: [], toolCalls: [] }, lastSeq: 2, pending: [event(3, 'permission.requested')] } as WorkspaceTurnCheckpoint;
describe('workspace turn observation', () => {
  it('retains events arriving before commit, replays pending interaction once, and filters overlap and other turns', async () => {
    const observer = await prepareWorkspaceTurnObserver(checkpoint);
    for (const item of [event(2), event(3, 'permission.requested'), event(4), event(5, 'text.delta', 'other'), event(6, 'turn.finished')]) host.listener!(item);
    const received: SessionEvent[] = [];
    for await (const item of observer.events(checkpoint)) received.push(item);
    expect(received.map(item => item.seq)).toEqual([3, 4, 6]);
    expect(host.stop).toHaveBeenCalled();
  });
  it('disposes an idle prepared subscription without waiting for native output', async () => {
    const observer = await prepareWorkspaceTurnObserver(checkpoint);
    observer.dispose();
    const received = [];
    for await (const item of observer.events(checkpoint)) received.push(item);
    expect(received).toEqual([]);
  });
});
