/**
 * Native binding, session reference, and lifecycle (phase B domain).
 *
 * Core invariants:
 * 1. **Immutable runtime binding.** `runtimeId` and `native` are fixed at
 *    creation. "Changing the runtime" means creating a new session
 *    ({@link rebindRuntime}); there is no in-place mutator.
 * 2. **SpecOps-native id separation.** `id` is a SpecOpsSessionId and
 *    `native.nativeSessionId` is a NativeSessionId — the branded types make
 *    them un-confusable at the API surface.
 * 3. **No vendor SDK types.** Model/mode descriptors carry only id + label;
 *    `runtimeMetadata` is an opaque serializable record (secrets redacted
 *    before persistence by the codec).
 */

import type { AgentCapabilityValue } from "./capabilities";
import { normalizeCapabilities } from "./capabilities";
import type { AgentRuntimeId } from "./runtime";
import { isAgentRuntimeId } from "./runtime";
import {
  asNativeSessionId,
  asSpecOpsSessionId,
  mintSpecOpsSessionId,
  type NativeSessionId,
  type SpecOpsSessionId,
  SessionIdParseError,
} from "./ids";

export interface AgentModelDescriptor {
  readonly id: string;
  readonly name?: string;
}

export interface AgentModeDescriptor {
  readonly id: string;
  readonly name?: string;
}

/**
 * Immutable binding from a SpecOps session to a runtime-native session.
 * `runtimeMetadata` carries adapter-specific, serializable-only hints (e.g.
 * a server region) and MUST NOT include credentials or raw request payloads.
 */
export interface AgentNativeBinding {
  readonly runtimeId: AgentRuntimeId;
  readonly nativeSessionId: NativeSessionId;
  readonly modelId?: string;
  readonly modeId?: string;
  readonly parentSessionId?: SpecOpsSessionId;
  readonly runtimeMetadata?: Readonly<Record<string, unknown>>;
}

export type SessionLifecycleStatus =
  | "idle"
  | "running"
  | "waiting-permission"
  | "waiting-question"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_SESSION_STATUSES: readonly SessionLifecycleStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

const SESSION_LIFECYCLE_STATUS_SET: ReadonlySet<SessionLifecycleStatus> = new Set([
  "idle",
  "running",
  "waiting-permission",
  "waiting-question",
  "completed",
  "failed",
  "cancelled",
]);

export function isSessionLifecycleStatus(value: unknown): value is SessionLifecycleStatus {
  return typeof value === "string" && SESSION_LIFECYCLE_STATUS_SET.has(value as SessionLifecycleStatus);
}

export function isTerminalSessionStatus(status: SessionLifecycleStatus): boolean {
  return TERMINAL_SESSION_STATUSES.includes(status);
}

export function canStartTurn(status: SessionLifecycleStatus): boolean {
  return status === "idle" || status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * The mandatory session core (no vendor types). `runtimeId` is denormalized
 * from `native.runtimeId` for quick access but must stay consistent —
 * {@link createSessionRef} and {@link rebindRuntime} enforce this.
 */
export interface AgentSessionRef {
  readonly id: SpecOpsSessionId;
  readonly runtimeId: AgentRuntimeId;
  readonly native: AgentNativeBinding;
  readonly workspaceRootPath: string;
  readonly model?: AgentModelDescriptor;
  readonly mode?: AgentModeDescriptor;
  readonly capabilities: readonly AgentCapabilityValue[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastTurnAt?: string;
  readonly status: SessionLifecycleStatus;
}

export class SessionBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionBindingError";
  }
}

export interface CreateSessionRefInput {
  /** Optional pre-existing SpecOps id (restore). When omitted a new id is minted. */
  id?: SpecOpsSessionId;
  runtimeId: AgentRuntimeId;
  nativeSessionId: NativeSessionId | string;
  workspaceRootPath: string;
  modelId?: string;
  modeId?: string;
  parentSessionId?: SpecOpsSessionId;
  capabilities?: readonly AgentCapabilityValue[];
  model?: AgentModelDescriptor;
  mode?: AgentModeDescriptor;
  runtimeMetadata?: Readonly<Record<string, unknown>>;
  createdAt?: string;
  updatedAt?: string;
  lastTurnAt?: string;
  status?: SessionLifecycleStatus;
}

/**
 * Create a session ref with an immutable runtime binding. The runtime is
 * fixed for the session's entire lifetime; call {@link rebindRuntime} to
 * "switch" runtimes (which creates a new session id).
 */
export function createSessionRef(input: CreateSessionRefInput): AgentSessionRef {
  if (!isAgentRuntimeId(input.runtimeId)) {
    throw new SessionBindingError(`Unknown runtimeId: ${String(input.runtimeId)}`);
  }
  if (typeof input.workspaceRootPath !== "string" || input.workspaceRootPath.trim().length === 0) {
    throw new SessionBindingError("workspaceRootPath must be a non-empty string");
  }
  const nativeSessionId =
    typeof input.nativeSessionId === "string" ? asNativeSessionId(input.nativeSessionId) : input.nativeSessionId;
  const now = input.createdAt ?? new Date(0).toISOString();
  const updatedAt = input.updatedAt ?? now;
  const id = input.id ?? mintSpecOpsSessionId();
  const native: AgentNativeBinding = {
    runtimeId: input.runtimeId,
    nativeSessionId,
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.modeId !== undefined ? { modeId: input.modeId } : {}),
    ...(input.parentSessionId !== undefined ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.runtimeMetadata !== undefined ? { runtimeMetadata: input.runtimeMetadata } : {}),
  };
  return {
    id,
    runtimeId: input.runtimeId,
    native,
    workspaceRootPath: input.workspaceRootPath,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    capabilities: normalizeCapabilities(input.capabilities ?? []),
    createdAt: now,
    updatedAt,
    ...(input.lastTurnAt !== undefined ? { lastTurnAt: input.lastTurnAt } : {}),
    status: input.status ?? "idle",
  };
}

/**
 * Returns a **new** session ref bound to a different runtime/native session.
 * The original ref is untouched; the new ref gets a fresh SpecOps id and
 * records the source via `parentSessionId` when provided. This is the only
 * supported way to "change runtime" — there is no in-place mutator.
 */
export function rebindRuntime(
  source: AgentSessionRef,
  next: {
    runtimeId: AgentRuntimeId;
    nativeSessionId: NativeSessionId | string;
    modelId?: string;
    modeId?: string;
    runtimeMetadata?: Readonly<Record<string, unknown>>;
    linkAsParent?: boolean;
  },
): AgentSessionRef {
  if (!isAgentRuntimeId(next.runtimeId)) {
    throw new SessionBindingError(`Unknown runtimeId: ${String(next.runtimeId)}`);
  }
  const nativeSessionId =
    typeof next.nativeSessionId === "string" ? asNativeSessionId(next.nativeSessionId) : next.nativeSessionId;
  return createSessionRef({
    runtimeId: next.runtimeId,
    nativeSessionId,
    workspaceRootPath: source.workspaceRootPath,
    modelId: next.modelId,
    modeId: next.modeId,
    capabilities: source.capabilities,
    model: source.model,
    mode: source.mode,
    runtimeMetadata: next.runtimeMetadata,
    ...(next.linkAsParent ? { parentSessionId: source.id } : {}),
  });
}

/**
 * Runtime-immutability guard. Adapters/stores call this before any update to
 * reject accidental runtime reassignment. The only legitimate path to a
 * different runtime is {@link rebindRuntime} (a new session).
 */
export function assertRuntimeImmutable(ref: AgentSessionRef, candidateRuntimeId: AgentRuntimeId): void {
  if (ref.runtimeId !== candidateRuntimeId || ref.native.runtimeId !== candidateRuntimeId) {
    throw new SessionBindingError(
      `Session ${ref.id} is bound to runtime "${ref.runtimeId}"; runtime is immutable. ` +
        `Create a new session via rebindRuntime() to switch to "${candidateRuntimeId}".`,
    );
  }
}

/** Returns a non-mutating copy of `ref` with selective fields replaced (runtime/native stay fixed). */
export function updateSessionRef(
  ref: AgentSessionRef,
  patch: Partial<
    Pick<
      AgentSessionRef,
      "model" | "mode" | "capabilities" | "updatedAt" | "lastTurnAt" | "status"
    >
  >,
): AgentSessionRef {
  const candidateRuntime = patch ? (patch as { runtimeId?: AgentRuntimeId }).runtimeId : undefined;
  if (candidateRuntime !== undefined) {
    assertRuntimeImmutable(ref, candidateRuntime);
  }
  const { ...rest } = patch;
  return {
    ...ref,
    ...rest,
    runtimeId: ref.runtimeId,
    native: ref.native,
  };
}

/** Re-wrap persisted values into a validated AgentSessionRef (used by the codec). */
export function rehydrateSessionRef(raw: {
  id: string;
  runtimeId: AgentRuntimeId;
  native: {
    runtimeId: AgentRuntimeId;
    nativeSessionId: string;
    modelId?: string;
    modeId?: string;
    parentSessionId?: string;
    runtimeMetadata?: Record<string, unknown>;
  };
  workspaceRootPath: string;
  model?: AgentModelDescriptor;
  mode?: AgentModeDescriptor;
  capabilities?: readonly AgentCapabilityValue[];
  createdAt: string;
  updatedAt: string;
  lastTurnAt?: string;
  status: SessionLifecycleStatus;
}): AgentSessionRef {
  if (raw.runtimeId !== raw.native.runtimeId) {
    throw new SessionBindingError(
      `Session ${raw.id} runtimeId "${raw.runtimeId}" disagrees with native.runtimeId "${raw.native.runtimeId}"`,
    );
  }
  return createSessionRef({
    id: asSpecOpsSessionId(raw.id),
    runtimeId: raw.runtimeId,
    nativeSessionId: asNativeSessionId(raw.native.nativeSessionId),
    workspaceRootPath: raw.workspaceRootPath,
    modelId: raw.native.modelId,
    modeId: raw.native.modeId,
    parentSessionId: raw.native.parentSessionId !== undefined ? asSpecOpsSessionId(raw.native.parentSessionId) : undefined,
    capabilities: raw.capabilities,
    model: raw.model,
    mode: raw.mode,
    runtimeMetadata: raw.native.runtimeMetadata,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastTurnAt: raw.lastTurnAt,
    status: raw.status,
  });
}

export { SessionIdParseError };
