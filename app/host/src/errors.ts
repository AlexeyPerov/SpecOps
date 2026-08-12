/**
 * Host error mapping (phase D).
 *
 * Translates adapter/registry/internal failures into JSON-RPC error objects so
 * dispatch never leaks vendor exception text or secrets. Adapter failures keep
 * their typed `adapterCode`; unknown runtimes map to INVALID_PARAMS; anything
 * else is INTERNAL_ERROR with a redacted message.
 */

import { ProtocolErrorCode, rpcError, type RpcError, type AdapterErrorData } from "./protocol";
import { isAdapterError } from "../../src/lib/session/adapter";
import { UnknownRuntimeError } from "./registry";
import { redactForLogs } from "./redact";

/** A handler-thrown error carrying a protocol code (mapped 1:1 to an RpcError). */
export class ProtocolError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }
}

export function isProtocolError(error: unknown): error is ProtocolError {
  return error instanceof ProtocolError;
}

/** Map any thrown value to a JSON-RPC error object (never throws). */
export function toProtocolError(error: unknown): RpcError {
  if (error instanceof ProtocolError) {
    return rpcError(error.code, error.message, error.data);
  }
  if (isAdapterError(error)) {
    const data: AdapterErrorData = { adapterCode: error.code };
    return rpcError(ProtocolErrorCode.ADAPTER_ERROR, error.message, data);
  }
  if (error instanceof UnknownRuntimeError) {
    return rpcError(ProtocolErrorCode.INVALID_PARAMS, error.message, { unknownRuntime: error.runtimeId });
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = typeof rawMessage === "string" ? (redactForLogs(rawMessage) as string) : String(error);
  return rpcError(ProtocolErrorCode.INTERNAL_ERROR, message);
}
