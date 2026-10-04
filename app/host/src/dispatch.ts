/**
 * Request dispatch, streaming, cancellation, backpressure, and graceful
 * shutdown (phase D, task AS01-D-03).
 *
 * The dispatcher is the host's core. It classifies incoming JSON-RPC messages,
 * routes requests to adapter methods, writes responses/notifications with
 * deterministic ordering, drives turn streams as `session.event` notifications,
 * and guarantees:
 * - **Correlation.** Every request receives exactly one response (or one error).
 * - **Stream ordering.** The `turn.send` ack is written before any event; events
 *   are written in adapter-emitted order, awaited one at a time so a slow
 *   consumer applies natural pull-based backpressure (memory cannot grow without
 *   bound — the adapter is an `AsyncIterable` and the pump pulls the next event
 *   only after the previous write drains).
 * - **Cancellation.** `turn.cancel` stops the active pump and asks the adapter
 *   to cancel; the adapter emits `turn.cancelled`, which the pump forwards.
 * - **Terminal guarantee.** If an adapter stream rejects mid-flight, the host
 *   synthesizes a `turn.failed` event (seq = last seen + 1) so the UI always
 *   observes exactly one terminal.
 * - **Graceful shutdown.** Every active turn is cancelled and awaited before
 *   shutdown resolves; no pump writes after shutdown.
 */

import {
  ProtocolErrorCode,
  RequestMethod,
  NotificationMethod,
  PROTOCOL_VERSION,
  PROTOCOL_NAME,
  rpcError,
  makeResponse,
  makeErrorResponse,
  makeNotification,
  classifyIncoming,
  isRequestMethod,
  decodeInitialize,
  decodeAuth,
  decodeCatalogModels,
  decodeCatalogModes,
  decodeSessionCreate,
  decodeSessionResume,
  decodeTurnSend,
  decodeTurnCancel,
  decodePermissionReply,
  decodeQuestionReply,
  decodeHealth,
  type RpcError,
  type RpcResponse,
  type RequestId,
  type InitializeResult,
  type DiscoverResult,
  type TurnSendParams,
  type ServerBuildInfo,
} from "./protocol";
import { MAX_MESSAGE_BYTES, DEFAULT_REQUEST_TIMEOUT_MS, INITIALIZE_TIMEOUT_MS, MAX_CONCURRENT_TURNS } from "./protocol";
import { redactForLogs } from "./redact";
import type { ProtocolError } from "./errors";
import { ProtocolError as HostProtocolError, toProtocolError, isProtocolError } from "./errors";
import type { AdapterRegistry } from "./registry";
import type { BuildInfo } from "./version";
import { HOST_VERSION } from "./version";
import type {
  AgentRuntimeAdapter,
  NativeSessionRef,
} from "../../src/lib/session/adapter";
import { isCatalogExtension, isPermissionExtension, isQuestionExtension } from "../../src/lib/session/adapter";
import type { SessionEvent } from "../../src/lib/session/events";
import type { SpecOpsTurnId } from "../../src/lib/session/ids";
import type { NativeSessionId } from "../../src/lib/session/ids";

export interface HostWritable {
  write(chunk: string | Buffer, callback?: (error?: Error | null) => void): boolean;
  once(event: "drain", listener: () => void): unknown;
  off(event: "drain", listener: () => void): unknown;
}

export interface HostDispatcherDeps {
  readonly registry: AdapterRegistry;
  readonly stdout: HostWritable;
  readonly stderr?: { write(line: string): void } | undefined;
  readonly buildInfo: BuildInfo;
  readonly maxConcurrentTurns?: number;
  readonly requestTimeoutMs?: number;
  readonly drainTimeoutMs?: number;
  readonly onTransportFailure?: () => void;
}

interface TurnController {
  readonly key: string;
  readonly native: NativeSessionRef;
  readonly turnId: SpecOpsTurnId;
  lastSeq: number;
  terminal: boolean;
  stopped: boolean;
  resolveDone: () => void;
  readonly done: Promise<void>;
}

export class HostDispatcher {
  private outputTail: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private readonly answered = new Set<RequestId>();
  private initialized = false;
  private shuttingDown = false;
  private shouldExitFlag = false;
  private readonly activeTurns = new Map<string, TurnController>();
  private readonly maxConcurrentTurns: number;

  constructor(private readonly deps: HostDispatcherDeps) {
    this.maxConcurrentTurns = deps.maxConcurrentTurns ?? MAX_CONCURRENT_TURNS;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  get shouldExit(): boolean {
    return this.shouldExitFlag;
  }

  /** Number of turns currently streaming (test/diagnostic observability). */
  get activeTurnCount(): number {
    return this.activeTurns.size;
  }

  async handle(raw: unknown): Promise<void> {
    const message = classifyIncoming(raw);
    if (message.kind === "invalid") {
      const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
      const recovered = typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id)) ? id : null;
      await this.respond(makeErrorResponse(recovered, rpcError(ProtocolErrorCode.INVALID_REQUEST, message.reason)));
      return;
    }
    if (message.kind === "notification") {
      // The host defines no inbound notifications; ignore (and log).
      this.log(`ignoring inbound notification: ${message.notification.method}`);
      return;
    }

    const request = message.request;
    const { id, method } = request;

    if (!isRequestMethod(method)) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`)));
      return;
    }

    if (this.shuttingDown) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.SHUTTING_DOWN, "Host is shutting down")));
      return;
    }

    if (method !== RequestMethod.Initialize && method !== RequestMethod.Shutdown && !this.initialized) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.NOT_INITIALIZED, "initialize required first")));
      return;
    }

    try {
      await this.bounded(this.route(method, id, request.params), this.deps.requestTimeoutMs ?? (method === RequestMethod.Initialize ? INITIALIZE_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS));
    } catch (error) {
      await this.respond(makeErrorResponse(id, toProtocolError(error)));
    }
  }

  private async route(method: string, id: RequestId, params: unknown): Promise<void> {
    switch (method) {
      case RequestMethod.Initialize:
        return this.handleInitialize(id, params);
      case RequestMethod.Shutdown:
        return this.handleShutdown(id);
      case RequestMethod.Discover:
        return this.handleDiscover(id);
      case RequestMethod.Auth:
        return this.handleAuth(id, params);
      case RequestMethod.CatalogModels:
        return this.handleCatalogModels(id, params);
      case RequestMethod.CatalogModes:
        return this.handleCatalogModes(id, params);
      case RequestMethod.SessionCreate:
        return this.handleSessionCreate(id, params);
      case RequestMethod.SessionResume:
        return this.handleSessionResume(id, params);
      case RequestMethod.TurnSend:
        return this.handleTurnSend(id, params);
      case RequestMethod.TurnCancel:
        return this.handleTurnCancel(id, params);
      case RequestMethod.PermissionReply:
        return this.handlePermissionReply(id, params);
      case RequestMethod.QuestionReply:
        return this.handleQuestionReply(id, params);
      case RequestMethod.Health:
        return this.handleHealth(id, params);
      default:
        await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`)));
    }
  }

  // -- handlers ---------------------------------------------------------------

  private async handleInitialize(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeInitialize(params);
    if (!decoded.ok) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INVALID_PARAMS, decoded.reason)));
      return;
    }
    if (decoded.value.protocolVersion !== PROTOCOL_VERSION) {
      await this.respond(
        makeErrorResponse(
          id,
          rpcError(
            ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH,
            `Client protocol ${decoded.value.protocolVersion} != server ${PROTOCOL_VERSION}`,
            { serverProtocolVersion: PROTOCOL_VERSION },
          ),
        ),
      );
      this.shouldExitFlag = true;
      return;
    }
    const runtimes = await this.deps.registry.descriptors();
    this.initialized = true;
    const build: ServerBuildInfo = {
      hostVersion: HOST_VERSION,
      git: this.deps.buildInfo.git,
      time: this.deps.buildInfo.time,
      node: this.deps.buildInfo.node,
    };
    const result: InitializeResult = {
      protocolVersion: PROTOCOL_VERSION,
      server: { name: PROTOCOL_NAME, build, runtimes },
    };
    await this.respond(makeResponse(id, result));
  }

  private async handleShutdown(id: RequestId): Promise<void> {
    await this.respond(makeResponse(id, { ok: true }));
    this.shouldExitFlag = true;
    await this.gracefulShutdown("shutdown requested");
  }

  private async handleDiscover(id: RequestId): Promise<void> {
    const adapters = this.deps.registry.list();
    const entries = await Promise.all(
      adapters.map(async (adapter) => {
        const [descriptor, capabilities] = await Promise.all([adapter.describe(), adapter.describeCapabilities()]);
        return { ...descriptor, capabilities };
      }),
    );
    const result: DiscoverResult = { runtimes: entries };
    await this.respond(makeResponse(id, result));
  }

  private async handleAuth(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeAuth(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const result = await adapter.authenticate(decoded.value);
    await this.respond(makeResponse(id, result));
  }

  private async handleCatalogModels(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeCatalogModels(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const models = isCatalogExtension(adapter)
      ? await adapter.listModels({ ...(decoded.value.workspaceRootPath ? { workspaceRootPath: decoded.value.workspaceRootPath } : {}) })
      : [];
    await this.respond(makeResponse(id, { models }));
  }

  private async handleCatalogModes(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeCatalogModes(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const modes = isCatalogExtension(adapter)
      ? await adapter.listModes({ ...(decoded.value.modelId ? { modelId: decoded.value.modelId } : {}) })
      : [];
    await this.respond(makeResponse(id, { modes }));
  }

  private async handleSessionCreate(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeSessionCreate(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const result = await adapter.createSession(decoded.value);
    await this.respond(makeResponse(id, result));
  }

  private async handleSessionResume(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeSessionResume(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    const result = await adapter.resumeSession(decoded.value);
    await this.respond(makeResponse(id, result));
  }

  private async handleTurnSend(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeTurnSend(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const value: TurnSendParams = decoded.value;
    const adapter = this.deps.registry.require(value.native.runtimeId);
    const key = this.turnKey(value.native);
    if (this.activeTurns.has(key)) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INVALID_PARAMS, `A turn is already active for session ${value.native.nativeSessionId}`)));
      return;
    }
    if (this.activeTurns.size >= this.maxConcurrentTurns) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INTERNAL_ERROR, "Too many concurrent turns")));
      return;
    }

    const controller = this.createController(value);
    // Ack first; events are written only after the ack is flushed.
    await this.respond(makeResponse(id, { turnId: value.turnId }));
    if (this.shouldExitFlag) { this.activeTurns.delete(controller.key); controller.resolveDone(); return; }
    // Start the pump (tracked for cancellation/shutdown).
    void this.pumpTurn(controller, adapter, value).catch((error) => {
      this.log(`turn transport failed: ${String(error)}`);
      this.shouldExitFlag = true;
      this.deps.onTransportFailure?.();
    });
  }

  private async handleTurnCancel(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeTurnCancel(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    const controller = this.activeTurns.get(this.turnKey(decoded.value.native));
    try {
      await this.bounded(adapter.cancel(decoded.value), this.deps.drainTimeoutMs ?? 1000);
      if (controller) await this.bounded(controller.done, this.deps.drainTimeoutMs ?? 1000);
    } catch {
      if (controller && !controller.terminal) {
        await this.writeEvent(controller.native.nativeSessionId, {
          type: "turn.cancelled", nativeSessionId: controller.native.nativeSessionId,
          turnId: controller.turnId, seq: controller.lastSeq + 1, at: new Date().toISOString(),
        });
        controller.terminal = true;
      }
    } finally {
      if (controller) { controller.stopped = true; controller.resolveDone(); this.activeTurns.delete(controller.key); }
    }
    await this.respond(makeResponse(id, { ok: true }));
  }

  private async handlePermissionReply(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodePermissionReply(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    if (!isPermissionExtension(adapter)) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.ADAPTER_ERROR, "runtime does not support permissions", { adapterCode: "capability-not-supported" })));
      return;
    }
    await adapter.replyPermission(decoded.value);
    await this.respond(makeResponse(id, { ok: true }));
  }

  private async handleQuestionReply(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeQuestionReply(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    if (!isQuestionExtension(adapter)) {
      await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.ADAPTER_ERROR, "runtime does not support questions", { adapterCode: "capability-not-supported" })));
      return;
    }
    await adapter.replyQuestion(decoded.value);
    await this.respond(makeResponse(id, { ok: true }));
  }

  private async handleHealth(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeHealth(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const result = decoded.value.runtimeId
      ? await this.deps.registry.require(decoded.value.runtimeId).health()
      : await this.deps.registry.health();
    await this.respond(makeResponse(id, result));
  }

  // -- streaming ---------------------------------------------------------------

  private createController(value: TurnSendParams): TurnController {
    const key = this.turnKey(value.native);
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const controller: TurnController = {
      key,
      native: value.native,
      turnId: value.turnId,
      lastSeq: 0,
      terminal: false,
      stopped: false,
      resolveDone,
      done,
    };
    this.activeTurns.set(key, controller);
    return controller;
  }

  private async pumpTurn(controller: TurnController, adapter: AgentRuntimeAdapter, value: TurnSendParams): Promise<void> {
    let iterator: AsyncIterator<SessionEvent> | undefined;
    try {
      const stream = adapter.send({
        turnId: value.turnId,
        native: value.native,
        workspaceRootPath: value.workspaceRootPath,
        prompt: value.prompt,
        ...(value.attachments !== undefined ? { attachments: value.attachments as never } : {}),
        ...(value.context !== undefined ? { context: value.context } : {}),
      });
      // Forward every event until the stream ends. The adapter contract
      // guarantees a terminal (turn.cancelled on cancel, turn.finished/failed
      // otherwise), which ends this loop; cancellation is delivered via the
      // adapter, not by breaking here, so the UI always receives the terminal.
      iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([iterator.next(), controller.done.then(() => ({ done: true as const, value: undefined }))]);
        if (next.done) break;
        const event = next.value;
        if (controller.stopped) break;
        if (controller.terminal) throw new Error("Adapter emitted an event after terminal");
        controller.terminal = ["turn.finished", "turn.failed", "turn.cancelled"].includes(event.type);
        controller.lastSeq = event.seq;
        await this.writeEvent(value.native.nativeSessionId, event);
      }
      if (!controller.terminal && !controller.stopped) throw new Error("Adapter stream ended without terminal");
    } catch (error) {
      // Adapter stream rejected without a terminal — synthesize turn.failed.
      const reason = error instanceof Error ? error.message : String(error);
      if (controller.terminal || controller.stopped || this.shouldExitFlag) return;
      await this.writeEvent(
        value.native.nativeSessionId,
        this.synthesizeFailure(value.native.nativeSessionId, value.turnId, controller.lastSeq + 1, reason),
      );
    } finally {
      if (controller.stopped) void iterator?.return?.().catch(() => {});
      this.activeTurns.delete(controller.key);
      controller.resolveDone();
    }
  }

  private synthesizeFailure(nativeSessionId: NativeSessionId, turnId: SpecOpsTurnId, seq: number, message: string): SessionEvent {
    return {
      type: "turn.failed",
      nativeSessionId,
      seq,
      at: new Date(0).toISOString(),
      turnId,
      message: redactForLogs(message) as string,
    } as SessionEvent;
  }

  // -- shutdown ---------------------------------------------------------------

  async gracefulShutdown(reason: string): Promise<void> {
    if (this.shuttingDown) {
      // A concurrent caller returns; the in-flight shutdown completes the work.
      return;
    }
    this.shuttingDown = true;
    this.log(`graceful shutdown: ${reason}`);

    // Cancel every active turn; the adapter emits turn.cancelled, pumps drain.
    const controllers = [...this.activeTurns.values()];
    await Promise.all(
      controllers.map(async (controller) => {
        try {
          await this.bounded(this.deps.registry.require(controller.native.runtimeId).cancel({ native: controller.native, turnId: controller.turnId }), this.deps.drainTimeoutMs ?? 1000);
        } catch (error) {
          this.log(`cancel failed during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        }
        try { await this.bounded(controller.done, this.deps.drainTimeoutMs ?? 1000); }
        catch { controller.stopped = true; controller.resolveDone(); this.activeTurns.delete(controller.key); }
      }),
    );
  }

  // -- helpers ----------------------------------------------------------------

  private turnKey(native: NativeSessionRef): string {
    return `${native.runtimeId}:${String(native.nativeSessionId)}`;
  }

  private async invalidParams(id: RequestId, reason: string): Promise<void> {
    await this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INVALID_PARAMS, reason)));
  }

  private async respond(response: RpcResponse): Promise<void> {
    if (response.id !== null) {
      if (this.answered.has(response.id)) return;
      this.answered.add(response.id);
    }
    // IDs are monotonic for the bridge; bounded bookkeeping also supports test peers.
    if (this.answered.size > 4096) this.answered.delete(this.answered.values().next().value!);
    try { await this.enqueue("error" in response ? redactForLogs(response) : response); }
    catch (error) { this.shouldExitFlag = true; this.deps.onTransportFailure?.(); this.log(`failed to write response: ${String(error)}`); }
  }

  private async writeEvent(nativeSessionId: NativeSessionId, event: SessionEvent): Promise<void> {
    const safe = event.type === "diagnostic" || event.type === "turn.failed" ? redactForLogs(event) : event;
    await this.enqueue(makeNotification(NotificationMethod.SessionEvent, { nativeSessionId, event: safe }));
  }

  private enqueue(message: unknown): Promise<void> {
    let payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > MAX_MESSAGE_BYTES) {
      if ("id" in (message as object)) payload = JSON.stringify(makeErrorResponse((message as RpcResponse).id, rpcError(ProtocolErrorCode.INTERNAL_ERROR, "Response exceeds message limit")));
      else return Promise.reject(new Error("Event exceeds message limit"));
    }
    payload += "\n";
    const bytes = Buffer.byteLength(payload);
    if (this.queuedBytes + bytes > 4 * MAX_MESSAGE_BYTES) return Promise.reject(new Error("Output queue capacity exceeded"));
    this.queuedBytes += bytes;
    const next = this.outputTail.then(() => this.writeAwaitingDrain(payload)).catch((error) => {
      this.shouldExitFlag = true;
      this.deps.onTransportFailure?.();
      throw error;
    });
    this.outputTail = next.catch(() => {});
    return next.finally(() => { this.queuedBytes -= bytes; });
  }

  private bounded<T>(work: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HostProtocolError(ProtocolErrorCode.TIMEOUT, "Host operation timed out")), timeout);
      work.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  private writeAwaitingDrain(payload: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.deps.stdout.off("drain", onDrain);
        if (error) reject(error); else resolve();
      };
      const onDrain = (): void => { drained = true; complete(); };
      const timer = setTimeout(() => finish(new Error("Output drain timed out")), this.deps.drainTimeoutMs ?? 1000);
      let returned = false;
      let written = false;
      let drained = false;
      const complete = (): void => { if (returned && written && drained) finish(); };
      try {
        const ready = this.deps.stdout.write(payload, (error) => {
          if (error) { finish(error); return; }
          written = true;
          complete();
        });
        drained = ready;
        returned = true;
        if (!ready && !settled) this.deps.stdout.once("drain", onDrain);
        complete();
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private log(line: string): void {
    this.deps.stderr?.write(`${redactForLogs(line)}\n`);
  }
}

// Re-export for callers/tests that build protocol errors directly.
export { toProtocolError, isProtocolError };
export type { ProtocolError, RpcError };
