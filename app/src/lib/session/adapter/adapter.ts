/**
 * Mandatory adapter core (phase C, task AS01-C-01).
 *
 * `AgentRuntimeAdapter` is the smallest interface every runtime must implement.
 * It is consumed by the Agent Host (phase D) and exercised by the shared
 * contract suite (task AS01-C-04). Optional behavior lives in
 * {@link ./extensions} — nothing here is a "required no-op".
 *
 * Behavioral contract (enforced by the shared suite):
 * - **Lifecycle ordering.** A turn stream emits `turn.started` first, then any
 *   number of non-terminal events, then exactly one terminal event
 *   (`turn.finished` | `turn.failed` | `turn.cancelled`), then completes.
 * - **Sequence ids.** `seq` is 1-based and strictly monotonic per native
 *   session across the lifetime of the adapter (including after resume).
 * - **Terminal exclusivity.** A stream never emits more than one terminal turn
 *   event; after the terminal event the iterable ends.
 * - **Cancellation.** `cancel()` on an active turn causes the active stream to
 *   emit `turn.cancelled` and complete; `cancel()` with no active turn settles
 *   without throwing (callers may treat it as idempotent).
 * - **Capability honesty.** `describe()`/`describeCapabilities()` advertise
 *   only features the adapter actually implements as extension interfaces.
 *
 * All payloads reuse the phase B domain types (`AgentSessionRef`, `SessionEvent`,
 * `AgentRuntimeDescriptor`); no vendor SDK type appears here.
 */

import type { AgentCapabilityValue } from "../capabilities";
import type {
  AgentModelDescriptor,
  AgentModeDescriptor,
} from "../binding";
import type { AgentRuntimeDescriptor, AgentRuntimeId } from "../runtime";
import type { NativeSessionId, SpecOpsTurnId } from "../ids";
import type { AttachmentSnapshot, SessionEvent } from "../events";

// ---------------------------------------------------------------------------
// Native session reference
// ---------------------------------------------------------------------------

/**
 * The runtime-native handle returned by `createSession`/`resumeSession`. It is
 * the adapter's side of {@link AgentNativeBinding}; the host combines it with a
 * SpecOps session id to form a full binding. `runtimeMetadata` carries
 * serializable-only hints (never credentials).
 */
export interface NativeSessionRef {
  readonly runtimeId: AgentRuntimeId;
  readonly nativeSessionId: NativeSessionId;
  readonly modelId?: string;
  readonly modeId?: string;
  readonly runtimeMetadata?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Credential kind. The adapter never receives a raw secret through the common
 * type; it resolves secrets through the host credential broker (phase E). The
 * `ref` is an opaque handle the host understands.
 */
export interface AgentCredentialHandle {
  readonly kind: "api-key" | "oauth" | "password" | "device" | "none";
  readonly ref?: string;
}

export interface AgentAuthChallenge {
  readonly kind: "url" | "code" | "form";
  readonly url?: string;
  readonly code?: string;
  readonly fields?: readonly {
    readonly id: string;
    readonly label: string;
    readonly secret?: boolean;
  }[];
  readonly message?: string;
}

export interface AgentAuthRequest {
  readonly runtimeId: AgentRuntimeId;
  readonly workspaceRootPath: string;
  readonly credential?: AgentCredentialHandle;
  readonly options?: Readonly<Record<string, unknown>>;
}

export type AgentAuthStatus = "authenticated" | "not-required" | "challenge";

export interface AgentAuthResult {
  readonly status: AgentAuthStatus;
  readonly challenge?: AgentAuthChallenge;
  readonly expiresAt?: string;
  readonly message?: string;
}

// ---------------------------------------------------------------------------
// Session create / resume
// ---------------------------------------------------------------------------

export interface CreateAgentSessionRequest {
  readonly runtimeId: AgentRuntimeId;
  readonly workspaceRootPath: string;
  readonly modelId?: string;
  readonly modeId?: string;
  readonly capabilities?: readonly AgentCapabilityValue[];
  readonly runtimeMetadata?: Readonly<Record<string, unknown>>;
}

export interface ResumeAgentSessionRequest {
  readonly native: NativeSessionRef;
  readonly workspaceRootPath: string;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export interface AgentTurnRequest {
  /** SpecOps-owned turn id; echoed by the adapter on every turn-scoped event. */
  readonly turnId: SpecOpsTurnId;
  readonly native: NativeSessionRef;
  readonly workspaceRootPath: string;
  readonly prompt: string;
  readonly attachments?: readonly AttachmentSnapshot[];
  /**
   * Adapter-safe context (file mentions, agent names). No vendor SDK types;
   * no secrets. Unknown keys are ignored by adapters that do not use them.
   */
  readonly context?: Readonly<Record<string, unknown>>;
}

export type CancelReason = "user" | "timeout" | "supervisor";

export interface CancelAgentTurnRequest {
  readonly native: NativeSessionRef;
  /** When omitted, the adapter cancels the currently active turn (if any). */
  readonly turnId?: SpecOpsTurnId;
  readonly reason?: CancelReason;
}

// ---------------------------------------------------------------------------
// Health + capabilities
// ---------------------------------------------------------------------------

export type AdapterHealthStatus = "healthy" | "degraded" | "unavailable";

export interface AdapterHealth {
  readonly status: AdapterHealthStatus;
  readonly runtimeId: AgentRuntimeId;
  readonly runtimeVersion?: string;
  readonly message?: string;
  readonly checkedAt: string;
}

/** Schema version for the capability detail map (bump when the shape changes). */
export const AGENT_CAPABILITY_SCHEMA_VERSION = 1 as const;

export interface AgentCapabilityDetail {
  readonly supported: boolean;
  readonly limits?: Readonly<Record<string, unknown>>;
  readonly notes?: string;
}

export interface AgentRuntimeCapabilities {
  readonly schemaVersion: typeof AGENT_CAPABILITY_SCHEMA_VERSION;
  readonly supported: readonly AgentCapabilityValue[];
  readonly details: Readonly<Record<string, AgentCapabilityDetail>>;
}

// ---------------------------------------------------------------------------
// Mandatory adapter interface
// ---------------------------------------------------------------------------

/**
 * The mandatory runtime adapter. Every runtime (and the deterministic fake)
 * implements exactly this surface. Optional features are exposed by
 * additionally implementing one or more extension interfaces from
 * {@link ./extensions}; the host/UI down-casts via the type guards.
 */
export interface AgentRuntimeAdapter {
  /** Stable runtime identity this adapter drives. */
  readonly runtimeId: AgentRuntimeId;

  /** Stable identity + display metadata (no vendor SDK types). */
  describe(): Promise<AgentRuntimeDescriptor>;

  /** Advertised capabilities + per-capability details (capability honesty). */
  describeCapabilities(): Promise<AgentRuntimeCapabilities>;

  /**
   * Resolve authentication for a workspace. A runtime that needs no auth
   * returns `status: "not-required"`. May raise `authentication-failed`.
   */
  authenticate(request: AgentAuthRequest): Promise<AgentAuthResult>;

  /** List models/modes the runtime offers (when supported); optional metadata. */
  describeCatalog?(): Promise<AgentCatalogSummary>;

  /** Create a new native session bound to the given workspace. */
  createSession(request: CreateAgentSessionRequest): Promise<NativeSessionRef>;

  /**
   * Reconnect to an existing native session after a host restart. Returns the
   * (possibly refreshed) native reference. May raise `session-not-found`.
   */
  resumeSession(request: ResumeAgentSessionRequest): Promise<NativeSessionRef>;

  /**
   * Start a turn and stream normalized events. The stream MUST follow the
   * lifecycle ordering + terminal-exclusivity contract documented above.
   * Cancellation is delivered via {@link cancel}.
   */
  send(request: AgentTurnRequest): AsyncIterable<SessionEvent>;

  /**
   * Cancel the active turn for the session. Idempotent for a session with no
   * active turn. The active stream emits `turn.cancelled` and completes.
   */
  cancel(request: CancelAgentTurnRequest): Promise<void>;

  /** Report runtime health (availability, version). */
  health(): Promise<AdapterHealth>;
}

/** Optional catalog summary returned by `describeCatalog`. */
export interface AgentCatalogSummary {
  readonly models: readonly AgentModelDescriptor[];
  readonly modes: readonly AgentModeDescriptor[];
  readonly defaultModelId?: string;
  readonly defaultModeId?: string;
}

/** Terminal turn event kinds — exactly one of these ends every turn stream. */
export type TerminalTurnEventKind = "turn.finished" | "turn.failed" | "turn.cancelled";

/** Type guard for the optional `describeCatalog` method. */
export function supportsCatalog(adapter: AgentRuntimeAdapter): boolean {
  return typeof (adapter as AgentRuntimeAdapter & { describeCatalog?: unknown }).describeCatalog === "function";
}
