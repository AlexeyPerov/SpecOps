/**
 * Adapter contract barrel (phase C).
 *
 * Mandatory core ({@link ./adapter}), typed errors ({@link ./errors}), optional
 * capability extensions ({@link ./extensions}), and the deterministic fake
 * runtime ({@link ./fake}). Frontend-facing packages import from here; the host
 * (phase D) imports the same contract to drive real and fake adapters.
 */

export type {
  AgentRuntimeAdapter,
  NativeSessionRef,
  AgentCredentialHandle,
  AgentAuthChallenge,
  AgentAuthRequest,
  AgentAuthResult,
  AgentAuthStatus,
  CreateAgentSessionRequest,
  ResumeAgentSessionRequest,
  AgentTurnRequest,
  CancelAgentTurnRequest,
  CancelReason,
  AdapterHealth,
  AdapterHealthStatus,
  AgentRuntimeCapabilities,
  AgentCapabilityDetail,
  AgentCatalogSummary,
  TerminalTurnEventKind,
} from "./adapter";
export {
  AGENT_CAPABILITY_SCHEMA_VERSION,
  supportsCatalog,
} from "./adapter";

export type { AdapterErrorCode, AdapterErrorOptions } from "./errors";
export {
  AdapterError,
  isAdapterError,
  isAdapterErrorCode,
  adapterError,
  adapterErrors,
} from "./errors";

export type {
  CatalogExtension,
  PermissionExtension,
  QuestionExtension,
  LifecycleExtension,
  CheckpointExtension,
  ShareExtension,
  ConfigurationExtension,
  AgentConfigurationSchema,
  AgentConfigurationField,
  McpExtension,
  McpServerEntry,
  SkillsExtension,
  SkillEntry,
  CommandsExtension,
  CommandEntry,
  TodosExtension,
  NativeTodoEntry,
  DiffsExtension,
  DiagnosticsExtension,
  DiagnosticsEntry,
} from "./extensions";
export {
  isCatalogExtension,
  isPermissionExtension,
  isQuestionExtension,
  isLifecycleExtension,
  isCheckpointExtension,
  isShareExtension,
  isConfigurationExtension,
  isMcpExtension,
  isSkillsExtension,
  isCommandsExtension,
  isTodosExtension,
  isDiffsExtension,
  isDiagnosticsExtension,
  CAPABILITY_EXTENSION_MAP,
  inferCapabilities,
} from "./extensions";

export {
  createFakeRuntimeAdapter,
} from "./fake";
export type {
  FakeRuntimeAdapter,
  FakeRuntimeConfig,
  FakeTurnScript,
  FakeTurnOutcome,
  FakeScriptedEvent,
  FakeStatusChange,
  FakeAuthConfig,
} from "./fake";
