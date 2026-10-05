import { redactForSerialization, redactSecretStringValue } from '../../../src/lib/session/redact';
import { randomUUID } from 'node:crypto';
import type { AgentTurnRequest } from '../../../src/lib/session/adapter';
import type { SessionEvent, PermissionReply, SubtaskSnapshot } from '../../../src/lib/session/events';
import type { CodexTransport } from './transport';
import { object } from './transport';
import type { ThreadItem } from './generated/v2/ThreadItem';
import type { ToolRequestUserInputQuestion } from './generated/v2/ToolRequestUserInputQuestion';
import type { ToolRequestUserInputResponse } from './generated/v2/ToolRequestUserInputResponse';

type Payload = SessionEvent extends infer E ? E extends SessionEvent ? Omit<E, 'nativeSessionId' | 'connectionProfileId' | 'seq' | 'at'> : never : never;
interface Interaction { id: string | number; method: string; generation: number; timer: ReturnType<typeof setTimeout>; questions?: ToolRequestUserInputQuestion[]; answers?: Record<string, { answers: string[] }>; keys: string[] }
/** One native turn, bounded push queue, no prompt replay, one terminal and iterator closure. */
export class NativeTurn {
  nativeTurnId?: string;
  ended = false;
  private finishing = false;
  private capacityExceeded = false;
  cancelled = false;
  private queue: SessionEvent[] = [];
  private bytes = 0;
  private stateBytes = 0;
  private itemIds = new Set<string>();
  private wake?: () => void;
  private texts = new Map<string, string>();
  private emittedTexts = new Set<string>();
  private reasonings = new Map<string, string>();
  private completed = new Set<string>();
  private tools = new Set<string>();
  private pending = new Map<string, Interaction>();
  private buffered: (() => void)[] = [];
  private streamCarry = new Map<string, string>();
  private totals?: { input: number; output: number; reasoning: number; read: number; write: number };
  readonly generation: number;
  constructor(readonly request: AgentTurnRequest, readonly transport: CodexTransport, private nextSeq: () => number, readonly interactionTimeoutMs = 300000, private knownSecrets: readonly string[] = []) { this.generation = transport.generation; this.emit({ type: 'turn.started', turnId: request.turnId }); }
  private safe(value: string): string { for (const secret of this.knownSecrets) if (secret) value = value.split(secret).join("[redacted]"); return redactSecretStringValue(value, Infinity); }
  private safePayload(value: unknown, depth = 0): unknown { if (depth > 64) return "[redacted depth]"; if (typeof value === "string") return this.safe(value); if (Array.isArray(value)) return value.map(v => this.safePayload(v, depth + 1)); if (object(value)) return Object.fromEntries(Object.entries(value).map(([k,v]) => [this.safe(k), this.safePayload(v, depth + 1)])); return value; }
  private identity(value: unknown): string { if (typeof value !== "string" || !value || value.length > 256 || this.safe(value) !== value) throw new Error("Unsafe native activity identity"); return value; }
  private activities = new Map<string, SubtaskSnapshot>();
  private activity(snapshot: SubtaskSnapshot, context = false): void { if (!this.activities.has(snapshot.id) && this.activities.size >= 256) { this.finish("turn.failed", "Native activity capacity exceeded"); this.transport.close(); return; } this.activities.set(snapshot.id, snapshot); this.emit({ type: context ? "context.compaction" : "subtask.updated", turnId: this.request.turnId, nativeItemId: snapshot.nativeItemId, subtask: snapshot }); }
  emit(payload: Payload): void {
    if (this.ended) return;
    const event = { ...(redactForSerialization(this.safePayload(payload), Infinity) as Payload), nativeSessionId: this.request.native.nativeSessionId, connectionProfileId: this.request.native.connectionProfileId, nativeGeneration: this.generation, nativeTurnId: this.nativeTurnId, seq: this.nextSeq(), at: new Date().toISOString() } as SessionEvent;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (!['turn.finished','turn.failed','turn.cancelled'].includes(payload.type) && (this.queue.length >= 4096 || this.bytes + bytes > 4 * 1024 * 1024)) { const started = this.queue.find(e => e.type === 'turn.started'); this.queue = started ? [started] : []; this.bytes = started ? Buffer.byteLength(JSON.stringify(started)) : 0; this.texts.clear(); this.capacityExceeded = true; if (!this.finishing) this.finish('turn.failed', 'Native event capacity exceeded; reconnect the thread.'); this.transport.close(); return; }
    this.queue.push(event); this.bytes += bytes; this.wake?.(); this.wake = undefined;
  }
  private retain(text: string, itemId: string): boolean {
    this.stateBytes += Buffer.byteLength(text); this.itemIds.add(itemId);
    if (this.stateBytes <= 4 * 1024 * 1024 && this.itemIds.size <= 10000) return true;
    this.texts.clear(); this.reasonings.clear(); this.streamCarry.clear(); this.streamWriters.clear();
    this.finish('turn.failed', 'Native turn capacity exceeded; reconnect explicitly.'); this.transport.close(); return false;
  }
  private streamWriters = new Map<string, (text: string) => void>();
  /** Hold the final lexical atom so split credential fragments cannot reach the UI. */
  private stream(key: string, delta: string, write: (text: string) => void): void {
    if (!this.retain(delta, key)) return;
    const text = (this.streamCarry.get(key) ?? '') + delta;
    this.streamWriters.set(key, write);
    let end = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'), text.lastIndexOf('\t')) + 1;
    const secretTail = Math.max(0, ...this.knownSecrets.filter(v => /\s/.test(v)).map(v => v.length));
    if (secretTail) { const cutoff = Math.max(0, text.length - secretTail); end = Math.min(end, Math.max(text.lastIndexOf(' ', cutoff), text.lastIndexOf('\n', cutoff), text.lastIndexOf('\t', cutoff)) + 1); }
    const prefix = text.slice(0, end).match(/(?<![\w-])(?:Bearer|["']?[\w-]*(?:token|secret)["']?|["']?(?:password|api[_-]?key|device[_-]?code|user[_-]?code|authUrl|verificationUrl)["']?)\s*(?:[=:]\s*["']?)?$/i);
    if (prefix?.index !== undefined) end = prefix.index;
    if (end) write(this.safe(text.slice(0, end)));
    const carry = text.slice(end);
    if (carry.length > 1024 * 1024) { this.finish('turn.failed', 'Native text capacity exceeded; reconnect explicitly.'); this.transport.close(); return; }
    this.streamCarry.set(key, carry);
  }
  private flushStreams(): void {
    const pending = [...this.streamCarry].map(([key, text]) => [this.streamWriters.get(key), text] as const);
    this.streamCarry.clear(); this.streamWriters.clear();
    for (const [write, text] of pending) write?.(this.safe(text));
  }
  bind(id: unknown): void { if (typeof id !== 'string' || !id || (this.nativeTurnId && this.nativeTurnId !== id)) throw new Error('Native turn identity mismatch'); this.nativeTurnId = id; for (const apply of this.buffered.splice(0)) apply(); }
  finish(type: 'turn.finished' | 'turn.failed' | 'turn.cancelled', message?: string): void {
    if (this.ended || this.finishing) return;
    this.finishing = true;
    this.flushStreams();
    for (const snapshot of this.activities.values()) if (["running", "pending"].includes(snapshot.status)) this.activity({ ...snapshot, status: "unknown", description: (snapshot.description ?? "") + " Parent turn ended; child/context completion was not observed." }, snapshot.category === "context");
    if (this.texts.size) this.emit({ type: 'text.finished', turnId: this.request.turnId, text: this.safe([...this.texts.values()].join('')).slice(0, 512 * 1024) });
    for (const interaction of new Set(this.pending.values())) { clearTimeout(interaction.timer); try { this.transport.respond(interaction.id, interaction.questions ? { answers: {} } : { decision: 'cancel' }, interaction.generation); } catch {} }
    this.pending.clear(); this.buffered = [];
    if (this.capacityExceeded) { type = 'turn.failed'; message = 'Native event capacity exceeded; reconnect the thread.'; }
    this.emit(type === 'turn.failed' ? { type, turnId: this.request.turnId, message: message ?? 'Native turn failed' } : { type, turnId: this.request.turnId }); this.ended = true; this.wake?.(); this.wake = undefined;
  }
  private correlated(raw: unknown, generation: number, apply: (raw: Record<string, unknown>) => void): void {
    if (this.ended || generation !== this.generation || !object(raw) || raw.threadId !== this.request.native.nativeSessionId) return;
    if (!this.nativeTurnId) { if (this.buffered.length >= 128) { this.finish('turn.failed', 'Native correlation capacity exceeded'); return; } this.buffered.push(() => this.correlated(raw, generation, apply)); return; }
    if (raw.turnId !== this.nativeTurnId && (!object(raw.turn) || raw.turn.id !== this.nativeTurnId)) return;
    apply(raw);
  }
  notification(method: string, raw: unknown, generation: number): void {
    if (method === 'turn/started' && object(raw) && raw.threadId === this.request.native.nativeSessionId && object(raw.turn) && generation === this.generation && !this.nativeTurnId && !this.ended) this.bind(raw.turn.id);
    this.correlated(raw, generation, p => {
      const turnId = this.request.turnId;
      if (method === 'turn/completed' && object(p.turn)) { const status = p.turn.status; if (status === 'completed') this.finish('turn.finished'); else if (status === 'interrupted') this.finish(this.cancelled ? 'turn.cancelled' : 'turn.failed', 'Native turn interrupted; resume explicitly to continue.'); else this.finish('turn.failed', 'Native turn failed; inspect the thread and retry explicitly.'); }
      else if (method === 'turn/started') this.emit({ type: 'status.changed', status: 'running' });
      else if (method === 'item/agentMessage/delta' && typeof p.itemId === 'string' && typeof p.delta === 'string' && !this.completed.has(p.itemId)) { if (!this.retain(p.delta, p.itemId)) return; this.texts.set(p.itemId, (this.texts.get(p.itemId) ?? '') + p.delta); this.stream(`text:${p.itemId}`, p.delta, delta => { this.emittedTexts.add(p.itemId as string); this.emit({ type: 'text.delta', turnId, delta, nativeItemId: p.itemId as string }); }); }
      else if ((method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') && typeof p.itemId === 'string' && typeof p.delta === 'string' && !this.completed.has(p.itemId)) { if (!this.retain(p.delta, p.itemId)) return; const id = `${p.itemId}:${method.includes('summary') ? 'summary' : 'content'}:${p.summaryIndex ?? p.contentIndex ?? 0}`; this.reasonings.set(id, (this.reasonings.get(id) ?? '') + p.delta); this.stream(`reasoning:${id}`, p.delta, delta => this.emit({ type: 'reasoning.delta', turnId, reasoningId: id, delta, nativeItemId: p.itemId as string })); }
      else if ((method === 'item/started' || method === 'item/completed') && object(p.item)) this.item(p.item as unknown as ThreadItem, method === 'item/completed');
      else if ((method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') && typeof p.itemId === 'string' && typeof p.delta === 'string' && !this.completed.has(p.itemId)) this.stream(`tool:${p.itemId}`, p.delta, progress => this.emit({ type: 'tool.progress', turnId, callId: p.itemId as string, progress }));
      else if (method === 'thread/tokenUsage/updated' && object(p.tokenUsage) && object(p.tokenUsage.last)) {
        const v = object(p.tokenUsage.total) ? p.tokenUsage.total : p.tokenUsage.last; const next = { input: Number(v.inputTokens), output: Number(v.outputTokens), reasoning: Number(v.reasoningOutputTokens), read: Number(v.cachedInputTokens), write: Number(v.cacheWriteInputTokens ?? 0) };
        if (Object.values(next).some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid native usage');
        const last = p.tokenUsage.last;
        const names = { input: 'inputTokens', output: 'outputTokens', reasoning: 'reasoningOutputTokens', read: 'cachedInputTokens', write: 'cacheWriteInputTokens' };
        const diff = (key: keyof typeof next) => this.totals ? Math.max(0, next[key] - this.totals[key]) : Math.max(0, Number(last[names[key]] ?? 0));
        if (JSON.stringify(next) === JSON.stringify(this.totals)) return;
        this.emit({ type: 'usage.recorded', turnId, usage: { input: diff('input'), output: diff('output'), reasoning: diff('reasoning'), cache: { read: diff('read'), write: diff('write') } } }); this.totals = next;
      } else if (method === 'error') { if (p.willRetry === true) this.emit({ type: 'diagnostic', level: 'warn', message: 'Native request is retrying.' }); else this.finish('turn.failed', 'Native request failed'); }
      else this.emit({ type: 'diagnostic', level: 'info', reason: ['item/agentMessage/delta','item/reasoning/summaryTextDelta','item/reasoning/textDelta','item/started','item/completed','thread/tokenUsage/updated'].includes(method) ? 'malformed' : 'unknown-native', message: 'Unmapped native notification' });
    });
  }
  item(item: ThreadItem, done: boolean): void {
    if (done) {
      // Authoritative completed item replaces its carry; other streams retain fragments.
      for (const key of this.streamCarry.keys()) if (key === `text:${item.id}` || key === `tool:${item.id}` || key.startsWith(`reasoning:${item.id}:`)) { this.streamCarry.delete(key); this.streamWriters.delete(key); }
    }
    if (!object(item) || typeof item.id !== 'string' || !item.id || typeof item.type !== 'string') throw new Error('Invalid native item identity');
    if ((item.type === 'agentMessage' || item.type === 'plan') && typeof item.text !== 'string') throw new Error('Invalid native text item');
    if (item.type === 'reasoning' && (!Array.isArray(item.summary) || !Array.isArray(item.content) || [...item.summary, ...item.content].some(value => typeof value !== 'string'))) throw new Error('Invalid native reasoning item');
    if (item.type === 'fileChange' && (!['inProgress', 'completed', 'failed', 'declined'].includes(item.status) || !Array.isArray(item.changes) || item.changes.some(change => !object(change) || typeof change.path !== 'string' || typeof change.diff !== 'string'))) throw new Error('Invalid native file item');
    if (!this.retain(JSON.stringify(item), item.id)) return;
    const turnId = this.request.turnId;
    if (done && this.completed.has(item.id)) return;
    if (item.type === 'agentMessage' || item.type === 'plan') { if (done) { if (this.texts.has(item.id) && !this.emittedTexts.has(item.id)) { this.emit({ type: 'text.delta', turnId, delta: this.safe(item.text), nativeItemId: item.id }); this.emittedTexts.add(item.id); } this.texts.set(item.id, item.text); } else if (!this.texts.has(item.id)) this.texts.set(item.id, ''); }
    else if (item.type === 'reasoning' && done) { for (const [kind, sections] of [['summary', item.summary], ['content', item.content]] as const) sections.forEach((text, index) => { const id = `${item.id}:${kind}:${index}`; this.reasonings.set(id, text); this.emit({ type: 'reasoning.ended', turnId, reasoningId: id, text }); }); }
    else if (item.type === 'contextCompaction') {
      this.identity(item.id);
      this.activity({ id: `context:${item.id}`, nativeItemId: item.id, agent: 'Native context compaction', category: 'context', status: done ? 'completed' : 'running', description: done ? 'Native context compaction completed. No removed-message count is provided.' : 'Native context compaction started.' }, true);
    } else if (item.type === 'collabAgentToolCall') {
      const statuses = { pendingInit: 'pending', running: 'running', interrupted: 'interrupted', completed: 'completed', errored: 'failed', shutdown: 'shutdown', notFound: 'not-found' } as const;
      if (!['spawnAgent','sendInput','resumeAgent','wait','closeAgent','sendMessage','followupTask','interruptAgent','listAgents'].includes(item.tool) || !['inProgress','completed','failed'].includes(item.status) || !Array.isArray(item.receiverThreadIds) || item.receiverThreadIds.length > 64 || !object(item.agentsStates) || Object.keys(item.agentsStates).length > 64 || (item.prompt !== null && (typeof item.prompt !== 'string' || item.prompt.length > 65536))) throw new Error('Invalid native agent activity');
      this.identity(item.id); this.identity(item.senderThreadId); if (item.senderThreadId !== this.request.native.nativeSessionId) throw new Error("Native activity sender mismatch");
      const ids = new Set([...item.receiverThreadIds, ...Object.keys(item.agentsStates)]);
      if (ids.size > 64) throw new Error('Native activity child capacity exceeded');
      for (const id of ids) {
        this.identity(id); const state = item.agentsStates[id];
        if (state && (!object(state) || !Object.hasOwn(statuses, state.status) || (state.message !== null && (typeof state.message !== 'string' || state.message.length > 65536)))) throw new Error('Invalid native child state');
        const previous = this.activities.get(`agent:${id}`);
        this.activity({ ...previous, id: `agent:${id}`, nativeItemId: item.id, nativeThreadId: id, category: 'agent', agent: 'Native agent', status: state ? statuses[state.status] : previous?.status ?? 'unknown', description: `Native ${item.tool}: ${item.status}. Tool completion alone does not establish child completion.`, ...(item.prompt !== null ? { prompt: this.safe(item.prompt) } : {}), ...(state?.message ? state.status === 'errored' ? { error: this.safe(state.message), output: undefined } : { output: this.safe(state.message), error: undefined } : {}) });
      }
      if (!ids.size) this.emit({ type: 'diagnostic', level: 'info', message: 'Native agent control supplied no child state.' });
    } else if (item.type === 'subAgentActivity') {
      if (!['started','interacted','interrupted','completed'].includes(item.kind) || typeof item.agentPath !== 'string' || item.agentPath.length > 4096) throw new Error('Invalid native agent activity');
      this.identity(item.id); this.identity(item.agentThreadId); const id = `agent:${item.agentThreadId}`; const previous = this.activities.get(id);
      this.activity({ ...previous, id, nativeItemId: item.id, nativeThreadId: item.agentThreadId, category: 'agent', agent: 'Native agent', agentPath: this.safe(item.agentPath), status: item.kind === 'completed' ? 'completed' : item.kind === 'interrupted' ? 'interrupted' : item.kind === 'started' ? 'running' : previous?.status ?? 'unknown', description: `Native agent activity: ${item.kind}.` });
    }
    else if (['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','imageView'].includes(item.type)) {
      const raw = item as unknown as Record<string, unknown>;
      if (!this.tools.has(item.id)) { this.tools.add(item.id); this.emit({ type: 'tool.started', turnId, toolCall: { callId: item.id, toolName: item.type, status: 'running', input: raw.command ?? raw.arguments ?? raw.changes ?? raw.prompt } }); }
      if (done) this.emit({ type: 'tool.completed', turnId, callId: item.id, status: raw.status === 'failed' || raw.status === 'declined' || raw.success === false || (typeof raw.exitCode === 'number' && raw.exitCode !== 0) ? 'failure' : 'success', output: raw.aggregatedOutput ?? raw.result ?? raw.contentItems ?? raw.changes });
      if (done && item.type === 'fileChange') this.emit({ type: 'diff.posted', turnId, diff: { id: item.id, files: item.changes.map(c => c.path), snapshot: item.changes.map(c => c.diff).join('\n') } });
    } else if (item.type !== 'userMessage') this.emit({ type: 'diagnostic', level: 'info', reason: 'unknown-native', message: 'Unmapped native item' });
    if (done) this.completed.add(item.id);
  }
  serverRequest(id: string | number, method: string, raw: unknown, generation: number): void {
    if (this.ended || generation !== this.generation || !object(raw) || raw.threadId !== this.request.native.nativeSessionId || (this.nativeTurnId && raw.turnId !== this.nativeTurnId)) { this.transport.reject(id, generation); return; }
    if (!['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput'].includes(method)) { this.transport.reject(id, generation); return; }
    this.correlated(raw, generation, p => {
      const key = randomUUID(); const questions = method === 'item/tool/requestUserInput' && Array.isArray(p.questions) ? p.questions as ToolRequestUserInputQuestion[] : undefined;
      if (method.endsWith('requestUserInput') && (!questions?.length || questions.length > 32 || new Set(questions.map(q => q.id)).size !== questions.length || questions.some(q => typeof q.id !== 'string' || typeof q.question !== 'string' || q.isSecret))) { this.transport.reject(id, generation); return; }
      const interaction: Interaction = { id, method, generation, keys: [], questions, answers: {}, timer: setTimeout(() => { this.resolve(interaction, questions ? { answers: {} } : { decision: 'cancel' }); this.cancelled = true; void this.transport.request('turn/interrupt', { threadId: this.request.native.nativeSessionId, turnId: this.nativeTurnId }, 750).catch(() => this.transport.close()); this.finish('turn.cancelled'); }, this.interactionTimeoutMs) };
      if (questions) questions.forEach((q, index) => { const token = `${key}:${index}`; interaction.keys.push(token); this.pending.set(token, interaction); this.emit({ type: 'question.requested', turnId: this.request.turnId, request: { questionId: token, prompt: q.question, choices: q.options?.map(o => o.label), payload: { nativeItemId: p.itemId, header: q.header } } }); });
      else { interaction.keys.push(key); this.pending.set(key, interaction); this.emit({ type: 'permission.requested', turnId: this.request.turnId, request: { permissionId: key, label: method.includes('commandExecution') ? `Run ${typeof p.command === 'string' ? p.command : 'native command'}` : 'Allow native file changes', payload: { nativeItemId: p.itemId, command: p.command, cwd: p.cwd, reason: p.reason, scope: 'thread' } } }); }
    });
  }
  private resolve(interaction: Interaction, result: unknown): void { this.transport.respond(interaction.id, result, interaction.generation); clearTimeout(interaction.timer); for (const key of interaction.keys) this.pending.delete(key); }
  permission(key: string, reply: PermissionReply): void { const pending = this.pending.get(key); if (!pending || pending.questions || this.ended || this.transport.generation !== pending.generation) throw new Error('Approval expired or belongs to another turn'); this.resolve(pending, { decision: reply === 'once' ? 'accept' : reply === 'always' ? 'acceptForSession' : 'decline' }); }
  question(key: string, answer?: string): void { const pending = this.pending.get(key); if (!pending?.questions || this.ended || this.transport.generation !== pending.generation) throw new Error('Question expired or belongs to another turn'); if (answer === undefined) { this.resolve(pending, { answers: {} }); return; } const index = pending.keys.indexOf(key); const question = pending.questions[index]; if (!question || pending.answers?.[question.id]) throw new Error('Question already answered'); pending.answers![question.id] = { answers: [answer] }; if (Object.keys(pending.answers!).length === pending.questions.length) this.resolve(pending, { answers: pending.answers! } satisfies ToolRequestUserInputResponse); }
  async *events(): AsyncIterable<SessionEvent> { while (!this.ended || this.queue.length) { const event = this.queue.shift(); if (event) { this.bytes -= Buffer.byteLength(JSON.stringify(event)); yield event; } else await new Promise<void>(resolve => { this.wake = resolve; }); } }
}
