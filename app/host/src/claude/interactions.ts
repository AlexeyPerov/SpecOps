import { randomUUID } from "node:crypto";
import type { CanUseTool, OnUserDialog, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionReply } from "../../../src/lib/session/events";
import type { ClaudeTurn } from "./turn";
const denied = (): PermissionResult => ({ behavior: "deny", message: "Native interaction denied, cancelled or expired." });
interface Pending { kind: "permission" | "question"; resolve(value: unknown): void; always: boolean; }
/** Callback handles exist only in this native process epoch. Never persist/replay approvals. */
export class ClaudeInteractions {
  private pending = new Map<string, Pending>();
  private seen = new Set<string>();
  constructor(readonly turn: ClaudeTurn, readonly timeoutMs = 120000) {}
  private live() { return !this.turn.ended && !this.turn.abort.signal.aborted && this.turn.isCurrent(); }
  private wait(kind: Pending["kind"], nativeId: string, signal: AbortSignal, payload: any, always = false): Promise<unknown> {
    if (!this.live() || signal.aborted || this.pending.size || this.seen.has(nativeId) || this.seen.size >= 256) return Promise.resolve(undefined);
    this.seen.add(nativeId);
    const id = `${this.turn.generation}:${randomUUID()}`;
    return new Promise(resolve => {
      let finished = false;
      const done = (value?: unknown) => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort); this.turn.abort.signal.removeEventListener("abort", abort); this.pending.delete(id); resolve(value); };
      const abort = () => { done(); if (!this.turn.abort.signal.aborted && !this.turn.ended) void this.turn.stop("turn.failed"); };
      const timer = setTimeout(() => { done(); void this.turn.stop("turn.failed"); }, this.timeoutMs);
      this.pending.set(id, {kind, resolve: done, always});
      signal.addEventListener("abort", abort, {once: true});
      this.turn.abort.signal.addEventListener("abort", abort, {once: true});
      this.turn.emit(kind === "permission" ? {type: "permission.requested", turnId: this.turn.request.turnId, request: { permissionId: id, label: payload.label, payload: {...payload, allowAlways: always} }} : {type: "question.requested", turnId: this.turn.request.turnId, request: {questionId: id, ...payload}});
      if (!this.live() || signal.aborted) done();
    });
  }
  readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    if (!this.live() || options.signal.aborted || typeof options.requestId !== "string" || !options.requestId || options.requestId.length > 500 || typeof options.toolUseID !== "string" || !options.toolUseID || options.toolUseID.length > 500 || ((options as any).requiresUserInteraction === true && toolName !== "AskUserQuestion")) return denied();
    if (typeof toolName !== "string" || [options.title, options.description, options.blockedPath].some(v => v !== undefined && typeof v !== "string")) return denied();
    let count = 0;
    const bounded = (v: unknown, depth = 0): boolean => ++count <= 4000 && depth <= 24 && (!(v && typeof v === "object") || Object.values(v).every(x => bounded(x, depth + 1)));
    const display = {input, title: options.title, description: options.description, blockedPath: options.blockedPath, suggestions: options.suggestions};
    try { if (!bounded(display) || Buffer.byteLength(JSON.stringify(display)) > 65536 || !/^[A-Za-z][A-Za-z0-9_]{0,199}$/.test(toolName)) return denied(); } catch { return denied(); }
    if (toolName === "AskUserQuestion") {
      const questions = input.questions as any;
      if (!Array.isArray(questions) || !questions.length || questions.length > 4) return denied();
      if (questions.some(q => !q || typeof q.question !== "string" || !q.question || q.question.length > 4000 || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4 || q.options.some((o: any) => typeof o?.label !== "string" || !o.label || o.label.length > 500) || typeof q.multiSelect !== "boolean" || new Set(q.options.map((o: any) => o.label)).size !== q.options.length)) return denied();
      if (new Set(questions.map(q => q.question)).size !== questions.length) return denied();
      const answers: Record<string, string> = Object.create(null);
      for (const [index, q] of questions.entries()) {
        const answer = await this.wait("question", `${options.requestId}:${index}`, options.signal, {prompt: q.question, choices: q.options.map((o: any) => o.label), payload: { multiSelect: q.multiSelect, options: q.options, answerFormat: "text", allowFreeText: true }});
        if (typeof answer !== "string" || !this.live()) return denied();
        answers[q.question] = answer;
      }
      return {behavior: "allow", updatedInput: {...input, answers}, toolUseID: options.toolUseID};
    }
    // Do not transform broader persistent/native mode/directory updates into session approval.
    const suggestions = options.suggestions ?? [];
    const safe = (p: PermissionUpdate) => p && p.type === "addRules" && p.destination === "session" && p.behavior === "allow" && Array.isArray(p.rules) && p.rules.length > 0 && p.rules.length <= 16 && p.rules.every(r => r && r.toolName === toolName && typeof r.ruleContent === "string" && r.ruleContent.length > 0 && r.ruleContent.length <= 4096);
    const updates = suggestions.length > 0 && suggestions.length <= 16 && suggestions.every(safe) && !options.suppressAlwaysAllowRule ? structuredClone(suggestions) : [];
    const reply = await this.wait("permission", options.requestId, options.signal, {label: options.title ?? `Allow native ${toolName}?`, toolName, input, description: options.description, blockedPath: options.blockedPath, sessionRuleScope: updates}, updates.length > 0);
    if (!this.live() || !["once", "always"].includes(String(reply))) return denied();
    return {behavior: "allow", updatedInput: input, toolUseID: options.toolUseID, ...(reply === "always" ? {updatedPermissions: updates} : {})};
  };
  /** No dialog payload renderer has a pinned schema in this build. Fail closed and declare no kinds. */
  readonly onUserDialog: OnUserDialog = async () => ({behavior: "cancelled"});
  reply(id: string, kind: Pending["kind"], value?: PermissionReply | string) {
    const request = this.pending.get(id);
    if (!this.live() || !request || request.kind !== kind) throw new Error("Native interaction expired or belongs to another turn");
    if (kind === "permission" && (!['once', 'always', 'reject'].includes(String(value)) || (value === "always" && !request.always))) throw new Error("Native persistent approval is unavailable for this request");
    if (kind === "question" && value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 16384)) throw new Error("Invalid native question answer");
    request.resolve(value);
  }
}
