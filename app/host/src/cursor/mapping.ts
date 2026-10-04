import type { SessionEvent } from "../../../src/lib/session/events";
import { redactForSerialization } from "../redact";
export function cursorSafe<T>(value: T, key: string): T {
  const clean = (v: unknown): unknown => typeof v === "string"
    ? (key ? v.replaceAll(key, "[REDACTED]") : v)
    : Array.isArray(v) ? v.map(clean)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [(key ? k.replaceAll(key, "[REDACTED]") : k), clean(x)])) : v;
  return redactForSerialization(clean(value), Infinity) as T;
}
type Payload = SessionEvent extends infer E ? E extends SessionEvent ? Omit<E, "nativeSessionId" | "connectionProfileId" | "seq" | "at"> : never : never;
/** Pinned native assistant/thinking messages are deltas, not cumulative snapshots. */
export class CursorMapper {
  text = "";
  reasoning = "";
  private carries = new Map<string, string>();
  private tools = new Set<string>();
  private bytes = 0;
  constructor(readonly agentId: string, readonly runId: string, readonly turnId: any, readonly key: string) {}
  private delta(delta: string, reasoning: boolean): Payload[] {
    if (typeof delta !== "string") throw new Error("Malformed native text");
    this.bytes += Buffer.byteLength(delta);
    if (this.bytes > 8388608) throw new Error("Native turn state exceeds capacity");
    if (reasoning) this.reasoning += delta; else this.text += delta;
    const id = reasoning ? "reasoning" : "text";
    const text = (this.carries.get(id) ?? "") + delta;
    if (text.length > 16384 && Math.max(text.lastIndexOf(" "), text.lastIndexOf("\n"), text.lastIndexOf("\t")) < text.length - 8192) throw new Error("Native text token exceeds capacity");
    let end = Math.max(text.lastIndexOf(" "), text.lastIndexOf("\n"), text.lastIndexOf("\t")) + 1;
    const prefix = text.slice(0, end).match(/(?:Bearer|["']?[\w-]*(?:token|secret)["']?|["']?(?:password|api[_-]?key)["']?)\s*(?:[=:]\s*["']?)?$/i);
    if (prefix?.index !== undefined) end = prefix.index;
    const safePrefix = text.slice(0, Math.max(0, text.length - this.key.length));
    end = Math.min(end, Math.max(safePrefix.lastIndexOf(" "), safePrefix.lastIndexOf("\n"), safePrefix.lastIndexOf("\t")) + 1);
    const match = text.indexOf(this.key);
    if (match >= 0 && match < end && match + this.key.length > end) end = match;
    this.carries.set(id, text.slice(end));
    if (!end) return [];
    const safe = cursorSafe(text.slice(0, end), this.key);
    return [reasoning ? { type: "reasoning.delta", turnId: this.turnId, reasoningId: this.runId + ":reasoning", delta: safe } : { type: "text.delta", turnId: this.turnId, delta: safe }];
  }
  event(raw: any): Payload[] {
    if (!raw || raw.agent_id !== this.agentId || raw.run_id !== this.runId) throw new Error("Native event routing mismatch");
    if (Buffer.byteLength(JSON.stringify(raw)) > 1048576) throw new Error("Native event exceeds capacity");
    const m = cursorSafe(raw, this.key);
    switch (m.type) {
      case "assistant": {
        if (!Array.isArray(raw.message?.content)) throw new Error("Malformed native assistant");
        return raw.message.content.flatMap((b: any) => b.type === "text" ? this.delta(b.text, false) : [{ type: "diagnostic", level: "warn", reason: "unknown-native", message: "Unsupported native assistant block" }]);
      }
      case "thinking":
        if (typeof raw.thinking_duration_ms === "number") return [{ type: "reasoning.ended", turnId: this.turnId, reasoningId: this.runId + ":reasoning", text: cursorSafe(this.reasoning, this.key) }];
        return this.delta(raw.text, true);
      case "tool_call": {
        if (typeof m.call_id !== "string" || m.call_id.length > 500 || typeof m.name !== "string" || !["running", "completed", "error"].includes(m.status)) throw new Error("Malformed native tool");
        const events: Payload[] = [];
        if (!this.tools.has(m.call_id)) {
          if (this.tools.size >= 4096) throw new Error("Native tools exceed capacity");
          this.tools.add(m.call_id);
          events.push({ type: "tool.started", turnId: this.turnId, nativeItemId: m.call_id, toolCall: { callId: m.call_id, toolName: m.name, status: "running", input: m.args } });
        }
        if (m.status === "running") events.push({ type: "tool.progress", turnId: this.turnId, callId: m.call_id, progress: { args: m.args, truncated: m.truncated } });
        else events.push({ type: "tool.completed", turnId: this.turnId, nativeItemId: m.call_id, callId: m.call_id, status: m.status === "completed" ? "success" : "failure", output: m.result });
        return events;
      }
      case "usage": {
        const u = m.usage;
        if (!u || [u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, u.reasoningTokens ?? 0].some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("Malformed native usage");
        return [{ type: "usage.recorded", turnId: this.turnId, usage: { input: u.inputTokens, output: u.outputTokens, reasoning: u.reasoningTokens ?? 0, cache: { read: u.cacheReadTokens, write: u.cacheWriteTokens } } }];
      }
      case "status": {
        if (!["CREATING", "RUNNING", "FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(m.status)) throw new Error("Malformed native status");
        return ["CREATING", "RUNNING"].includes(m.status) ? [{ type: "status.changed", status: "running" }] : [];
      }
      case "system": case "user": case "request": return [];
      default: return [{ type: "diagnostic", level: "info", reason: "unknown-native", message: "Unmapped native event", redactedRaw: { type: typeof m.type === "string" ? m.type.slice(0, 100) : "unknown" } }];
    }
  }
  finish(): Payload[] {
    this.carries.clear();
    return [
      ...(this.reasoning ? [{ type: "reasoning.ended" as const, turnId: this.turnId, reasoningId: this.runId + ":reasoning", text: cursorSafe(this.reasoning, this.key) }] : []),
      { type: "text.finished", turnId: this.turnId, text: cursorSafe(this.text, this.key) },
    ];
  }
}
