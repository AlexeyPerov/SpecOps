import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { getWorkspaceSessionsDir } from './chatPersistencePaths';
import { assertHandoffNativeTarget, type HandoffAttempt } from './sessionHandoff';
import { isAgentRuntimeId } from '../session';

interface Journal { version: 1; attempts: HandoffAttempt[] }
export function decodeHandoffJournal(raw: string): Journal {
  if (raw.length > 1_048_576) throw new Error('Handoff journal exceeds its limit. Inspect storage before continuing.');
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.attempts) || value.attempts.length > 64) throw new Error('Invalid handoff journal. Inspect storage before continuing.');
  const seen = new Set<string>();
  for (const a of value.attempts) {
    if (!a || a.version !== 1 || typeof a.id !== 'string' || seen.has(a.id) || !['approved','create-intent','created','send-intent','settled'].includes(a.stage) || typeof a.sourceSessionId !== 'string' || typeof a.targetSessionId !== 'string' || typeof a.workspaceRootPath !== 'string' || typeof a.approvedPrompt !== 'string' || a.approvedPrompt.length > 65_536 || !isAgentRuntimeId(a.target?.runtimeId) || typeof a.target.modelId !== 'string' || (['created','send-intent','settled'].includes(a.stage) && (!a.native || a.native.runtimeId !== a.target.runtimeId || a.native.connectionProfileId !== a.target.connectionProfileId || typeof a.native.nativeSessionId !== 'string'))) throw new Error('Invalid handoff attempt. Automatic retry is blocked.');
    if (![a.id, a.sourceSessionId, a.targetSessionId].every(id => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(id)) || !Number.isFinite(Date.parse(a.approvedAt)) || a.targetSessionId === a.sourceSessionId || a.workspaceRootPath.length > 4096 || !a.workspaceRootPath || (a.target.connectionProfileId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(a.target.connectionProfileId)) || a.target.modelId.length > 1024 || (a.target.modeId !== undefined && (typeof a.target.modeId !== 'string' || a.target.modeId.length > 1024)) || (a.target.runtimeMetadata !== undefined && (!a.target.runtimeMetadata || typeof a.target.runtimeMetadata !== 'object' || Array.isArray(a.target.runtimeMetadata) || JSON.stringify(a.target.runtimeMetadata).length > 8192)) || (a.native && (a.native.modelId !== undefined && a.native.modelId !== a.target.modelId || a.native.modeId !== undefined && a.native.modeId !== a.target.modeId || !a.native.nativeSessionId.trim() || a.native.nativeSessionId.length > 1024)) || (a.outcome !== undefined && !['completed','uncertain'].includes(a.outcome)) || (a.stage === 'settled' && !a.outcome)) throw new Error('Invalid handoff binding or state. Automatic retry is blocked.');
    if (a.native) assertHandoffNativeTarget(a.native, a.target);
    seen.add(a.id);
  }
  return value;
}
export async function readHandoffJournal(root: string): Promise<{ path: string; raw: string | null; attempts: HandoffAttempt[] }> {
  const path = await join(await getWorkspaceSessionsDir(root), 'handoffs.json');
  const raw = await invoke<string | null>('handoff_read_journal', { path });
  if (raw === null) return { path, raw: null, attempts: [] };
  const attempts = decodeHandoffJournal(raw).attempts;
  if (attempts.some(a => a.workspaceRootPath !== root)) throw new Error('Handoff journal workspace differs from the approved workspace.');
  return { path, raw, attempts };
}
/** Snapshot/CAS writer. Reusing a stale snapshot cannot execute a second native action. */
export async function handoffJournalWriter(root: string): Promise<{ attempts: HandoffAttempt[]; save(attempt: HandoffAttempt): Promise<void> }> {
  const snapshot = await readHandoffJournal(root);
  let raw = snapshot.raw;
  let attempts = snapshot.attempts;
  return { attempts, async save(attempt) {
    const previous = attempts.find(a => a.id === attempt.id);
    const ranks = { approved: 0, 'create-intent': 1, created: 2, 'send-intent': 3, settled: 4 };
    if (previous && (ranks[attempt.stage] < ranks[previous.stage] || JSON.stringify(previous.target) !== JSON.stringify(attempt.target) || previous.approvedPrompt !== attempt.approvedPrompt || previous.targetSessionId !== attempt.targetSessionId || previous.sourceSessionId !== attempt.sourceSessionId)) throw new Error('Handoff intent is immutable.');
    const next = [...attempts.filter(a => a.id !== attempt.id), attempt];
    if (next.length > 64) throw new Error('Handoff attempt limit reached. Inspect or archive workspace storage.');
    const content = JSON.stringify({ version: 1, attempts: next });
    decodeHandoffJournal(content);
    // Native command is mandatory. There is no weak plugin/debounce fallback.
    await invoke('handoff_write_journal', { path: snapshot.path, content, expected: raw });
    raw = content; attempts = next;
  } };
}

const initialPermits = new Map<string, { root: string; sessionId: string; prompt: string }>();
export function mintHandoffSendPermit(attempt: HandoffAttempt): string {
  const permit = crypto.randomUUID();
  initialPermits.set(permit, { root: attempt.workspaceRootPath, sessionId: attempt.targetSessionId, prompt: attempt.approvedPrompt });
  return permit;
}
export function consumeHandoffSendPermit(permit: string | undefined, root: string, sessionId: string, prompt: string): boolean {
  if (!permit) return false;
  const expected = initialPermits.get(permit); initialPermits.delete(permit);
  return expected?.root === root && expected.sessionId === sessionId && expected.prompt === prompt;
}
export function revokeHandoffSendPermit(permit: string): void { initialPermits.delete(permit); }
