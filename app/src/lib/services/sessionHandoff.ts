import type { ChatMessage } from '../domain/contracts';
import type { AgentRuntimeId } from '../session';
import type { NativeSessionRef } from '../session/adapter';
import { redactSecretStringValue } from '../session/redact';

export const HANDOFF_SECTION_LIMIT = 8_192;
export const HANDOFF_PROMPT_LIMIT = 65_536;
export type HandoffSectionId = 'goal' | 'decisions' | 'summary' | 'paths' | 'changes' | 'excerpts';
export interface HandoffSection { id: HandoffSectionId; label: string; text: string; included: boolean; evidence: string }
export interface HandoffTarget { runtimeId: AgentRuntimeId; connectionProfileId?: string; modelId: string; modeId?: string; runtimeMetadata?: Readonly<Record<string, unknown>> }
export interface HandoffDraft { sourceConnectionProfileId?: string; sourceSessionId: string; sourceRuntimeId: AgentRuntimeId; workspaceRootPath: string; sections: HandoffSection[] }
export interface HandoffAttempt {
  version: 1; id: string; sourceSessionId: string; targetSessionId: string; workspaceRootPath: string;
  target: HandoffTarget; approvedPrompt: string; approvedAt: string;
  stage: 'approved' | 'create-intent' | 'created' | 'send-intent' | 'settled';
  native?: NativeSessionRef; outcome?: 'completed' | 'uncertain';
}
/** Hidden files and credential-shaped names are excluded before any content read. */
export function isHandoffPathAllowed(path: string): boolean {
  return path.length > 0 && path.length <= 1024 && !path.startsWith('/') && !/^[a-z]:/i.test(path) && !path.includes('\\') && !/[\u0000-\u001f]/.test(path) && path.split('/').every(part => part && part !== '..' && !part.startsWith('.') && !/(secret|credential|password|token)|^auth(?:\.|$)|^api[-_]key|^id_|\.(pem|key|p12|pfx|keystore)$/i.test(part));
}
export function safeHandoffText(text: string): string {
  // A PEM block must be removed as a unit before section truncation.
  return redactSecretStringValue(text.replace(/^.*(?:authorization|[\w-]*(?:token|secret|password|credential)|api[_-]?key|access[_-]?key)\s*[:=].*$/gim, '[credential assignment excluded]').replace(/-----BEGIN[^\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\r\n]*PRIVATE KEY-----|$)/g, '[private key excluded]'), HANDOFF_SECTION_LIMIT);
}
function section(id: HandoffSectionId, label: string, text: string, evidence: string): HandoffSection {
  const safe = safeHandoffText(text);
  return { id, label, text: safe.slice(0, HANDOFF_SECTION_LIMIT), included: true, evidence: `${evidence}${safe.length > HANDOFF_SECTION_LIMIT || text.length > HANDOFF_SECTION_LIMIT ? '; truncated to section limit' : ''}` };
}
export function buildHandoffDraft(input: {
  sourceConnectionProfileId?: string; sourceSessionId: string; sourceRuntimeId: AgentRuntimeId; workspaceRootPath: string;
  messages: readonly ChatMessage[]; summary?: string; changedPaths?: readonly string[]; diff?: string;
  excerpts?: readonly { path: string; text?: string | null; state: string }[]; evidence?: string;
}): HandoffDraft {
  const common = input.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  const goal = common.find(m => m.role === 'user')?.content ?? '';
  const recent = common.slice(-12).map(m => `${m.role}: ${m.content}`).join('\n\n');
  const paths = [...new Set(input.changedPaths ?? [])].filter(isHandoffPathAllowed).sort();
  return { sourceConnectionProfileId: input.sourceConnectionProfileId, sourceSessionId: input.sourceSessionId, sourceRuntimeId: input.sourceRuntimeId, workspaceRootPath: input.workspaceRootPath, sections: [
    section('goal', 'Goal', goal, goal ? 'First common user message; review current goal' : 'Goal unavailable'),
    section('decisions', 'Decisions', '', 'No automatic inference; enter reviewed decisions'),
    section('summary', 'Summary and recent conversation', `${input.summary ?? ''}\n${recent}`.trim(), `Common text only; raw tool output, reasoning and native IDs excluded; ${Math.max(0, common.length - 12)} earlier messages omitted`),
    section('paths', 'Relevant paths', paths.slice(0, 32).join('\n'), `${paths.length} safe paths; ${Math.max(0, paths.length - 32)} paths omitted`),
    section('changes', 'Workspace changed files and diff', input.diff ?? '', input.evidence ?? 'Workspace evidence unavailable'),
    section('excerpts', 'Selected file excerpts', (input.excerpts ?? []).filter(e => isHandoffPathAllowed(e.path)).map(e => `${e.path} (${e.state})\n${e.text ?? '[content unavailable]'}`).join('\n\n'), input.excerpts?.length ? 'Bounded workspace-relative files; private paths and symlinks excluded; missing/truncated content marked' : 'No file excerpts selected'),
  ] };
}
/** Exact reviewed prompt. No native source handle is embedded or transferred. */
export function handoffFirstPrompt(draft: HandoffDraft, target: HandoffTarget, targetSessionId: string): string {
  const ref = (value: string) => safeHandoffText(value).replace(/[\r\n]/g, ' ').slice(0, 1024);
  const prompt = `Continue from this reviewed context in a fresh native session.\nSpecOps source: ${ref(draft.sourceSessionId)} (${draft.sourceRuntimeId}, profile ${ref(draft.sourceConnectionProfileId ?? 'unknown')})\nSpecOps target: ${ref(targetSessionId)} (${target.runtimeId}, profile ${ref(target.connectionProfileId ?? 'none')}, model ${ref(target.modelId)}, mode ${ref(target.modeId ?? 'default')})\nWorkspace: ${ref(draft.workspaceRootPath)}\n\n` + draft.sections.filter(s => s.included).map(s => {
    if (s.text.length > HANDOFF_SECTION_LIMIT) throw new Error('A handoff section exceeds its limit. Shorten it before approval.');
    return `## ${s.label}\nEvidence: ${s.evidence}\n${s.text}`;
  }).join('\n\n');
  if (prompt.length > HANDOFF_PROMPT_LIMIT) throw new Error('Handoff prompt exceeds its limit. Remove or shorten sections.');
  return prompt;
}
export interface HandoffExecutor {
  save(attempt: HandoffAttempt): Promise<void>;
  validate(target: HandoffTarget): Promise<void>;
  create(target: HandoffTarget, root: string): Promise<NativeSessionRef>;
  bind(attempt: HandoffAttempt): Promise<void>;
  send(attempt: HandoffAttempt): Promise<boolean>;
}
/** Compare reviewed input settings with the native adapter's immutable projection. */
export function handoffSettingsMatch(runtimeId: AgentRuntimeId, metadata: Readonly<Record<string, unknown>> | undefined, reviewed: Readonly<Record<string, unknown>> | undefined): boolean {
  return Object.entries(reviewed ?? {}).every(([key, value]) => {
    if (runtimeId === 'cursor' && key.startsWith('modelParameter:')) {
      if (value === '') return !Array.isArray(metadata?.modelParams) || !metadata.modelParams.some(p => p?.id === key.slice(15));
      return Array.isArray(metadata?.modelParams) && metadata.modelParams.some(p => p?.id === key.slice(15) && p?.value === value);
    }
    return JSON.stringify(metadata?.[key]) === JSON.stringify(value);
  });
}
export function assertHandoffNativeTarget(native: NativeSessionRef, target: HandoffTarget): void {
  if (native.runtimeId !== target.runtimeId || native.connectionProfileId !== target.connectionProfileId || (native.modelId !== target.modelId) || (target.modeId !== undefined && native.modeId !== target.modeId) || !handoffSettingsMatch(target.runtimeId, native.runtimeMetadata, target.runtimeMetadata)) throw new Error('Target binding differs from the approved runtime/profile/model/settings. Creation outcome requires inspection.');
}
/** Monotonic intent journal: interrupted native calls are never automatically retried. */
export async function executeHandoff(approved: HandoffAttempt, deps: HandoffExecutor): Promise<HandoffAttempt> {
  let attempt = structuredClone(approved);
  if (attempt.native) assertHandoffNativeTarget(attempt.native, attempt.target);
  if (attempt.stage === 'create-intent') throw new Error('Native creation outcome is unknown. Inspect runtime history; this attempt cannot create another target.');
  if (attempt.stage === 'send-intent' || attempt.stage === 'settled') {
    if (attempt.native) await deps.bind(attempt);
    return attempt;
  }
  await deps.validate(attempt.target);
  if (attempt.stage === 'approved') {
    await deps.save(attempt);
    attempt = { ...attempt, stage: 'create-intent' };
    await deps.save(attempt);
    const native = await deps.create(attempt.target, attempt.workspaceRootPath);
    assertHandoffNativeTarget(native, attempt.target);
    attempt = { ...attempt, stage: 'created', native: { ...native, history: undefined } };
    await deps.save(attempt);
  }
  assertHandoffNativeTarget(attempt.native!, attempt.target);
  await deps.bind(attempt);
  attempt = { ...attempt, stage: 'send-intent' };
  await deps.save(attempt);
  const completed = await deps.send(attempt);
  attempt = { ...attempt, stage: 'settled', outcome: completed ? 'completed' : 'uncertain' };
  await deps.save(attempt);
  return attempt;
}
