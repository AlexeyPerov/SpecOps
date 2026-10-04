import { randomUUID } from "node:crypto";
import type { AgentTurnRequest } from "../../../src/lib/session/adapter";
import type {
  SessionEvent,
  PermissionReply,
} from "../../../src/lib/session/events";
import {
  redactForSerialization,
  redactSecretStringValue,
} from "../../../src/lib/session/redact";
import type { RuntimeConnection } from "./lifecycle";
export const record = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
type Payload = SessionEvent extends infer E
  ? E extends SessionEvent
    ? Omit<E, "nativeSessionId" | "connectionProfileId" | "seq" | "at">
    : never
  : never;
interface Interaction {
  nativeId: string;
  kind: "permission" | "question";
  keys: string[];
  answers: string[][];
  timer: ReturnType<typeof setTimeout>;
}
/** A single native session prompt: bounded queue/state, correlated replies and one terminal. */
export class OpenCodeTurn {
  readonly abort = new AbortController();
  readonly generation: number;
  ended = false;
  needsSettlement = false;
  private finishing = false;
  private capacityFailure = false;
  private queue: SessionEvent[] = [];
  private bytes = 0;
  private stateBytes = 0;
  private wake?: () => void;
  private seen = new Set<string>();
  private messages = new Set<string>();
  private completedMessages = new Set<string>();
  private snapshots = new Map<string, string>();
  private texts = new Map<string, string>();
  private carries = new Map<
    string,
    { text: string; write: (text: string) => void }
  >();
  private pending = new Map<string, Interaction>();
  private usage = new Set<string>();
  private settling?: Promise<void>;
  private deadline: ReturnType<typeof setTimeout>;
  constructor(
    readonly request: AgentTurnRequest,
    readonly connection: RuntimeConnection,
    readonly messageId: string,
    private nextSeq: () => number,
    readonly timeoutMs = 300000,
  ) {
    this.generation = connection.generation;
    this.emit({ type: "turn.started", turnId: request.turnId });
    this.deadline = setTimeout(() => {
      void this.stop("turn.cancelled");
    }, timeoutMs);
  }
  emit(payload: Payload): void {
    if (this.ended) return;
    const event = {
      ...(redactForSerialization(payload, Infinity) as Payload),
      nativeSessionId: this.request.native.nativeSessionId,
      connectionProfileId: this.request.native.connectionProfileId,
      nativeGeneration: this.generation,
      nativeTurnId: this.messageId,
      seq: this.nextSeq(),
      at: new Date().toISOString(),
    } as SessionEvent;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (
      !["turn.finished", "turn.failed", "turn.cancelled"].includes(
        payload.type,
      ) &&
      (this.queue.length >= 4094 || this.bytes + bytes > 4 * 1024 * 1024 - 4096)
    ) {
      this.capacityFailure = true;
      if (this.finishing) return;
      this.carries.clear();
      this.texts.clear();
      this.finish(
        "turn.failed",
        "Native event capacity exceeded; resume explicitly.",
      );
      return;
    }
    this.queue.push(event);
    this.bytes += bytes;
    this.wake?.();
    this.wake = undefined;
  }
  private retain(value: string): boolean {
    this.stateBytes += Buffer.byteLength(value);
    if (
      this.stateBytes > 8 * 1024 * 1024 ||
      this.snapshots.size + this.seen.size > 20000
    ) {
      this.finish(
        "turn.failed",
        "Native turn capacity exceeded; resume explicitly.",
      );
      return false;
    }
    return true;
  }
  /** Keep incomplete lexical atoms private, including split credential labels. */
  private stream(
    key: string,
    delta: string,
    write: (text: string) => void,
  ): void {
    if (!this.retain(delta)) return;
    const text = (this.carries.get(key)?.text ?? "") + delta;
    let end =
      Math.max(
        text.lastIndexOf(" "),
        text.lastIndexOf("\n"),
        text.lastIndexOf("\t"),
      ) + 1;
    const prefix = text
      .slice(0, end)
      .match(
        /(?:Bearer|["']?[\w-]*(?:token|secret)["']?|["']?(?:password|api[_-]?key|device[_-]?code|user[_-]?code|authUrl|verificationUrl)["']?)\s*(?:[=:]\s*["']?)?$/i,
      );
    if (prefix?.index !== undefined) end = prefix.index;
    if (end) write(redactSecretStringValue(text.slice(0, end), Infinity));
    this.carries.set(key, { text: text.slice(end), write });
  }
  finish(
    type: "turn.finished" | "turn.failed" | "turn.cancelled",
    message?: string,
  ): void {
    if (this.ended || this.finishing) return;
    this.finishing = true;
    clearTimeout(this.deadline);
    for (const { text, write } of this.carries.values())
      write(redactSecretStringValue(text, Infinity));
    this.carries.clear();
    if (this.texts.size)
      this.emit({
        type: "text.finished",
        turnId: this.request.turnId,
        text: [...this.texts.values()].join(""),
      });
    for (const interaction of new Set(this.pending.values()))
      clearTimeout(interaction.timer);
    this.pending.clear();
    if (this.capacityFailure) {
      type = "turn.failed";
      message = "Native event capacity exceeded; resume explicitly.";
    }
    this.emit(
      type === "turn.failed"
        ? {
            type,
            turnId: this.request.turnId,
            message: message ?? "Native turn interrupted; resume explicitly.",
          }
        : { type, turnId: this.request.turnId },
    );
    this.ended = true;
    if (type !== "turn.finished") {
      this.needsSettlement = true;
      void this.settleNative();
    }
    this.abort.abort();
    this.wake?.();
    this.wake = undefined;
  }
  async stop(
    type: "turn.failed" | "turn.cancelled" = "turn.cancelled",
  ): Promise<void> {
    this.finish(type);
    await this.settleNative();
  }
  settleNative(force = false): Promise<void> {
    if (this.settling && !force) return this.settling;
    if (
      this.connection.generation !== this.generation ||
      !this.connection.client
    )
      return Promise.resolve();
    this.settling = this.connection.client.session
      .abort(
        {
          sessionID: this.request.native.nativeSessionId,
          directory: this.request.workspaceRootPath,
        },
        { signal: AbortSignal.timeout(750) },
      )
      .then(
        () => {},
        () => this.connection.close(),
      );
    return this.settling;
  }
  event(raw: unknown): void {
    if (
      this.ended ||
      this.generation !== this.connection.generation ||
      !record(raw) ||
      !record(raw.properties)
    )
      return;
    const p = raw.properties;
    const session = p.sessionID ?? p.part?.sessionID ?? p.info?.sessionID;
    if (session !== this.request.native.nativeSessionId) return;
    if (typeof raw.type !== "string") {
      this.emit({
        type: "diagnostic",
        level: "warn",
        reason: "malformed",
        message: "Malformed native session event",
      });
      return;
    }
    if (typeof raw.id === "string") {
      if (this.seen.has(raw.id)) return;
      this.seen.add(raw.id);
    }
    if (!this.retain(JSON.stringify(raw))) return;
    if (raw.type === "message.updated" && record(p.info)) {
      if (p.info.role === "assistant" && p.info.parentID === this.messageId)
        this.messages.add(p.info.id);
      if (this.messages.has(p.info.id) && p.info.time?.completed)
        this.completedMessages.add(p.info.id);
      if (
        p.info.role === "assistant" &&
        this.messages.has(p.info.id) &&
        p.info.error
      )
        this.finish(
          "turn.failed",
          "Native provider request failed; resume explicitly.",
        );
      return;
    }
    if (raw.type === "session.status") {
      if (
        p.status?.type === "idle" &&
        this.messages.size &&
        this.completedMessages.size === this.messages.size
      )
        this.finish("turn.finished");
      else if (p.status?.type === "retry")
        this.emit({
          type: "diagnostic",
          level: "warn",
          message: "Native request is retrying.",
        });
      else if (p.status?.type === "busy")
        this.emit({ type: "status.changed", status: "running" });
      return;
    }
    if (raw.type === "session.idle") {
      if (
        this.messages.size &&
        this.completedMessages.size === this.messages.size
      )
        this.finish("turn.finished");
      return;
    }
    if (raw.type === "session.error") {
      this.finish("turn.failed", "Native session failed; resume explicitly.");
      return;
    }
    if (raw.type === "session.compacted") {
      this.emit({ type: "compaction.applied", removedMessageCount: 0 });
      return;
    }
    if (raw.type === "permission.asked" || raw.type === "question.asked") {
      if (!p.tool?.messageID || !this.messages.has(p.tool.messageID)) {
        this.emit({
          type: "diagnostic",
          level: "warn",
          reason: "malformed",
          message: "Uncorrelated native interaction; resume explicitly.",
        });
        return;
      }
      this.interaction(
        p,
        raw.type === "permission.asked" ? "permission" : "question",
      );
      return;
    }
    if (
      ["permission.replied", "question.replied", "question.rejected"].includes(
        raw.type,
      )
    ) {
      for (const entry of new Set(this.pending.values()))
        if (entry.nativeId === p.requestID) this.remove(entry);
      return;
    }
    if (
      raw.type === "message.part.updated" &&
      record(p.part) &&
      this.messages.has(p.part.messageID)
    ) {
      this.part(p.part);
      return;
    }
    if (
      raw.type === "message.part.delta" &&
      this.messages.has(p.messageID) &&
      p.field === "text" &&
      typeof p.delta === "string"
    ) {
      // Snapshot updates are authoritative; deltas without a known part cannot be safely classified.
      const key = p.partID;
      const snapshot = this.snapshots.get(key);
      if (snapshot) {
        const part = JSON.parse(snapshot);
        if (["text", "reasoning"].includes(part.type)) {
          part.text = (part.text ?? "") + p.delta;
          this.part(part);
        }
      }
      return;
    }
    this.emit({
      type: "diagnostic",
      level: "info",
      reason: "unknown-native",
      message: "Unmapped native session event",
      redactedRaw: redactForSerialization(raw, 2048),
    });
  }
  part(p: Record<string, any>): void {
    if (this.ended) return;
    if (
      typeof p.id !== "string" ||
      !p.id ||
      typeof p.type !== "string" ||
      !this.validPart(p)
    ) {
      this.finish(
        "turn.failed",
        "Malformed native message part; cached history was preserved.",
      );
      return;
    }
    if (!this.retain(JSON.stringify(p))) return;
    const serialized = JSON.stringify(p);
    const old = this.snapshots.get(p.id);
    if (old === serialized) return;
    this.snapshots.set(p.id, serialized);
    const previous = old ? JSON.parse(old) : undefined;
    const turnId = this.request.turnId;
    const nativeItemId = p.id;
    if (
      (p.type === "text" || p.type === "reasoning") &&
      typeof p.text === "string"
    ) {
      const prior = previous?.text ?? "";
      const delta = p.text.startsWith(prior) ? p.text.slice(prior.length) : "";
      if (p.type === "text") this.texts.set(p.id, p.text);
      if (delta)
        this.stream(p.id, delta, (value) =>
          this.emit(
            p.type === "text"
              ? { type: "text.delta", turnId, delta: value, nativeItemId }
              : {
                  type: "reasoning.delta",
                  turnId,
                  reasoningId: p.id,
                  delta: value,
                  nativeItemId,
                },
          ),
        );
      if (p.time?.end && !previous?.time?.end && p.type === "reasoning") {
        this.carries.delete(p.id);
        this.emit({
          type: "reasoning.ended",
          turnId,
          reasoningId: p.id,
          text: p.text,
          nativeItemId,
        });
      }
    } else if (p.type === "tool" && record(p.state)) {
      const state = p.state;
      if (!previous)
        this.emit({
          type: "tool.started",
          turnId,
          toolCall: {
            callId: p.callID,
            toolName: p.tool,
            status: "running",
            input: state.input,
          },
          nativeItemId,
        });
      if (
        ["completed", "error"].includes(state.status) &&
        !["completed", "error"].includes(previous?.state?.status)
      )
        this.emit({
          type: "tool.completed",
          turnId,
          callId: p.callID,
          status: state.status === "error" ? "failure" : "success",
          output: state.output ?? state.error,
          nativeItemId,
        });
      else if (state.status === "running")
        this.emit({
          type: "tool.progress",
          turnId,
          callId: p.callID,
          progress: state.title ?? "Running native tool",
          nativeItemId,
        });
      if (
        p.tool === "task" &&
        (!previous || state.status !== previous.state?.status)
      ) {
        const subtask = {
          id: p.callID,
          agent: String(state.input?.subagent_type ?? "native"),
          description: state.input?.description,
          status:
            state.status === "completed"
              ? ("completed" as const)
              : state.status === "error"
                ? ("failed" as const)
                : ("running" as const),
          output: state.output,
          error: state.error,
        };
        this.emit({
          type:
            subtask.status === "completed"
              ? "subtask.completed"
              : subtask.status === "failed"
                ? "subtask.failed"
                : "subtask.started",
          turnId,
          subtask,
          nativeItemId,
        });
      }
    } else if (p.type === "step-start" && !previous)
      this.emit({
        type: "step.started",
        turnId,
        step: { id: p.id, phase: "started" },
        nativeItemId,
      });
    else if (p.type === "step-finish" && !previous) {
      this.emit({
        type: "step.finished",
        turnId,
        step: {
          id: p.id,
          phase: "finished",
          reason: p.reason,
          cost: p.cost,
          tokens: p.tokens,
        },
        nativeItemId,
      });
      if (record(p.tokens) && !this.usage.has(p.id)) {
        this.usage.add(p.id);
        this.emit({
          type: "usage.recorded",
          turnId,
          usage:
            p.tokens as import("../../../src/lib/session/events").UsageSnapshot,
          cost: p.cost,
          nativeItemId,
        });
      }
    } else if (p.type === "subtask" && !previous)
      this.emit({
        type: "subtask.started",
        turnId,
        subtask: {
          id: p.id,
          agent: p.agent,
          description: p.description,
          prompt: p.prompt,
          status: "running",
        },
        nativeItemId,
      });
    else if (p.type === "patch" && !previous)
      this.emit({
        type: "diff.posted",
        turnId,
        diff: { id: p.id, files: p.files },
        nativeItemId,
      });
    else if (p.type === "file" && !previous)
      this.emit({
        type: "attachment.posted",
        turnId,
        attachment: {
          id: p.id,
          mime: p.mime,
          url: p.url,
          filename: p.filename,
        },
        nativeItemId,
      });
    else if (
      ![
        "text",
        "reasoning",
        "tool",
        "step-start",
        "step-finish",
        "patch",
        "subtask",
        "file",
      ].includes(p.type)
    )
      this.emit({
        type: "diagnostic",
        level: "info",
        reason: "unknown-native",
        message: "Unmapped native message part",
      });
  }
  private validPart(p: Record<string, any>): boolean {
    const usage = (v: any) =>
      record(v) &&
      ["input", "output", "reasoning"].every(
        (k) => Number.isFinite(v[k]) && v[k] >= 0,
      ) &&
      record(v.cache) &&
      ["read", "write"].every(
        (k) => Number.isFinite(v.cache[k]) && v.cache[k] >= 0,
      );
    if (["text", "reasoning"].includes(p.type))
      return typeof p.text === "string";
    if (p.type === "tool")
      return (
        typeof p.callID === "string" &&
        typeof p.tool === "string" &&
        record(p.state) &&
        ["pending", "running", "completed", "error"].includes(p.state.status) &&
        record(p.state.input) &&
        (p.state.status !== "completed" ||
          typeof p.state.output === "string") &&
        (p.state.status !== "error" || typeof p.state.error === "string")
      );
    if (p.type === "step-finish")
      return (
        usage(p.tokens) &&
        Number.isFinite(p.cost) &&
        p.cost >= 0 &&
        typeof p.reason === "string"
      );
    if (p.type === "subtask")
      return ["agent", "description", "prompt"].every(
        (k) => typeof p[k] === "string",
      );
    if (p.type === "patch")
      return (
        Array.isArray(p.files) &&
        p.files.every((v: any) => typeof v === "string")
      );
    if (p.type === "file")
      return typeof p.mime === "string" && typeof p.url === "string";
    return true;
  }
  private interaction(p: Record<string, any>, kind: Interaction["kind"]): void {
    if (
      typeof p.id !== "string" ||
      [...this.pending.values()].some((i) => i.nativeId === p.id)
    )
      return;
    if (
      this.pending.size > 128 ||
      (kind === "question" &&
        (!Array.isArray(p.questions) ||
          !p.questions.length ||
          p.questions.length > 32))
    ) {
      void this.stop("turn.failed");
      return;
    }
    const entry: Interaction = {
      nativeId: p.id,
      kind,
      keys: [],
      answers: [],
      timer: setTimeout(() => {
        void this.stop();
      }, this.timeoutMs),
    };
    const questions = kind === "question" ? p.questions : [null];
    questions.forEach((q: any, index: number) => {
      const key = randomUUID();
      entry.keys.push(key);
      this.pending.set(key, entry);
      this.emit(
        kind === "permission"
          ? {
              type: "permission.requested",
              turnId: this.request.turnId,
              request: {
                permissionId: key,
                label: String(p.permission),
                payload: { patterns: p.patterns, scope: "native" },
              },
            }
          : {
              type: "question.requested",
              turnId: this.request.turnId,
              request: {
                questionId: key,
                prompt: String(q.question),
                choices: q.options?.map((o: any) => String(o.label)),
                payload: { index, header: q.header },
              },
            },
      );
    });
  }
  private remove(entry: Interaction): void {
    clearTimeout(entry.timer);
    for (const key of entry.keys) this.pending.delete(key);
  }
  async reply(
    key: string,
    kind: Interaction["kind"],
    answer?: string | PermissionReply,
  ): Promise<void> {
    const entry = this.pending.get(key);
    if (
      !entry ||
      entry.kind !== kind ||
      this.ended ||
      this.generation !== this.connection.generation
    )
      throw new Error("Native interaction expired or belongs to another turn");
    const parameters = {
      requestID: entry.nativeId,
      directory: this.request.workspaceRootPath,
    };
    if (kind === "permission") {
      this.remove(entry);
      await this.connection.client!.permission.reply({
        ...parameters,
        reply: answer as PermissionReply,
      });
    } else if (answer === undefined) {
      this.remove(entry);
      await this.connection.client!.question.reject(parameters);
    } else {
      const index = entry.keys.indexOf(key);
      if (entry.answers[index]) throw new Error("Question already answered");
      entry.answers[index] = [answer];
      if (entry.answers.filter(Boolean).length === entry.keys.length) {
        this.remove(entry);
        await this.connection.client!.question.reply({
          ...parameters,
          answers: entry.answers,
        });
      }
    }
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
