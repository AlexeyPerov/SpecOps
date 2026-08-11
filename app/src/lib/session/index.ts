/**
 * Runtime-neutral session domain (phase B).
 *
 * Public barrel for the foundation session domain: runtime identity, branded
 * ids, immutable native binding + lifecycle, normalized events + transcript,
 * persistence records + codecs. The WebView imports from here; vendor SDK
 * types never appear in these payloads.
 */

export type {
  AgentRuntimeId,
  AgentRuntimeDescriptor,
} from "./runtime";
export {
  AGENT_RUNTIME_IDS,
  isAgentRuntimeId,
  agentRuntimeDescriptor,
  allAgentRuntimeDescriptors,
} from "./runtime";

export {
  mintSpecOpsSessionId,
  mintSpecOpsTurnId,
  asSpecOpsSessionId,
  asSpecOpsTurnId,
  asNativeSessionId,
  resetSessionIdCountersForTests,
  reindexSpecOpsSessionIdCounter,
  SessionIdParseError,
} from "./ids";
export type {
  SpecOpsSessionId,
  SpecOpsTurnId,
  NativeSessionId,
} from "./ids";

export type { AgentCapability, AgentCapabilityValue } from "./capabilities";
export {
  normalizeCapabilities,
  isKnownCapability,
  hasCapability,
} from "./capabilities";

export type {
  AgentModelDescriptor,
  AgentModeDescriptor,
  AgentNativeBinding,
  AgentSessionRef,
  SessionLifecycleStatus,
  CreateSessionRefInput,
} from "./binding";
export {
  TERMINAL_SESSION_STATUSES,
  isSessionLifecycleStatus,
  isTerminalSessionStatus,
  canStartTurn,
  createSessionRef,
  rebindRuntime,
  updateSessionRef,
  assertRuntimeImmutable,
  rehydrateSessionRef,
  SessionBindingError,
} from "./binding";

export type {
  SessionEvent,
  SessionEventKind,
  BaseSessionEvent,
  DiagnosticLevel,
  ToolCallSnapshot,
  ToolCallStatus,
  SubtaskSnapshot,
  SubtaskStatus,
  StepSnapshot,
  StepPhase,
  AttachmentSnapshot,
  DiffSnapshot,
  UsageSnapshot,
  PermissionReply,
  PermissionRequest,
  QuestionRequest,
  ReasoningEntry,
} from "./events";

export {
  redactForSerialization,
  redactSecretStringValue,
  toUnknownNativeDiagnostic,
  toMalformedDiagnostic,
} from "./redact";

export type {
  SessionTurn,
  SessionTurnPart,
  SessionCompaction,
  SessionTranscript,
  TurnStatus,
  DiagnosticEvent,
} from "./transcript";
export {
  emptyTranscript,
  appendUserTurn,
  applySessionEvent,
  replaySessionEvents,
} from "./transcript";

export {
  SESSION_RECORD_VERSION,
  SESSION_STORE_INDEX_VERSION,
  toSessionStoreIndexEntry,
  createSessionStoreIndex,
  upsertSessionStoreIndexEntry,
  removeSessionStoreIndexEntry,
} from "./record";
export type {
  SessionRecord,
  SessionStoreIndex,
  SessionStoreIndexEntry,
} from "./record";

export {
  encodeSessionRecord,
  decodeSessionRecord,
  encodeSessionStoreIndex,
  decodeSessionStoreIndex,
} from "./codec";
export type { DecodeResult } from "./codec";
