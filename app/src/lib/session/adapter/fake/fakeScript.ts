/**
 * Declarative script for the deterministic fake runtime (phase C, task C-03).
 *
 * A {@link FakeRuntimeConfig} describes exactly how the fake responds: which
 * events to emit per turn, whether to require auth, whether to pause on a
 * permission/question, whether to inject errors/unknown events, and how to
 * behave on cancel/restart. Nothing here touches the network, the clock (beyond
 * an optional, deterministic microtask tick), or a vendor binary — so tests can
 * reproduce every common UI state without races.
 *
 * Scripts are matched by **exact prompt** first, then by a configured default.
 * A prompt that matches nothing falls back to the default turn; if there is no
 * default either, the fake emits a minimal finished turn.
 */

import type { AdapterErrorCode } from "../errors";
import type { AdapterHealthStatus } from "../adapter";
import type { AgentCapabilityValue } from "../../capabilities";
import type {
  AttachmentSnapshot,
  DiagnosticLevel,
  DiffSnapshot,
  StepSnapshot,
  SubtaskSnapshot,
  UsageSnapshot,
} from "../../events";
import type { AgentModelDescriptor, AgentModeDescriptor } from "../../binding";

/** A single scripted happening inside a turn (deterministic, no real I/O). */
export type FakeScriptedEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "text.delta"; readonly delta: string }
  | { readonly kind: "reasoning"; readonly id: string; readonly text: string }
  | {
      readonly kind: "tool";
      readonly callId: string;
      readonly toolName: string;
      readonly status?: "pending" | "running" | "success" | "failure";
      readonly input?: unknown;
      readonly output?: unknown;
    }
  | { readonly kind: "usage"; readonly usage: UsageSnapshot; readonly cost?: number }
  | { readonly kind: "diff"; readonly diff: DiffSnapshot }
  | { readonly kind: "step"; readonly step: StepSnapshot }
  | { readonly kind: "subtask"; readonly subtask: SubtaskSnapshot }
  | { readonly kind: "attachment"; readonly attachment: AttachmentSnapshot }
  | { readonly kind: "status"; readonly status: FakeStatusChange }
  | {
      readonly kind: "permission";
      readonly permissionId: string;
      readonly label: string;
      readonly payload?: unknown;
    }
  | {
      readonly kind: "question";
      readonly questionId: string;
      readonly prompt: string;
      readonly choices?: string[];
      readonly payload?: unknown;
    }
  | {
      readonly kind: "diagnostic";
      readonly level: DiagnosticLevel;
      readonly message: string;
      readonly reason?: "unknown-native" | "malformed" | "redacted";
      readonly raw?: unknown;
    }
  /** Unrecognized native shape — coerced into a redacted `diagnostic` event. */
  | { readonly kind: "unknown-native"; readonly raw: unknown; readonly message?: string }
  /** Malformed native payload — coerced into a redacted `diagnostic` event. */
  | { readonly kind: "malformed"; readonly raw: unknown; readonly message: string };

export type FakeStatusChange =
  | "running"
  | "waiting-permission"
  | "waiting-question"
  | "idle";

/** How a scripted turn terminates (if not cancelled first). */
export type FakeTurnOutcome =
  | { readonly outcome: "finish" }
  | { readonly outcome: "fail"; readonly code?: AdapterErrorCode; readonly message: string }
  | { readonly outcome: "hang" };

export interface FakeTurnScript {
  readonly events?: readonly FakeScriptedEvent[];
  readonly outcome?: FakeTurnOutcome;
  /**
   * Pause the stream after emitting the matching permission/question event
   * until a reply arrives (interactive mode). When `false`, the permission /
   * question is emitted and the turn continues without waiting.
   */
  readonly awaitReply?: boolean;
}

export interface FakeAuthConfig {
  readonly status: "not-required" | "authenticated" | "challenge";
  readonly challenge?: {
    readonly kind: "url" | "code" | "form";
    readonly url?: string;
    readonly code?: string;
    readonly message?: string;
  };
  /** Reject auth with this code (e.g. "authentication-failed"). */
  readonly fail?: AdapterErrorCode;
}

export interface FakeRuntimeConfig {
  /**
   * Per-prompt scripts. The key is matched against the turn's prompt **exactly**
   * (after trim). Use {@link FakeRuntimeConfig.defaultTurn} for the fallback.
   */
  readonly turns?: Readonly<Record<string, FakeTurnScript>>;
  /** Fallback turn for prompts without an explicit script. */
  readonly defaultTurn?: FakeTurnScript;
  /** Authentication behavior (default: not-required). */
  readonly auth?: FakeAuthConfig;
  /** Advertised capabilities (default: inferred from implemented extensions). */
  readonly capabilities?: readonly AgentCapabilityValue[];
  /** Health status reported by `health()` (default: healthy). */
  readonly healthStatus?: AdapterHealthStatus;
  readonly healthMessage?: string;
  readonly runtimeVersion?: string;
  /** Models/modes returned by the catalog extension. */
  readonly models?: readonly AgentModelDescriptor[];
  readonly modes?: readonly AgentModeDescriptor[];
  readonly defaultModelId?: string;
  readonly defaultModeId?: string;
  /**
   * Insert a microtask yield (`Promise.resolve()`) between scripted events so
   * that cancellation and replies can interleave deterministically. Defaults to
   * `true`; set `false` for fully synchronous streaming.
   */
  readonly tick?: boolean;
  /** Throw this code from `createSession` (e.g. "runtime-unavailable"). */
  readonly failCreate?: AdapterErrorCode;
  /** Throw this code from `resumeSession` for unknown native session ids. */
  readonly failResumeUnknown?: boolean;
}
