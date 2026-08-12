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
import type { ProtocolError } from "./errors";
import { toProtocolError, isProtocolError } from "./errors";
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
}

interface TurnController {
  readonly key: string;
  readonly native: NativeSessionRef;
  readonly turnId: SpecOpsTurnId;
  lastSeq: number;
  resolveDone: () => void;
  readonly done: Promise<void>;
}

export class HostDispatcher {
  private initialized = false;
  private shuttingDown = false;
  private shouldExitFlag = false;
  private readonly activeTurns = new Map<string, TurnController>();
  private readonly maxConcurrentTurns: number;

  constructor(private readonly deps: HostDispatcherDeps) {
    this.maxConcurrentTurns = deps.maxConcurrentTurns ?? 64;
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
      this.log(`invalid envelope ignored: ${message.reason}`);
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
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`)));
      return;
    }

    if (this.shuttingDown) {
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.SHUTTING_DOWN, "Host is shutting down")));
      return;
    }

    if (method !== RequestMethod.Initialize && method !== RequestMethod.Shutdown && !this.initialized) {
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.NOT_INITIALIZED, "initialize required first")));
      return;
    }

    try {
      await this.route(method, id, request.params);
    } catch (error) {
      this.respond(makeErrorResponse(id, toProtocolError(error)));
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
        this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`)));
    }
  }

  // -- handlers ---------------------------------------------------------------

  private async handleInitialize(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeInitialize(params);
    if (!decoded.ok) {
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INVALID_PARAMS, decoded.reason)));
      return;
    }
    if (decoded.value.protocolVersion !== PROTOCOL_VERSION) {
      this.respond(
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
    this.initialized = true;
    const runtimes = await this.deps.registry.descriptors();
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
    this.respond(makeResponse(id, result));
  }

  private async handleShutdown(id: RequestId): Promise<void> {
    this.respond(makeResponse(id, { ok: true }));
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
    this.respond(makeResponse(id, result));
  }

  private async handleAuth(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeAuth(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const result = await adapter.authenticate(decoded.value);
    this.respond(makeResponse(id, result));
  }

  private async handleCatalogModels(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeCatalogModels(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const models = isCatalogExtension(adapter)
      ? await adapter.listModels({ ...(decoded.value.workspaceRootPath ? { workspaceRootPath: decoded.value.workspaceRootPath } : {}) })
      : [];
    this.respond(makeResponse(id, { models }));
  }

  private async handleCatalogModes(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeCatalogModes(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const modes = isCatalogExtension(adapter)
      ? await adapter.listModes({ ...(decoded.value.modelId ? { modelId: decoded.value.modelId } : {}) })
      : [];
    this.respond(makeResponse(id, { modes }));
  }

  private async handleSessionCreate(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeSessionCreate(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.runtimeId);
    const result = await adapter.createSession(decoded.value);
    this.respond(makeResponse(id, result));
  }

  private async handleSessionResume(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeSessionResume(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    const result = await adapter.resumeSession(decoded.value);
    this.respond(makeResponse(id, result));
  }

  private async handleTurnSend(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeTurnSend(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const value: TurnSendParams = decoded.value;
    const adapter = this.deps.registry.require(value.native.runtimeId);
    const key = this.turnKey(value.native);
    if (this.activeTurns.has(key)) {
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INVALID_PARAMS, `A turn is already active for session ${value.native.nativeSessionId}`)));
      return;
    }
    if (this.activeTurns.size >= this.maxConcurrentTurns) {
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INTERNAL_ERROR, "Too many concurrent turns")));
      return;
    }

    const controller = this.createController(value);
    // Ack first; events are written only after the ack is flushed.
    this.respond(makeResponse(id, { turnId: value.turnId }));
    // Start the pump (fire-and-forget; tracked for cancellation/shutdown).
    void this.pumpTurn(controller, adapter, value);
  }

  private async handleTurnCancel(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeTurnCancel(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    await adapter.cancel(decoded.value);
    this.respond(makeResponse(id, { ok: true }));
  }

  private async handlePermissionReply(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodePermissionReply(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    if (!isPermissionExtension(adapter)) {
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.ADAPTER_ERROR, "runtime does not support permissions", { adapterCode: "capability-not-supported" })));
      return;
    }
    await adapter.replyPermission(decoded.value);
    this.respond(makeResponse(id, { ok: true }));
  }

  private async handleQuestionReply(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeQuestionReply(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const adapter = this.deps.registry.require(decoded.value.native.runtimeId);
    if (!isQuestionExtension(adapter)) {
      this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.ADAPTER_ERROR, "runtime does not support questions", { adapterCode: "capability-not-supported" })));
      return;
    }
    await adapter.replyQuestion(decoded.value);
    this.respond(makeResponse(id, { ok: true }));
  }

  private async handleHealth(id: RequestId, params: unknown): Promise<void> {
    const decoded = decodeHealth(params);
    if (!decoded.ok) return this.invalidParams(id, decoded.reason);
    const result = decoded.value.runtimeId
      ? await this.deps.registry.require(decoded.value.runtimeId).health()
      : await this.deps.registry.health();
    this.respond(makeResponse(id, result));
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
      resolveDone,
      done,
    };
    this.activeTurns.set(key, controller);
    return controller;
  }

  private async pumpTurn(controller: TurnController, adapter: AgentRuntimeAdapter, value: TurnSendParams): Promise<void> {
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
      for await (const event of stream) {
        controller.lastSeq = event.seq;
        await this.writeEvent(value.native.nativeSessionId, event);
      }
    } catch (error) {
      // Adapter stream rejected without a terminal — synthesize turn.failed.
      const reason = error instanceof Error ? error.message : String(error);
      await this.writeEvent(
        value.native.nativeSessionId,
        this.synthesizeFailure(value.native.nativeSessionId, value.turnId, controller.lastSeq + 1, reason),
      );
    } finally {
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
      message,
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
          await this.deps.registry.require(controller.native.runtimeId).cancel({ native: controller.native, turnId: controller.turnId });
        } catch (error) {
          this.log(`cancel failed during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        }
        return controller.done;
      }),
    );
  }

  // -- helpers ----------------------------------------------------------------

  private turnKey(native: NativeSessionRef): string {
    return `${native.runtimeId}:${String(native.nativeSessionId)}`;
  }

  private invalidParams(id: RequestId, reason: string): void {
    this.respond(makeErrorResponse(id, rpcError(ProtocolErrorCode.INVALID_PARAMS, reason)));
  }

  private respond(response: RpcResponse): void {
    try {
      this.writeRaw(JSON.stringify(response) + "\n");
    } catch (error) {
      this.log(`failed to write response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeEvent(nativeSessionId: NativeSessionId, event: SessionEvent): Promise<void> {
    await this.writeNotification(NotificationMethod.SessionEvent, { nativeSessionId, event });
  }

  private async writeNotification(method: string, params: unknown): Promise<void> {
    const payload = JSON.stringify(makeNotification(method, params)) + "\n";
    await this.writeAwaitingDrain(payload);
  }

  private writeRaw(payload: string): void {
    // Synchronous best-effort write for responses (acks/notifications order).
    this.deps.stdout.write(payload);
  }

  private writeAwaitingDrain(payload: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onDrain = (): void => {
        this.deps.stdout.off("drain", onDrain);
        resolve();
      };
      const cb = (error?: Error | null): void => {
        if (error) reject(error);
      };
      try {
        const canContinue = this.deps.stdout.write(payload, cb);
        if (canContinue) {
          resolve();
        } else {
          this.deps.stdout.once("drain", onDrain);
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private log(line: string): void {
    this.deps.stderr?.write(`${line}\n`);
  }
}

// Re-export for callers/tests that build protocol errors directly.
export { toProtocolError, isProtocolError };
export type { ProtocolError, RpcError };
