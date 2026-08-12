/**
 * Frontend Agent Host client (phase F, task AS01-F-03).
 *
 * The single typed bridge between the WebView and the Rust-supervised Agent
 * Host. Every operation goes through a Tauri command (`agent_host_*`); the host
 * process is never spawned, connected to, or imported from the WebView. Host
 * notifications arrive on the `specops/agent-host/event` stream and are fanned
 * out to per-session subscribers.
 *
 * `invoke` and `listen` are injectable so the client is fully unit-testable
 * without a running Tauri app. The default bindings use the real Tauri APIs.
 *
 * No vendor SDK type appears anywhere here — only the runtime-neutral phase B/C
 * domain types (`NativeSessionRef`, `SessionEvent`, …).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentAuthRequest,
  AgentAuthResult,
  AdapterHealth,
  NativeSessionRef,
} from "../adapter";
import type { AgentRuntimeDescriptor, AgentRuntimeId } from "../runtime";
import type {
  AgentModelDescriptor,
  AgentModeDescriptor,
} from "../binding";
import type { NativeSessionId, SpecOpsTurnId } from "../ids";
import { asSpecOpsTurnId, asNativeSessionId } from "../ids";
import type { SessionEvent } from "../events";
import type { PermissionReply } from "../events";

/** Tauri event the Rust bridge forwards host notifications on. */
export const AGENT_HOST_EVENT = "specops/agent-host/event";

export type AgentHostHealthStatus = "unknown" | "starting" | "healthy" | "degraded" | "error";

export interface AgentHostStatus {
  running: boolean;
  health: AgentHostHealthStatus;
  pid: number | null;
  generation: number;
  hostVersion: string | null;
  protocolVersion: number | null;
  restartCount: number;
  lastError: AgentHostClientError | null;
}

/** Mirrors the Rust `AgentHostError` enum (`#[serde(tag = "kind")]`). */
export type AgentHostClientError =
  | { kind: "notRunning"; message: string }
  | { kind: "shuttingDown"; message: string }
  | { kind: "hostPathMissing"; message: string }
  | { kind: "nodeMissing"; message: string }
  | { kind: "launchFailure"; message: string }
  | { kind: "initializeTimeout"; message: string }
  | { kind: "protocolVersionMismatch"; client: number; server: number; message: string }
  | { kind: "requestTimeout"; id: number; message: string }
  | { kind: "hostExited"; code?: number; message: string }
  | { kind: "crashLoop"; message: string }
  | { kind: "protocol"; code: number; message: string; data?: unknown }
  | { kind: "io"; message: string };

/** Notification payload forwarded by the bridge. */
interface HostNotification {
  method: string;
  params?: unknown;
}

/** `session.event` notification params. */
interface SessionEventParams {
  nativeSessionId: string;
  event: SessionEvent;
}

export interface DiscoverResult {
  runtimes: readonly (AgentRuntimeDescriptor & {
    capabilities: {
      schemaVersion: number;
      supported: readonly string[];
      details: Readonly<Record<string, { supported: boolean; limits?: unknown; notes?: string }>>;
    };
  })[];
}

export interface CatalogModelsResult {
  models: readonly AgentModelDescriptor[];
}
export interface CatalogModesResult {
  modes: readonly AgentModeDescriptor[];
}

export interface CreateSessionRequest {
  runtimeId: AgentRuntimeId;
  workspaceRootPath: string;
  modelId?: string;
  modeId?: string;
  capabilities?: readonly string[];
  runtimeMetadata?: Readonly<Record<string, unknown>>;
}

export interface ResumeSessionRequest {
  native: NativeSessionRef;
  workspaceRootPath: string;
}

export interface SendTurnRequest {
  turnId: SpecOpsTurnId;
  native: NativeSessionRef;
  workspaceRootPath: string;
  prompt: string;
  attachments?: unknown;
  context?: Readonly<Record<string, unknown>>;
}

export interface CancelTurnRequest {
  native: NativeSessionRef;
  turnId?: SpecOpsTurnId;
  reason?: "user" | "timeout" | "supervisor";
}

export interface PermissionReplyRequest {
  native: NativeSessionRef;
  turnId: SpecOpsTurnId;
  permissionId: string;
  reply: PermissionReply;
}

export interface QuestionReplyRequest {
  native: NativeSessionRef;
  turnId: SpecOpsTurnId;
  questionId: string;
  answer: string;
}

/** Injectable Tauri bindings (defaults use the real APIs). */
export interface AgentHostBindings {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, handler: (payload: unknown) => void) => Promise<UnlistenFn>;
}

const defaultBindings: AgentHostBindings = {
  invoke: (cmd, args) => invoke(cmd, args),
  listen: (event, handler) => listen<unknown>(event, (e) => handler(e.payload)),
};

/** A per-session subscriber receives every `session.event` for its session. */
type SessionSubscriber = (event: SessionEvent) => void;

export interface AgentHostClient {
  readonly status: AgentHostStatus | null;
  start(): Promise<AgentHostStatus>;
  stop(): Promise<AgentHostStatus>;
  restart(): Promise<AgentHostStatus>;
  getStatus(): Promise<AgentHostStatus>;
  discover(): Promise<DiscoverResult>;
  authenticate(request: AgentAuthRequest): Promise<AgentAuthResult>;
  catalogModels(runtimeId: AgentRuntimeId, workspaceRootPath?: string): Promise<CatalogModelsResult>;
  catalogModes(runtimeId: AgentRuntimeId, modelId?: string): Promise<CatalogModesResult>;
  createSession(request: CreateSessionRequest): Promise<NativeSessionRef>;
  resumeSession(request: ResumeSessionRequest): Promise<NativeSessionRef>;
  health(runtimeId?: AgentRuntimeId): Promise<AdapterHealth>;
  replyPermission(request: PermissionReplyRequest): Promise<void>;
  replyQuestion(request: QuestionReplyRequest): Promise<void>;
  /** Send a turn and yield its event stream until a terminal event. */
  sendTurn(request: SendTurnRequest): AsyncIterable<SessionEvent>;
  cancelTurn(request: CancelTurnRequest): Promise<void>;
}

export function createAgentHostClient(bindings: AgentHostBindings = defaultBindings): AgentHostClient {
  // Fan-out state for session.event notifications. Lazily wired on first use.
  const subscribers = new Map<string, Set<SessionSubscriber>>();
  let listenerPromise: Promise<UnlistenFn> | null = null;

  function nativeKey(nativeSessionId: string): string {
    return nativeSessionId;
  }

  async function ensureListener(): Promise<void> {
    if (listenerPromise !== null) {
      return;
    }
    listenerPromise = bindings.listen(AGENT_HOST_EVENT, (payload) => {
      const notification = payload as HostNotification;
      if (!notification || typeof notification.method !== "string") {
        return;
      }
      if (notification.method === "session.event") {
        const params = notification.params as SessionEventParams | undefined;
        if (!params || typeof params.nativeSessionId !== "string" || !params.event) {
          return;
        }
        const set = subscribers.get(nativeKey(params.nativeSessionId));
        if (set) {
          for (const subscriber of set) {
            subscriber(params.event);
          }
        }
      }
    });
    // Swallow listener setup failures; callers will surface transport errors
    // when they try to use the client. Avoid an unhandled rejection.
    listenerPromise.catch(() => {
      listenerPromise = null;
    });
  }

  function subscribe(nativeSessionId: string, subscriber: SessionSubscriber): () => void {
    const key = nativeKey(nativeSessionId);
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    set.add(subscriber);
    return () => {
      const current = subscribers.get(key);
      if (current) {
        current.delete(subscriber);
        if (current.size === 0) {
          subscribers.delete(key);
        }
      }
    };
  }

  async function request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    return (await bindings.invoke("agent_host_request", {
      method,
      params: params ?? null,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    })) as T;
  }

  let lastStatus: AgentHostStatus | null = null;
  const rememberStatus = (status: AgentHostStatus): AgentHostStatus => {
    lastStatus = status;
    return status;
  };

  return {
    get status() {
      return lastStatus;
    },

    async start() {
      return rememberStatus((await bindings.invoke("agent_host_start")) as AgentHostStatus);
    },
    async stop() {
      return rememberStatus((await bindings.invoke("agent_host_stop")) as AgentHostStatus);
    },
    async restart() {
      return rememberStatus((await bindings.invoke("agent_host_restart")) as AgentHostStatus);
    },
    async getStatus() {
      return rememberStatus((await bindings.invoke("agent_host_status")) as AgentHostStatus);
    },

    async discover() {
      return request<DiscoverResult>("discover");
    },
    async authenticate(req) {
      return request<AgentAuthResult>("auth", req);
    },
    async catalogModels(runtimeId, workspaceRootPath) {
      return request<CatalogModelsResult>("catalog.models", {
        runtimeId,
        ...(workspaceRootPath !== undefined ? { workspaceRootPath } : {}),
      });
    },
    async catalogModes(runtimeId, modelId) {
      return request<CatalogModesResult>("catalog.modes", {
        runtimeId,
        ...(modelId !== undefined ? { modelId } : {}),
      });
    },
    async createSession(req) {
      return request<NativeSessionRef>("session.create", req);
    },
    async resumeSession(req) {
      return request<NativeSessionRef>("session.resume", req);
    },
    async health(runtimeId) {
      return request<AdapterHealth>("health", runtimeId !== undefined ? { runtimeId } : {});
    },
    async replyPermission(req) {
      await request("permission.reply", req);
    },
    async replyQuestion(req) {
      await request("question.reply", req);
    },

    async cancelTurn(req) {
      await request("turn.cancel", req);
    },

    async *sendTurn(req) {
      await ensureListener();
      // Buffer events that arrive before the consumer pulls the next yield, and
      // resolve the stream on exactly one terminal event.
      const queue: SessionEvent[] = [];
      let resolveNext: (() => void) | null = null;
      let terminal = false;
      let terminalError: Error | null = null;

      const unsubscribe = subscribe(req.native.nativeSessionId, (event) => {
        // Only forward events for this turn; other turns on the same session
        // (should not happen concurrently per the contract) are ignored.
        if (!("turnId" in event) || event.turnId !== req.turnId) {
          if (event.type !== "status.changed" && event.type !== "diagnostic") {
            return;
          }
        }
        queue.push(event);
        if (
          event.type === "turn.finished" ||
          event.type === "turn.failed" ||
          event.type === "turn.cancelled"
        ) {
          terminal = true;
        }
        resolveNext?.();
      });

      try {
        // Ack first (the host contract writes the ack before any event).
        await request("turn.send", {
          turnId: req.turnId,
          native: req.native,
          workspaceRootPath: req.workspaceRootPath,
          prompt: req.prompt,
          ...(req.attachments !== undefined ? { attachments: req.attachments } : {}),
          ...(req.context !== undefined ? { context: req.context } : {}),
        });

        while (!terminal) {
          if (queue.length > 0) {
            yield queue.shift() as SessionEvent;
            continue;
          }
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
          resolveNext = null;
          if (terminalError) {
            throw terminalError;
          }
        }
        // Drain any trailing events queued before the terminal.
        while (queue.length > 0) {
          yield queue.shift() as SessionEvent;
        }
      } finally {
        unsubscribe();
      }
    },
  };
}

/** Mint a SpecOps turn id (host + adapter echo it on every turn-scoped event). */
export function newTurnId(): SpecOpsTurnId {
  return asSpecOpsTurnId(`turn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
}

/** Type re-exports for callers that construct native refs from host results. */
export { asNativeSessionId, asSpecOpsTurnId };
export type { NativeSessionId, SpecOpsTurnId };
