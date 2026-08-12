/**
 * Frontend Agent Host client barrel (phase F).
 *
 * The typed bridge between the WebView and the Rust-supervised Agent Host. No
 * vendor SDK type crosses this boundary — only the runtime-neutral phase B/C
 * domain types.
 */

export {
  AGENT_HOST_EVENT,
  createAgentHostClient,
  newTurnId,
  asNativeSessionId,
  asSpecOpsTurnId,
} from "./agentHostClient";
export type {
  AgentHostClient,
  AgentHostBindings,
  AgentHostStatus,
  AgentHostHealthStatus,
  AgentHostClientError,
  DiscoverResult,
  CatalogModelsResult,
  CatalogModesResult,
  CreateSessionRequest,
  ResumeSessionRequest,
  SendTurnRequest,
  CancelTurnRequest,
  PermissionReplyRequest,
  QuestionReplyRequest,
} from "./agentHostClient";

export { foldSessionEvent, initialTurnFoldState } from "./hostTurnReducer";
export type { TurnFoldState } from "./hostTurnReducer";
