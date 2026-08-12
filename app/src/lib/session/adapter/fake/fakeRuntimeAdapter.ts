/**
 * Deterministic fake runtime adapter (phase C, task AS01-C-03).
 *
 * Implements the mandatory {@link AgentRuntimeAdapter} plus the extensions a
 * UI needs to exercise: catalog, permission, question, lifecycle, checkpoint,
 * configuration, todos, diffs, diagnostics. All behavior is driven by a
 * declarative {@link FakeRuntimeConfig}; there is no network, clock drift
 * (a fixed timestamp is used), or vendor binary, so the contract suite and the
 * phase F E2E can reproduce every common UI state without races.
 *
 * Restart: native session state lives in memory for the adapter's lifetime.
 * `resumeSession` recovers an existing id, or (when `failResumeUnknown` is off)
 * adopts an unknown id so restart-recovery can be simulated. `seq` is monotonic
 * per native session across turns and resume.
 */

import type {
  AgentAuthResult,
  AgentRuntimeCapabilities,
  AdapterHealth,
  AdapterHealthStatus,
  CancelAgentTurnRequest,
  CreateAgentSessionRequest,
  NativeSessionRef,
  ResumeAgentSessionRequest,
  AgentTurnRequest,
  AgentCatalogSummary,
} from "../adapter";
import { AGENT_CAPABILITY_SCHEMA_VERSION } from "../adapter";
import type { AgentRuntimeAdapter } from "../adapter";
import type { AgentRuntimeDescriptor } from "../../runtime";
import { adapterErrors } from "../errors";
import type {
  CheckpointExtension,
  CatalogExtension,
  ConfigurationExtension,
  DiffsExtension,
  DiagnosticsExtension,
  LifecycleExtension,
  PermissionExtension,
  QuestionExtension,
  TodosExtension,
  AgentConfigurationSchema,
  NativeTodoEntry,
} from "../extensions";
import { inferCapabilities } from "../extensions";
import type { AgentCapabilityValue } from "../../capabilities";
import type {
  AgentModelDescriptor,
  AgentModeDescriptor,
} from "../../binding";
import type { NativeSessionId, SpecOpsTurnId } from "../../ids";
import { asNativeSessionId } from "../../ids";
import type { DiffSnapshot, SessionEvent } from "../../events";
import type { DiagnosticEvent } from "../../transcript";
import {
  toMalformedDiagnostic,
  toUnknownNativeDiagnostic,
} from "../../redact";
import type { FakeRuntimeConfig, FakeScriptedEvent, FakeTurnScript } from "./fakeScript";

const FAKE_NOW = "1970-01-01T00:00:00.000Z";
const FAKE_NATIVE_PREFIX = "fake-native-";

interface FakeSessionState {
  readonly nativeSessionId: NativeSessionId;
  seq: number;
  parentSessionId?: NativeSessionId;
  readonly diffs: DiffSnapshot[];
  readonly diagnostics: DiagnosticEvent[];
}

interface ReplyWaiter {
  readonly resolve: (value: { readonly cancelled: boolean }) => void;
}

interface ActiveTurn {
  readonly turnId: SpecOpsTurnId;
  readonly state: FakeSessionState;
  cancelled: boolean;
  readonly cancelResolvers: Array<() => void>;
  readonly replyWaiters: Map<string, ReplyWaiter>;
}

export interface FakeRuntimeAdapter extends
  AgentRuntimeAdapter,
  CatalogExtension,
  PermissionExtension,
  QuestionExtension,
  LifecycleExtension,
  CheckpointExtension,
  ConfigurationExtension,
  TodosExtension,
  DiffsExtension,
  DiagnosticsExtension {
  /** Test/inspection helper: number of native sessions currently held. */
  readonly sessionCount: number;
  /** Test/inspection helper: true when a turn is currently streaming. */
  readonly hasActiveTurn: boolean;
}

export function createFakeRuntimeAdapter(config: FakeRuntimeConfig = {}): FakeRuntimeAdapter {
  const tick = config.tick ?? true;
  const sessions = new Map<string, FakeSessionState>();
  const activeTurns = new Map<string, ActiveTurn>(); // keyed by nativeSessionId
  let sessionCounter = 0;
  let checkpointCounter = 0;

  function now(): string {
    return FAKE_NOW;
  }

  function getSession(nativeSessionId: NativeSessionId): FakeSessionState {
    const state = sessions.get(nativeSessionId);
    if (!state) {
      throw adapterErrors.sessionNotFound(nativeSessionId);
    }
    return state;
  }

  function nextSeq(state: FakeSessionState): number {
    state.seq += 1;
    return state.seq;
  }

  function core(state: FakeSessionState): Pick<SessionEvent, "nativeSessionId" | "seq" | "at"> {
    return { nativeSessionId: state.nativeSessionId, seq: nextSeq(state), at: now() };
  }

  function resolveScript(prompt: string): FakeTurnScript {
    const key = prompt.trim();
    const turns = config.turns ?? {};
    if (Object.prototype.hasOwnProperty.call(turns, key)) {
      return turns[key];
    }
    return (
      config.defaultTurn ?? { events: [{ kind: "text", text: "ok" }], outcome: { outcome: "finish" } }
    );
  }

  function models(): AgentModelDescriptor[] {
    return config.models ? [...config.models] : [{ id: "fake-model", name: "Fake Model" }];
  }

  function modes(): AgentModeDescriptor[] {
    return config.modes ? [...config.modes] : [{ id: "default", name: "Default" }];
  }

  function emitScripted(
    state: FakeSessionState,
    turnId: SpecOpsTurnId,
    scripted: FakeScriptedEvent,
  ): SessionEvent[] {
    switch (scripted.kind) {
      case "text":
        return [{ ...core(state), type: "text.finished", turnId, text: scripted.text } as SessionEvent];
      case "text.delta":
        return [{ ...core(state), type: "text.delta", turnId, delta: scripted.delta } as SessionEvent];
      case "reasoning":
        return [{
          ...core(state),
          type: "reasoning.ended",
          turnId,
          reasoningId: scripted.id,
          text: scripted.text,
        } as SessionEvent];
      case "tool": {
        const status = scripted.status ?? "success";
        const started: SessionEvent = {
          ...core(state),
          type: "tool.started",
          turnId,
          toolCall: {
            callId: scripted.callId,
            toolName: scripted.toolName,
            status,
            ...(scripted.input !== undefined ? { input: scripted.input } : {}),
          },
        } as SessionEvent;
        if (status === "pending" || status === "running") {
          return [started];
        }
        const completed: SessionEvent = {
          ...core(state),
          type: "tool.completed",
          turnId,
          callId: scripted.callId,
          status,
          ...(scripted.output !== undefined ? { output: scripted.output } : {}),
        } as SessionEvent;
        return [started, completed];
      }
      case "usage":
        return [{
          ...core(state),
          type: "usage.recorded",
          turnId,
          usage: scripted.usage,
          ...(scripted.cost !== undefined ? { cost: scripted.cost } : {}),
        } as SessionEvent];
      case "diff": {
        const event: SessionEvent = { ...core(state), type: "diff.posted", turnId, diff: scripted.diff } as SessionEvent;
        state.diffs.push(scripted.diff);
        return [event];
      }
      case "step": {
        const kind =
          scripted.step.phase === "failed" ? "step.failed" : scripted.step.phase === "finished" ? "step.finished" : "step.started";
        return [{ ...core(state), type: kind, turnId, step: scripted.step } as SessionEvent];
      }
      case "subtask":
        return [{ ...core(state), type: "subtask.started", turnId, subtask: scripted.subtask } as SessionEvent];
      case "attachment":
        return [{ ...core(state), type: "attachment.posted", turnId, attachment: scripted.attachment } as SessionEvent];
      case "status":
        return [{ ...core(state), type: "status.changed", status: scripted.status } as SessionEvent];
      case "permission":
        return [{
          ...core(state),
          type: "permission.requested",
          turnId,
          request: {
            permissionId: scripted.permissionId,
            label: scripted.label,
            ...(scripted.payload !== undefined ? { payload: scripted.payload } : {}),
          },
        } as SessionEvent];
      case "question":
        return [{
          ...core(state),
          type: "question.requested",
          turnId,
          request: {
            questionId: scripted.questionId,
            prompt: scripted.prompt,
            ...(scripted.choices ? { choices: scripted.choices } : {}),
            ...(scripted.payload !== undefined ? { payload: scripted.payload } : {}),
          },
        } as SessionEvent];
      case "diagnostic": {
        const event: SessionEvent = {
          ...core(state),
          type: "diagnostic",
          level: scripted.level,
          message: scripted.message,
          ...(scripted.reason ? { reason: scripted.reason } : {}),
          ...(scripted.raw !== undefined ? { redactedRaw: scripted.raw } : {}),
        } as SessionEvent;
        state.diagnostics.push(event as DiagnosticEvent);
        return [event];
      }
      case "unknown-native": {
        const event = toUnknownNativeDiagnostic({
          nativeSessionId: state.nativeSessionId,
          seq: nextSeq(state),
          at: now(),
          raw: scripted.raw,
          message: scripted.message,
        });
        state.diagnostics.push(event);
        return [event];
      }
      case "malformed": {
        const event = toMalformedDiagnostic({
          nativeSessionId: state.nativeSessionId,
          seq: nextSeq(state),
          at: now(),
          raw: scripted.raw,
          message: scripted.message,
        });
        state.diagnostics.push(event);
        return [event];
      }
      default: {
        const _exhaustive: never = scripted;
        void _exhaustive;
        return [];
      }
    }
  }

  const adapter: FakeRuntimeAdapter = {
    runtimeId: "fake",

    get sessionCount() {
      return sessions.size;
    },

    get hasActiveTurn() {
      return activeTurns.size > 0;
    },

    async describe(): Promise<AgentRuntimeDescriptor> {
      return { id: "fake", label: "Fake Runtime", dev: true };
    },

    async describeCapabilities(): Promise<AgentRuntimeCapabilities> {
      const inferred = inferCapabilities(adapter);
      const supported: AgentCapabilityValue[] = config.capabilities ? [...config.capabilities] : inferred;
      const unique = Array.from(new Set(supported));
      const details = Object.fromEntries(unique.map((capability) => [capability, { supported: true }])) as AgentRuntimeCapabilities["details"];
      return { schemaVersion: AGENT_CAPABILITY_SCHEMA_VERSION, supported: unique, details };
    },

    async authenticate(): Promise<AgentAuthResult> {
      const auth = config.auth ?? { status: "not-required" as const };
      if (auth.fail) {
        if (auth.fail === "authentication-failed") {
          throw adapterErrors.authenticationFailed(auth.fail);
        }
        throw adapterErrors.authenticationRequired(auth.fail);
      }
      if (auth.status === "challenge") {
        return { status: "challenge", ...(auth.challenge ? { challenge: auth.challenge } : {}) };
      }
      return { status: auth.status };
    },

    async describeCatalog(): Promise<AgentCatalogSummary> {
      return {
        models: models(),
        modes: modes(),
        ...(config.defaultModelId ? { defaultModelId: config.defaultModelId } : {}),
        ...(config.defaultModeId ? { defaultModeId: config.defaultModeId } : {}),
      };
    },

    async createSession(request: CreateAgentSessionRequest): Promise<NativeSessionRef> {
      if (config.failCreate) {
        throw adapterErrors.runtimeUnavailable(config.failCreate);
      }
      sessionCounter += 1;
      const nativeSessionId = asNativeSessionId(`${FAKE_NATIVE_PREFIX}${sessionCounter}`);
      sessions.set(nativeSessionId, {
        nativeSessionId,
        seq: 0,
        diffs: [],
        diagnostics: [],
      });
      return {
        runtimeId: "fake",
        nativeSessionId,
        ...(request.modelId ? { modelId: request.modelId } : {}),
        ...(request.modeId ? { modeId: request.modeId } : {}),
        ...(request.runtimeMetadata ? { runtimeMetadata: request.runtimeMetadata } : {}),
      };
    },

    async resumeSession(request: ResumeAgentSessionRequest): Promise<NativeSessionRef> {
      const id = request.native.nativeSessionId;
      if (!sessions.has(id)) {
        if (config.failResumeUnknown) {
          throw adapterErrors.sessionNotFound(id);
        }
        sessions.set(id, { nativeSessionId: id, seq: 0, diffs: [], diagnostics: [] });
      }
      return { ...request.native };
    },

    async *send(request: AgentTurnRequest): AsyncIterable<SessionEvent> {
      const state = getSession(request.native.nativeSessionId);
      if (activeTurns.has(state.nativeSessionId)) {
        throw adapterErrors.internal("A turn is already active for this session");
      }
      const active: ActiveTurn = {
        turnId: request.turnId,
        state,
        cancelled: false,
        cancelResolvers: [],
        replyWaiters: new Map(),
      };
      activeTurns.set(state.nativeSessionId, active);

      const cancelSignal = new Promise<void>((resolve) => {
        active.cancelResolvers.push(resolve);
      });

      try {
        yield { ...core(state), type: "turn.started", turnId: request.turnId } as SessionEvent;

        const script = resolveScript(request.prompt);
        for (const scripted of script.events ?? []) {
          if (active.cancelled) break;
          if (tick) await Promise.resolve();
          if (active.cancelled) break;
          // For gated permission/question events, register the reply waiter
          // BEFORE yielding so a reply received immediately after the event is
          // emitted resolves it (the consumer sees the event, then replies).
          let replyAwait: Promise<{ readonly cancelled: boolean }> | null = null;
          if (
            (scripted.kind === "permission" || scripted.kind === "question") &&
            script.awaitReply &&
            !active.cancelled
          ) {
            const replyId = scripted.kind === "permission" ? scripted.permissionId : scripted.questionId;
            replyAwait = prepareReply(active, replyId, cancelSignal);
          }
          for (const event of emitScripted(state, request.turnId, scripted)) {
            yield event;
          }
          if (replyAwait) {
            const result = await replyAwait;
            if (result.cancelled) active.cancelled = true;
            if (active.cancelled) break;
          }
          if (active.cancelled) break;
        }

        if (!active.cancelled) {
          const outcome = script.outcome ?? { outcome: "finish" as const };
          if (outcome.outcome === "hang") {
            await cancelSignal;
          }
        }

        if (active.cancelled) {
          yield { ...core(state), type: "turn.cancelled", turnId: request.turnId } as SessionEvent;
        } else {
          const outcome = script.outcome ?? { outcome: "finish" as const };
          if (outcome.outcome === "fail") {
            yield { ...core(state), type: "turn.failed", turnId: request.turnId, message: outcome.message } as SessionEvent;
          } else {
            yield { ...core(state), type: "turn.finished", turnId: request.turnId } as SessionEvent;
          }
        }
      } finally {
        activeTurns.delete(state.nativeSessionId);
      }
    },

    async cancel(request: CancelAgentTurnRequest): Promise<void> {
      const active = activeTurns.get(request.native.nativeSessionId);
      if (!active) return;
      if (request.turnId && request.turnId !== active.turnId) return;
      active.cancelled = true;
      for (const resolve of active.cancelResolvers) resolve();
      active.cancelResolvers.length = 0;
      for (const waiter of active.replyWaiters.values()) waiter.resolve({ cancelled: true });
      active.replyWaiters.clear();
    },

    async health(): Promise<AdapterHealth> {
      return {
        status: (config.healthStatus ?? "healthy") as AdapterHealthStatus,
        runtimeId: "fake",
        ...(config.runtimeVersion ? { runtimeVersion: config.runtimeVersion } : {}),
        ...(config.healthMessage ? { message: config.healthMessage } : {}),
        checkedAt: now(),
      };
    },

    // -- CatalogExtension --
    async listModels(): Promise<readonly AgentModelDescriptor[]> {
      return models();
    },
    async listModes(): Promise<readonly AgentModeDescriptor[]> {
      return modes();
    },

    // -- PermissionExtension --
    async replyPermission(input): Promise<void> {
      settleReply(activeTurns.get(input.native.nativeSessionId), input.permissionId, false);
    },

    // -- QuestionExtension --
    async replyQuestion(input): Promise<void> {
      settleReply(activeTurns.get(input.native.nativeSessionId), input.questionId, false);
    },
    async rejectQuestion(input): Promise<void> {
      settleReply(activeTurns.get(input.native.nativeSessionId), input.questionId, true);
    },

    // -- LifecycleExtension --
    async interrupt(input): Promise<void> {
      await adapter.cancel({ native: input.native });
    },
    async restart(input): Promise<NativeSessionRef> {
      return { ...input.native };
    },

    // -- CheckpointExtension --
    async forkSession(input): Promise<NativeSessionRef> {
      const parent = getSession(input.native.nativeSessionId);
      sessionCounter += 1;
      const childId = asNativeSessionId(`${FAKE_NATIVE_PREFIX}${sessionCounter}`);
      sessions.set(childId, {
        nativeSessionId: childId,
        seq: 0,
        parentSessionId: parent.nativeSessionId,
        diffs: [],
        diagnostics: [],
      });
      return { ...input.native, nativeSessionId: childId };
    },
    async rewind(): Promise<void> {
      // Deterministic no-op: the fake has no real history.
    },
    async checkpoint(): Promise<{ readonly checkpointId: string }> {
      checkpointCounter += 1;
      return { checkpointId: `fake-checkpoint-${checkpointCounter}` };
    },

    // -- ConfigurationExtension --
    async describeConfiguration(): Promise<AgentConfigurationSchema> {
      return { schemaVersion: 1, fields: [] };
    },
    async applyConfiguration(): Promise<void> {
      // Deterministic no-op.
    },

    // -- TodosExtension --
    async listTodos(): Promise<readonly NativeTodoEntry[]> {
      return [];
    },

    // -- DiffsExtension --
    async listDiffs(input): Promise<readonly DiffSnapshot[]> {
      return [...getSession(input.native.nativeSessionId).diffs];
    },

    // -- DiagnosticsExtension --
    async collectDiagnostics(input): Promise<readonly DiagnosticEvent[]> {
      const state = getSession(input.native.nativeSessionId);
      const since = input.sinceSeq ?? 0;
      return state.diagnostics.filter((entry) => entry.seq > since);
    },
  };

  function settleReply(active: ActiveTurn | undefined, replyId: string, cancelled: boolean): void {
    if (!active) return;
    const waiter = active.replyWaiters.get(replyId);
    if (waiter) {
      active.replyWaiters.delete(replyId);
      waiter.resolve({ cancelled });
    }
  }

  function prepareReply(
    active: ActiveTurn,
    replyId: string,
    cancelSignal: Promise<void>,
  ): Promise<{ readonly cancelled: boolean }> {
    return new Promise<{ readonly cancelled: boolean }>((resolve) => {
      let settled = false;
      const finish = (cancelled: boolean) => {
        if (settled) return;
        settled = true;
        active.replyWaiters.delete(replyId);
        resolve({ cancelled });
      };
      active.replyWaiters.set(replyId, { resolve: (value) => finish(value.cancelled) });
      cancelSignal.then(() => finish(true));
    });
  }

  return adapter;
}
