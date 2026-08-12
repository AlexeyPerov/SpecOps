/**
 * Versioned JSON-RPC 2.0 protocol for the Agent Host (phase D, task AS01-D-02).
 *
 * Transport: newline-delimited JSON over stdio (see ./framing). The host
 * receives requests + notifications and emits responses + notifications (it
 * never sends requests). Method coverage: initialize/version negotiation,
 * discovery, auth, catalogs, sessions, turns, replies, cancel, events, health,
 * shutdown.
 *
 * Schemas are versioned ({@link PROTOCOL_VERSION}); incompatible versions fail
 * during initialization with {@link PROTOCOL_VERSION_MISMATCH}. Message limits,
 * timeouts, and explicit protocol errors are defined here and enforced by the
 * framing and dispatch layers.
 */

import type {
  AgentAuthChallenge,
  AgentAuthResult,
  AgentAuthStatus,
  AgentCredentialHandle,
  AgentCatalogSummary,
  AdapterHealth,
  AgentRuntimeCapabilities,
  CancelReason,
  NativeSessionRef,
} from "../../src/lib/session/adapter";
import type { AgentRuntimeDescriptor, AgentRuntimeId } from "../../src/lib/session/runtime";
import type { NativeSessionId, SpecOpsTurnId } from "../../src/lib/session/ids";
import type { SessionEvent } from "../../src/lib/session/events";
import type { PermissionReply } from "../../src/lib/session/events";
import {
  asNativeSessionId,
  asSpecOpsTurnId,
  isAgentRuntimeId,
} from "../../src/lib/session";

// ---------------------------------------------------------------------------
// Constants — limits, timeouts, version
// ---------------------------------------------------------------------------

export const PROTOCOL_NAME = "specops.agent-host";
export const PROTOCOL_VERSION = 1 as const;

/** Maximum size of a single framed message (1 MiB). */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

/** Default request timeout (adapters may override per method). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** initialize must complete within this window. */
export const INITIALIZE_TIMEOUT_MS = 10_000;

/** Safety cap on concurrent active turns (backpressure guard). */
export const MAX_CONCURRENT_TURNS = 64;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ProtocolErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  PROTOCOL_VERSION_MISMATCH: -32000,
  MESSAGE_TOO_LARGE: -32001,
  TIMEOUT: -32002,
  CANCELLED: -32003,
  SHUTTING_DOWN: -32004,
  NOT_INITIALIZED: -32005,
  ADAPTER_ERROR: -32006,
} as const;

export type ProtocolErrorCodeValue = (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode];

export interface RpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export function rpcError(code: number, message: string, data?: unknown): RpcError {
  return { code, message, ...(data !== undefined ? { data } : {}) };
}

/** Data shape carried on ADAPTER_ERROR responses ({@link AdapterError.code}). */
export interface AdapterErrorData {
  readonly adapterCode: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Message envelopes
// ---------------------------------------------------------------------------

export type RequestId = number | string;

export interface RpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: RequestId;
  readonly method: string;
  readonly params?: unknown;
}

export interface RpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: RequestId;
  readonly result?: unknown;
  readonly error?: RpcError;
}

export interface RpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export function makeResponse(id: RequestId, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function makeErrorResponse(id: RequestId, error: RpcError): RpcResponse {
  return { jsonrpc: "2.0", id, error };
}

export function makeNotification(method: string, params?: unknown): RpcNotification {
  return { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

export const RequestMethod = {
  Initialize: "initialize",
  Shutdown: "shutdown",
  Discover: "discover",
  Auth: "auth",
  CatalogModels: "catalog.models",
  CatalogModes: "catalog.modes",
  SessionCreate: "session.create",
  SessionResume: "session.resume",
  TurnSend: "turn.send",
  TurnCancel: "turn.cancel",
  PermissionReply: "permission.reply",
  QuestionReply: "question.reply",
  Health: "health",
} as const;

export type RequestMethodValue = (typeof RequestMethod)[keyof typeof RequestMethod];

const REQUEST_METHOD_SET: ReadonlySet<string> = new Set(Object.values(RequestMethod));

export function isRequestMethod(value: unknown): value is RequestMethodValue {
  return typeof value === "string" && REQUEST_METHOD_SET.has(value);
}

export const NotificationMethod = {
  SessionEvent: "session.event",
  HealthChanged: "runtime.healthChanged",
} as const;

// ---------------------------------------------------------------------------
// Per-method params/results (serializable; no vendor SDK types)
// ---------------------------------------------------------------------------

export interface ClientHello {
  readonly name?: string;
  readonly version?: string;
}

export interface InitializeParams {
  readonly protocolVersion: number;
  readonly client?: ClientHello;
}

export interface ServerBuildInfo {
  readonly hostVersion: string;
  readonly git: string;
  readonly time: string;
  readonly node: string;
}

export interface InitializeResult {
  readonly protocolVersion: number;
  readonly server: {
    readonly name: string;
    readonly build: ServerBuildInfo;
    readonly runtimes: readonly AgentRuntimeDescriptor[];
  };
}

export interface DiscoverResult {
  readonly runtimes: readonly (AgentRuntimeDescriptor & {
    readonly capabilities: AgentRuntimeCapabilities;
  })[];
}

export interface AuthParams {
  readonly runtimeId: AgentRuntimeId;
  readonly workspaceRootPath: string;
  readonly credential?: AgentCredentialHandle;
  readonly options?: Readonly<Record<string, unknown>>;
}

export type { AgentAuthResult, AgentAuthChallenge, AgentAuthStatus };

export interface CatalogModelsParams {
  readonly runtimeId: AgentRuntimeId;
  readonly workspaceRootPath?: string;
}

export interface CatalogModesParams {
  readonly runtimeId: AgentRuntimeId;
  readonly modelId?: string;
}

export type { AgentCatalogSummary };

export interface SessionCreateParams {
  readonly runtimeId: AgentRuntimeId;
  readonly workspaceRootPath: string;
  readonly modelId?: string;
  readonly modeId?: string;
  readonly capabilities?: readonly string[];
  readonly runtimeMetadata?: Readonly<Record<string, unknown>>;
}

export interface SessionResumeParams {
  readonly native: NativeSessionRef;
  readonly workspaceRootPath: string;
}

export type { NativeSessionRef };

export interface TurnSendParams {
  readonly turnId: SpecOpsTurnId;
  readonly native: NativeSessionRef;
  readonly workspaceRootPath: string;
  readonly prompt: string;
  readonly attachments?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface TurnSendResult {
  readonly turnId: SpecOpsTurnId;
}

export interface TurnCancelParams {
  readonly native: NativeSessionRef;
  readonly turnId?: SpecOpsTurnId;
  readonly reason?: CancelReason;
}

export interface PermissionReplyParams {
  readonly native: NativeSessionRef;
  readonly turnId: SpecOpsTurnId;
  readonly permissionId: string;
  readonly reply: PermissionReply;
}

export interface QuestionReplyParams {
  readonly native: NativeSessionRef;
  readonly turnId: SpecOpsTurnId;
  readonly questionId: string;
  readonly answer: string;
}

export interface HealthParams {
  readonly runtimeId?: AgentRuntimeId;
}

export type { AdapterHealth };

export interface SessionEventParams {
  readonly nativeSessionId: NativeSessionId;
  readonly event: SessionEvent;
}

export interface HealthChangedParams {
  readonly runtimeId: AgentRuntimeId;
  readonly health: AdapterHealth;
}

// ---------------------------------------------------------------------------
// Envelope classification + validation
// ---------------------------------------------------------------------------

export type IncomingMessage =
  | { readonly kind: "request"; readonly request: RpcRequest }
  | { readonly kind: "notification"; readonly notification: RpcNotification }
  | { readonly kind: "invalid"; readonly reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Classify a parsed JSON value as a request / notification / invalid. */
export function classifyIncoming(message: unknown): IncomingMessage {
  if (!isObject(message)) {
    return { kind: "invalid", reason: "message must be an object" };
  }
  if (message.jsonrpc !== "2.0") {
    return { kind: "invalid", reason: 'jsonrpc must be "2.0"' };
  }
  const hasId = message.id !== undefined;
  const hasMethod = typeof message.method === "string";
  const hasResult = message.result !== undefined;
  const hasError = message.error !== undefined;
  if (hasMethod && hasId && !hasResult && !hasError) {
    return { kind: "request", request: message as unknown as RpcRequest };
  }
  if (hasMethod && !hasId) {
    return { kind: "notification", notification: message as unknown as RpcNotification };
  }
  // Responses (id + result/error) are unexpected: the host sends no requests.
  if (hasId && (hasResult || hasError)) {
    return { kind: "invalid", reason: "host does not accept responses" };
  }
  return { kind: "invalid", reason: "message is neither a request nor a notification" };
}

export type DecodeOk<T> = { readonly ok: true; readonly value: T };
export type DecodeFail = { readonly ok: false; readonly reason: string };
export type DecodeResult<T> = DecodeOk<T> | DecodeFail;

function fail(reason: string): DecodeFail {
  return { ok: false, reason };
}
function ok<T>(value: T): DecodeOk<T> {
  return { ok: true, value };
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function decodeNativeSessionRef(value: unknown): DecodeResult<NativeSessionRef> {
  if (!isObject(value)) return fail("native must be an object");
  const runtimeId = readString(value.runtimeId);
  const nativeSessionId = readString(value.nativeSessionId);
  if (runtimeId === null || nativeSessionId === null) {
    return fail("native.runtimeId and native.nativeSessionId are required strings");
  }
  if (!isAgentRuntimeId(runtimeId)) {
    return fail(`native.runtimeId is not a known runtime: ${runtimeId}`);
  }
  return ok({
    runtimeId,
    nativeSessionId: asNativeSessionId(nativeSessionId),
    ...(value.modelId !== undefined ? { modelId: readOptionalString(value.modelId) } : {}),
    ...(value.modeId !== undefined ? { modeId: readOptionalString(value.modeId) } : {}),
    ...(value.runtimeMetadata !== undefined && isObject(value.runtimeMetadata)
      ? { runtimeMetadata: value.runtimeMetadata as Readonly<Record<string, unknown>> }
      : {}),
  });
}

function requireRuntimeId(value: unknown, field: string): DecodeResult<AgentRuntimeId> {
  const raw = readString(value);
  if (raw === null) return fail(`${field} must be a string`);
  if (!isAgentRuntimeId(raw)) return fail(`${field} is not a known runtime: ${raw}`);
  return ok(raw);
}

export function decodeInitialize(value: unknown): DecodeResult<InitializeParams> {
  if (!isObject(value)) return fail("params must be an object");
  const protocolVersion = value.protocolVersion;
  if (typeof protocolVersion !== "number" || !Number.isFinite(protocolVersion)) {
    return fail("protocolVersion must be a finite number");
  }
  const client = isObject(value.client)
    ? {
        ...(typeof value.client.name === "string" ? { name: value.client.name } : {}),
        ...(typeof value.client.version === "string" ? { version: value.client.version } : {}),
      }
    : undefined;
  return ok({ protocolVersion, ...(client ? { client } : {}) });
}

export function decodeAuth(value: unknown): DecodeResult<AuthParams> {
  if (!isObject(value)) return fail("params must be an object");
  const runtimeId = requireRuntimeId(value.runtimeId, "runtimeId");
  if (!runtimeId.ok) return fail(runtimeId.reason);
  const workspaceRootPath = readString(value.workspaceRootPath);
  if (workspaceRootPath === null) return fail("workspaceRootPath must be a string");
  return ok({
    runtimeId: runtimeId.value,
    workspaceRootPath,
    ...(value.credential !== undefined && isObject(value.credential) ? { credential: value.credential as unknown as AgentCredentialHandle } : {}),
    ...(value.options !== undefined && isObject(value.options) ? { options: value.options as Readonly<Record<string, unknown>> } : {}),
  });
}

export function decodeCatalogModels(value: unknown): DecodeResult<CatalogModelsParams> {
  if (!isObject(value)) return fail("params must be an object");
  const runtimeId = requireRuntimeId(value.runtimeId, "runtimeId");
  if (!runtimeId.ok) return fail(runtimeId.reason);
  return ok({
    runtimeId: runtimeId.value,
    ...(value.workspaceRootPath !== undefined ? { workspaceRootPath: readOptionalString(value.workspaceRootPath) } : {}),
  });
}

export function decodeCatalogModes(value: unknown): DecodeResult<CatalogModesParams> {
  if (!isObject(value)) return fail("params must be an object");
  const runtimeId = requireRuntimeId(value.runtimeId, "runtimeId");
  if (!runtimeId.ok) return fail(runtimeId.reason);
  return ok({
    runtimeId: runtimeId.value,
    ...(value.modelId !== undefined ? { modelId: readOptionalString(value.modelId) } : {}),
  });
}

export function decodeSessionCreate(value: unknown): DecodeResult<SessionCreateParams> {
  if (!isObject(value)) return fail("params must be an object");
  const runtimeId = requireRuntimeId(value.runtimeId, "runtimeId");
  if (!runtimeId.ok) return fail(runtimeId.reason);
  const workspaceRootPath = readString(value.workspaceRootPath);
  if (workspaceRootPath === null) return fail("workspaceRootPath must be a string");
  return ok({
    runtimeId: runtimeId.value,
    workspaceRootPath,
    ...(value.modelId !== undefined ? { modelId: readOptionalString(value.modelId) } : {}),
    ...(value.modeId !== undefined ? { modeId: readOptionalString(value.modeId) } : {}),
    ...(Array.isArray(value.capabilities) ? { capabilities: value.capabilities.filter((v): v is string => typeof v === "string") } : {}),
    ...(value.runtimeMetadata !== undefined && isObject(value.runtimeMetadata) ? { runtimeMetadata: value.runtimeMetadata as Readonly<Record<string, unknown>> } : {}),
  });
}

export function decodeSessionResume(value: unknown): DecodeResult<SessionResumeParams> {
  if (!isObject(value)) return fail("params must be an object");
  const native = decodeNativeSessionRef(value.native);
  if (!native.ok) return fail(native.reason);
  const workspaceRootPath = readString(value.workspaceRootPath);
  if (workspaceRootPath === null) return fail("workspaceRootPath must be a string");
  return ok({ native: native.value, workspaceRootPath });
}

export function decodeTurnSend(value: unknown): DecodeResult<TurnSendParams> {
  if (!isObject(value)) return fail("params must be an object");
  const turnIdRaw = readString(value.turnId);
  if (turnIdRaw === null) return fail("turnId must be a string");
  const native = decodeNativeSessionRef(value.native);
  if (!native.ok) return fail(native.reason);
  const workspaceRootPath = readString(value.workspaceRootPath);
  if (workspaceRootPath === null) return fail("workspaceRootPath must be a string");
  const prompt = readString(value.prompt);
  if (prompt === null) return fail("prompt must be a string");
  return ok({
    turnId: asSpecOpsTurnId(turnIdRaw),
    native: native.value,
    workspaceRootPath,
    prompt,
    ...(value.attachments !== undefined ? { attachments: value.attachments } : {}),
    ...(value.context !== undefined && isObject(value.context) ? { context: value.context as Readonly<Record<string, unknown>> } : {}),
  });
}

export function decodeTurnCancel(value: unknown): DecodeResult<TurnCancelParams> {
  if (!isObject(value)) return fail("params must be an object");
  const native = decodeNativeSessionRef(value.native);
  if (!native.ok) return fail(native.reason);
  return ok({
    native: native.value,
    ...(value.turnId !== undefined && typeof value.turnId === "string" ? { turnId: asSpecOpsTurnId(value.turnId) } : {}),
    ...(value.reason !== undefined && typeof value.reason === "string" ? { reason: value.reason as CancelReason } : {}),
  });
}

export function decodePermissionReply(value: unknown): DecodeResult<PermissionReplyParams> {
  if (!isObject(value)) return fail("params must be an object");
  const native = decodeNativeSessionRef(value.native);
  if (!native.ok) return fail(native.reason);
  const turnIdRaw = readString(value.turnId);
  const permissionId = readString(value.permissionId);
  const reply = readString(value.reply);
  if (turnIdRaw === null || permissionId === null || reply === null) {
    return fail("turnId, permissionId, reply are required strings");
  }
  if (!["once", "always", "reject"].includes(reply)) {
    return fail("reply must be one of: once, always, reject");
  }
  return ok({
    native: native.value,
    turnId: asSpecOpsTurnId(turnIdRaw),
    permissionId,
    reply: reply as PermissionReply,
  });
}

export function decodeQuestionReply(value: unknown): DecodeResult<QuestionReplyParams> {
  if (!isObject(value)) return fail("params must be an object");
  const native = decodeNativeSessionRef(value.native);
  if (!native.ok) return fail(native.reason);
  const turnIdRaw = readString(value.turnId);
  const questionId = readString(value.questionId);
  const answer = readString(value.answer);
  if (turnIdRaw === null || questionId === null || answer === null) {
    return fail("turnId, questionId, answer are required strings");
  }
  return ok({ native: native.value, turnId: asSpecOpsTurnId(turnIdRaw), questionId, answer });
}

export function decodeHealth(value: unknown): DecodeResult<HealthParams> {
  if (!isObject(value)) return fail("params must be an object");
  if (value.runtimeId === undefined) return ok({});
  const runtimeId = requireRuntimeId(value.runtimeId, "runtimeId");
  if (!runtimeId.ok) return fail(runtimeId.reason);
  return ok({ runtimeId: runtimeId.value });
}
