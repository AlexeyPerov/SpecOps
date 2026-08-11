/**
 * Normalized session event + turn model (phase B domain).
 *
 * Adapters (phase C) translate vendor streams into the {@link SessionEvent}
 * union. Common UI consumes these — never vendor SDK types. Unknown native
 * events are preserved as `diagnostic` events ({@link toDiagnosticEvent} and
 * {@link toUnknownNativeDiagnostic}) instead of crashing or being silently
 * reinterpreted.
 */

import type { SessionLifecycleStatus } from "./binding";
import type { NativeSessionId, SpecOpsTurnId } from "./ids";

// ---------------------------------------------------------------------------
// Snapshot payloads (runtime-neutral; no vendor SDK types)
// ---------------------------------------------------------------------------

export type ToolCallStatus = "pending" | "running" | "success" | "failure";

export interface ToolCallSnapshot {
  callId: string;
  toolName: string;
  status: ToolCallStatus;
  input?: unknown;
  output?: unknown;
  progress?: unknown;
}

export type SubtaskStatus = "running" | "completed" | "failed";

export interface SubtaskSnapshot {
  id: string;
  agent: string;
  description?: string;
  prompt?: string;
  status: SubtaskStatus;
  output?: string;
  error?: string;
}

export type StepPhase = "started" | "finished" | "failed";

export interface StepSnapshot {
  id: string;
  phase: StepPhase;
  index?: number;
  reason?: string;
  cost?: number;
  tokens?: UsageSnapshot;
}

export interface AttachmentSnapshot {
  id: string;
  mime: string;
  filename?: string;
  /** Workspace-relative path or runtime URI; never an embedded credential. */
  url: string;
}

export interface DiffSnapshot {
  id: string;
  snapshot?: string;
  files?: string[];
}

export interface UsageSnapshot {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export type PermissionReply = "once" | "always" | "reject";

export interface PermissionRequest {
  permissionId: string;
  label: string;
  payload?: unknown;
}

export interface QuestionRequest {
  questionId: string;
  prompt: string;
  choices?: string[];
  payload?: unknown;
}

export interface ReasoningEntry {
  id: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Session event union
// ---------------------------------------------------------------------------

export type SessionEventKind =
  | "turn.started"
  | "text.delta"
  | "text.finished"
  | "reasoning.delta"
  | "reasoning.ended"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "subtask.started"
  | "step.started"
  | "step.finished"
  | "step.failed"
  | "attachment.posted"
  | "diff.posted"
  | "usage.recorded"
  | "compaction.applied"
  | "permission.requested"
  | "question.requested"
  | "status.changed"
  | "turn.finished"
  | "turn.failed"
  | "turn.cancelled"
  | "diagnostic";

export interface BaseSessionEvent {
  /** Native session the event belongs to. */
  readonly nativeSessionId: NativeSessionId;
  /** Monotonic sequence within the session (1-based). */
  readonly seq: number;
  readonly at: string;
}

export type SessionEvent = BaseSessionEvent &
  (
    | { readonly type: "turn.started"; readonly turnId: SpecOpsTurnId }
    | { readonly type: "text.delta"; readonly turnId: SpecOpsTurnId; readonly delta: string }
    | { readonly type: "text.finished"; readonly turnId: SpecOpsTurnId; readonly text: string }
    | { readonly type: "reasoning.delta"; readonly turnId: SpecOpsTurnId; readonly reasoningId: string; readonly delta: string }
    | { readonly type: "reasoning.ended"; readonly turnId: SpecOpsTurnId; readonly reasoningId: string; readonly text: string }
    | { readonly type: "tool.started"; readonly turnId: SpecOpsTurnId; readonly toolCall: ToolCallSnapshot }
    | { readonly type: "tool.progress"; readonly turnId: SpecOpsTurnId; readonly callId: string; readonly progress: unknown }
    | { readonly type: "tool.completed"; readonly turnId: SpecOpsTurnId; readonly callId: string; readonly status: ToolCallStatus; readonly output?: unknown }
    | { readonly type: "subtask.started"; readonly turnId: SpecOpsTurnId; readonly subtask: SubtaskSnapshot }
    | { readonly type: "step.started"; readonly turnId: SpecOpsTurnId; readonly step: StepSnapshot }
    | { readonly type: "step.finished"; readonly turnId: SpecOpsTurnId; readonly step: StepSnapshot }
    | { readonly type: "step.failed"; readonly turnId: SpecOpsTurnId; readonly step: StepSnapshot }
    | { readonly type: "attachment.posted"; readonly turnId: SpecOpsTurnId; readonly attachment: AttachmentSnapshot }
    | { readonly type: "diff.posted"; readonly turnId: SpecOpsTurnId; readonly diff: DiffSnapshot }
    | { readonly type: "usage.recorded"; readonly turnId: SpecOpsTurnId; readonly usage: UsageSnapshot; readonly cost?: number }
    | { readonly type: "compaction.applied"; readonly removedMessageCount: number }
    | { readonly type: "permission.requested"; readonly turnId: SpecOpsTurnId; readonly request: PermissionRequest }
    | { readonly type: "question.requested"; readonly turnId: SpecOpsTurnId; readonly request: QuestionRequest }
    | { readonly type: "status.changed"; readonly status: SessionLifecycleStatus }
    | { readonly type: "turn.finished"; readonly turnId: SpecOpsTurnId }
    | { readonly type: "turn.failed"; readonly turnId: SpecOpsTurnId; readonly message: string }
    | { readonly type: "turn.cancelled"; readonly turnId: SpecOpsTurnId }
    | {
        readonly type: "diagnostic";
        readonly level: "info" | "warn" | "error";
        readonly message: string;
        readonly reason?: "unknown-native" | "malformed" | "redacted";
        /** Already-redacted raw payload (never secrets — see {@link redactForSerialization}). */
        readonly redactedRaw?: unknown;
      }
  );

export type DiagnosticLevel = Extract<SessionEvent, { type: "diagnostic" }>["level"];
