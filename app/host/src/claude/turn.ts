import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTurnRequest } from "../../../src/lib/session/adapter";
import type { SessionEvent } from "../../../src/lib/session/events";
import {
  redactForSerialization,
  redactSecretStringValue,
} from "../../../src/lib/session/redact";
import type { ClaudeProcessOwner } from "./session";
type Payload = SessionEvent extends infer E
  ? E extends SessionEvent
    ? Omit<E, "nativeSessionId" | "connectionProfileId" | "seq" | "at">
    : never
  : never;
export class ClaudeTurn {
  readonly abort = new AbortController();
  query?: Query;
  ended = false;
  private finishing = false;
  private capacityFailure = false;
  private reasoning = new Set<string>();
  private queue: SessionEvent[] = [];
  private bytes = 0;
  private retained = 0;
  private wake?: () => void;
  private seen = new Set<string>();
  private texts = new Map<string, string>();
  private carries = new Map<string, { text: string; reasoning: boolean }>();
  private streamed = new Set<string>();
  private messageId = "";
  private settling?: Promise<void>;
  private failureMessage = "Native turn failed or was interrupted; resume explicitly.";
  private timer: ReturnType<typeof setTimeout>;
  constructor(
    readonly request: AgentTurnRequest,
    readonly userId: string,
    readonly generation: number,
    readonly key: string,
    readonly owner: ClaudeProcessOwner,
    private nextSeq: () => number,
    private valid: () => boolean,
    private cost: (total: number) => number,
    timeout: number,
  ) {
    this.emit({ type: "turn.started", turnId: request.turnId });
    this.timer = setTimeout(() => void this.stop("turn.failed"), timeout);
  }
  private clean(value: unknown, maxLength = Infinity): unknown {
    const redact = (v: unknown): unknown =>
      typeof v === "string"
        ? v.replaceAll(this.key, "[REDACTED]").slice(0, maxLength)
        : Array.isArray(v)
          ? v.map(redact)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [
                  k.replaceAll(this.key, "[REDACTED]"),
                  redact(x),
                ]),
              )
            : v;
    return redactForSerialization(redact(value), Infinity);
  }
  isCurrent() { return this.valid(); }
  emit(payload: Payload) {
    if (this.ended) return;
    const event = {
      ...(this.clean(payload) as Payload),
      nativeSessionId: this.request.native.nativeSessionId,
      connectionProfileId: this.request.native.connectionProfileId,
      nativeGeneration: this.generation,
      nativeTurnId: this.userId,
      seq: this.nextSeq(),
      at: new Date().toISOString(),
    } as SessionEvent;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (
      !payload.type.startsWith("turn.") &&
      (this.queue.length >= 4094 || this.bytes + bytes > 4 * 1024 * 1024 - 4096)
    ) {
      this.capacityFailure = true;
      this.carries.clear();
      this.texts.clear();
      if (!this.finishing) void this.stop("turn.failed");
      return;
    }
    this.queue.push(event);
    this.bytes += bytes;
    this.wake?.();
    this.wake = undefined;
  }
  private delta(id: string, delta: string, reasoning: boolean) {
    if (reasoning) this.reasoning.add(id);
    const prior = this.carries.get(id)?.text ?? "";
    const text = prior + delta;
    if (
      text.length > 16384 &&
      Math.max(
        text.lastIndexOf(" "),
        text.lastIndexOf("\n"),
        text.lastIndexOf("\t"),
      ) <
        text.length - 8192
    ) {
      this.carries.clear();
      this.texts.clear();
      void this.stop("turn.failed");
      return;
    }
    this.texts.set(id, (this.texts.get(id) ?? "") + delta);
    let end =
      Math.max(
        text.lastIndexOf(" "),
        text.lastIndexOf("\n"),
        text.lastIndexOf("\t"),
      ) + 1;
    const prefix = text
      .slice(0, end)
      .match(
        /(?:Bearer|["']?[\w-]*(?:token|secret)["']?|["']?(?:password|api[_-]?key)["']?)\s*(?:[=:]\s*["']?)?$/i,
      );
    if (prefix?.index !== undefined) end = prefix.index;
    // An arbitrary private key may split across native deltas: retain a suffix
    // at least as long as the key, even when it contains whitespace.
    const safePrefix = text.slice(
      0,
      Math.max(0, text.length - this.key.length),
    );
    end = Math.min(
      end,
      Math.max(
        safePrefix.lastIndexOf(" "),
        safePrefix.lastIndexOf("\n"),
        safePrefix.lastIndexOf("\t"),
      ) + 1,
    );
    const match = text.indexOf(this.key);
    if (match >= 0 && match < end && match + this.key.length > end) end = match;
    if (end) this.write(id, text.slice(0, end), reasoning);
    this.carries.set(id, { text: text.slice(end), reasoning });
  }
  private write(id: string, text: string, reasoning: boolean) {
    const value = redactSecretStringValue(
      text.replaceAll(this.key, "[REDACTED]"),
      Infinity,
    );
    this.emit(
      reasoning
        ? {
            type: "reasoning.delta",
            turnId: this.request.turnId,
            reasoningId: id,
            delta: value,
            nativeItemId: id,
          }
        : {
            type: "text.delta",
            turnId: this.request.turnId,
            delta: value,
            nativeItemId: id,
          },
    );
  }
  event(raw: unknown) {
    if (this.ended) return;
    if (!this.valid()) {
      void this.stop("turn.failed");
      return;
    }
    let count = 0;
    const bounded = (value: unknown, depth = 0): boolean => {
      if (++count > 20000 || depth > 32) return false;
      if (typeof value === "string") return value.length <= 4 * 1024 * 1024;
      if (value && typeof value === "object")
        return Object.values(value).every((v) => bounded(v, depth + 1));
      return true;
    };
    if (!bounded(raw)) {
      this.emit({
        type: "diagnostic",
        level: "warn",
        reason: "malformed",
        message: "Malformed or over-capacity native event",
      });
      void this.stop("turn.failed");
      return;
    }
    const m = raw as any;
    if (
      !m ||
      typeof m !== "object" ||
      m.session_id !== this.request.native.nativeSessionId
    ) {
      void this.stop("turn.failed");
      return;
    }
    this.retained += Buffer.byteLength(JSON.stringify(m));
    if (this.retained > 8 * 1024 * 1024 || this.seen.size > 16000) {
      void this.stop("turn.failed");
      return;
    }
    if (m.user_message_uuid && m.user_message_uuid !== this.userId) {
      void this.stop("turn.failed");
      return;
    }
    const dedup = m.uuid;
    if (dedup && m.type !== "stream_event") {
      if (this.seen.has(dedup)) return;
      this.seen.add(dedup);
    }
    const turnId = this.request.turnId;
    const malformed = () => {
      this.emit({
        type: "diagnostic",
        level: "warn",
        reason: "malformed",
        message: "Malformed native session event",
      });
    };
    const validId = (value: unknown) =>
      typeof value === "string" && value.length > 0 && value.length <= 500;
    const finite = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (m.type === "system" && m.subtype === "init") {
      this.emit({ type: "status.changed", status: "running" });
      return;
    }
    if (m.type === "stream_event") {
      const e = m.event;
      if (!e || typeof e.type !== "string") {
        malformed();
        return;
      }
      if (e.type === "message_start") {
        if (!validId(e.message?.id)) {
          malformed();
          return;
        }
        this.messageId = e.message.id;
      }
      const id = `${this.messageId}:${e?.index ?? 0}`;
      if (e?.type === "content_block_delta") {
        if (
          e.delta?.type === "text_delta" ||
          e.delta?.type === "thinking_delta"
        ) {
          if (
            !this.messageId ||
            typeof (e.delta.text ?? e.delta.thinking) !== "string" ||
            !Number.isSafeInteger(e.index) ||
            e.index < 0
          ) {
            malformed();
            return;
          }
          this.streamed.add(id);
          this.delta(
            id,
            e.delta.text ?? e.delta.thinking,
            e.delta.type === "thinking_delta",
          );
        }
      }
      return;
    }
    if (m.type === "assistant") {
      if (m.error) {
        this.nativeFailure(m.error);
        void this.stop("turn.failed");
        return;
      }
      if (!validId(m.message?.id) || !Array.isArray(m.message?.content)) {
        malformed();
        void this.stop("turn.failed");
        return;
      }
      for (const [index, block] of m.message.content.entries()) {
        const id = `${m.message.id}:${index}`;
        if (block.type === "text" || block.type === "thinking") {
          const text = block.text ?? block.thinking;
          if (typeof text !== "string") {
            malformed();
            void this.stop("turn.failed");
            return;
          }
          if (!this.streamed.has(id))
            this.delta(id, text, block.type === "thinking");
          if (block.type === "thinking")
            this.emit({
              type: "reasoning.ended",
              turnId,
              reasoningId: id,
              text,
              nativeItemId: id,
            });
        } else if (block.type === "tool_use") {
          if (
            !validId(block.id) ||
            !validId(block.name) ||
            !block.input ||
            typeof block.input !== "object" ||
            Array.isArray(block.input)
          ) {
            malformed();
            void this.stop("turn.failed");
            return;
          }
          this.emit({
            type: "tool.started",
            turnId,
            toolCall: {
              callId: block.id,
              toolName: block.name,
              status: "running",
              input: block.input,
            },
            nativeItemId: block.id,
          });
        }
      }
      return;
    }
    if (m.type === "user") {
      for (const block of Array.isArray(m.message?.content)
        ? m.message.content
        : [])
        if (block.type === "tool_result")
          this.emit({
            type: "tool.completed",
            turnId,
            callId: block.tool_use_id,
            status: block.is_error ? "failure" : "success",
            output: block.content,
            nativeItemId: block.tool_use_id,
          });
      return;
    }
    if (m.type === "tool_progress") {
      if (!validId(m.tool_use_id) || !finite(m.elapsed_time_seconds)) {
        malformed();
        return;
      }
      this.emit({
        type: "tool.progress",
        turnId,
        callId: m.tool_use_id,
        progress: { seconds: m.elapsed_time_seconds },
        nativeItemId: m.tool_use_id,
      });
      return;
    }
    if (m.type === "result") {
      const u = m.usage ?? {};
      if (!finite(m.total_cost_usd)) {
        malformed();
        void this.stop("turn.failed");
        return;
      }

      if (
        [
          u.input_tokens,
          u.output_tokens,
          u.cache_read_input_tokens ?? 0,
          u.cache_creation_input_tokens ?? 0,
        ].every(finite)
      )
        this.emit({
          type: "usage.recorded",
          turnId,
          usage: {
            input: u.input_tokens,
            output: u.output_tokens,
            reasoning: 0,
            cache: {
              read: u.cache_read_input_tokens ?? 0,
              write: u.cache_creation_input_tokens ?? 0,
            },
          },
          cost: Number.isFinite(m.total_cost_usd)
            ? this.cost(m.total_cost_usd)
            : undefined,
        });
      if (m.subtype === "error_max_turns") this.failureMessage = "Native turn limit reached. Explicit resume keeps this session limit; create a new session to choose another limit.";
      if (m.subtype === "error_max_budget_usd") this.failureMessage = "Native query budget reached. Explicit resume keeps this session budget; create a new session to choose another budget.";
      this.finish(
        m.subtype === "success" && !m.is_error
          ? "turn.finished"
          : "turn.failed",
      );
      return;
    }
    this.emit({
      type: "diagnostic",
      level: "info",
      reason: "unknown-native",
      message: "Unmapped native session event",
      redactedRaw: redactForSerialization(this.clean(m, 2048), 2048),
    });
  }
  private nativeFailure(error: unknown) {
    // Only pinned SDK categories select recovery text. Native payloads never become UI errors.
    const messages: Record<string, string> = {
      authentication_failed: "Selected profile authentication was rejected. Verify its API key, then resume explicitly.",
      oauth_org_not_allowed: "Selected authentication is not supported. Use the selected profile API key.",
      cloud_credential_error: "Selected authentication is not supported. Use the selected profile API key.",
      account_on_hold: "Selected account is on hold. Resolve its account status, then resume explicitly.",
      verification_required: "Selected account requires verification. Resolve its account status, then resume explicitly.",
      billing_error: "Selected account billing or quota prevented this turn. Check that account, then resume explicitly.",
      rate_limit: "Selected account is rate limited. Wait before explicitly resuming this session.",
      overloaded: "Native service is overloaded. Wait before explicitly resuming this session.",
      server_error: "Native service failed. Check connectivity, then resume explicitly.",
      invalid_request: "Native request was rejected. Check the selected model and session settings before resuming.",
      model_not_found: "Selected model is unavailable. Review model access; the existing session binding remains unchanged.",
      max_output_tokens: "Native output limit interrupted this turn. Resume explicitly to continue.",
    };
    if (typeof error === "string" && Object.hasOwn(messages, error)) this.failureMessage = messages[error]!;
  }
  finish(type: "turn.finished" | "turn.failed" | "turn.cancelled") {
    if (this.ended || this.finishing) return;
    this.finishing = true;
    clearTimeout(this.timer);
    // Reserve terminal before flushing: capacity failure during flush must not recurse.
    const carries = [...this.carries];
    this.carries.clear();
    for (const [id, c] of carries) this.write(id, c.text, c.reasoning);
    if (this.ended) return;
    const text = [...this.texts]
      .filter(([id]) => !this.reasoning.has(id))
      .map(([, text]) => text)
      .join("");
    if (text)
      this.emit({ type: "text.finished", turnId: this.request.turnId, text });
    if (this.ended) return;
    if (this.capacityFailure) type = "turn.failed";
    this.emit(
      type === "turn.failed"
        ? {
            type,
            turnId: this.request.turnId,
            message: this.failureMessage,
          }
        : { type, turnId: this.request.turnId },
    );
    this.ended = true;
    this.abort.abort();
    this.wake?.();
    this.wake = undefined;
  }
  settle(): Promise<void> {
    if (!this.settling)
      this.settling = (async () => {
        this.abort.abort();
        try {
          this.query?.close();
        } catch {}
        await this.owner.close();
      })();
    return this.settling;
  }
  async stop(type: "turn.failed" | "turn.cancelled" = "turn.cancelled") {
    this.finish(type);
    await this.settle();
  }
  async *events(): AsyncIterable<SessionEvent> {
    while (!this.ended || this.queue.length) {
      const event = this.queue.shift();
      if (event) {
        this.bytes -= Buffer.byteLength(JSON.stringify(event));
        yield event;
      } else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}
