import { invoke } from "@tauri-apps/api/core";

export type SidecarHealthStatus =
  | "unknown"
  | "checking"
  | "healthy"
  | "degraded"
  | "error";

export type OpencodeSidecarErrorKind =
  | "portInUse"
  | "missingBinary"
  | "launchFailure"
  | "healthTimeout"
  | "staleProcess"
  | "notRunning"
  | "internal";

export interface OpencodeSidecarErrorBase {
  kind: OpencodeSidecarErrorKind;
  message: string;
}

export interface OpencodeSidecarPortInUseError extends OpencodeSidecarErrorBase {
  kind: "portInUse";
  port: number;
}

export interface OpencodeSidecarMissingBinaryError extends OpencodeSidecarErrorBase {
  kind: "missingBinary";
}

export interface OpencodeSidecarLaunchFailureError extends OpencodeSidecarErrorBase {
  kind: "launchFailure";
  exitCode: number | null;
}

export interface OpencodeSidecarHealthTimeoutError extends OpencodeSidecarErrorBase {
  kind: "healthTimeout";
  port: number;
  attempts: number;
}

export interface OpencodeSidecarStaleProcessError extends OpencodeSidecarErrorBase {
  kind: "staleProcess";
}

export interface OpencodeSidecarNotRunningError extends OpencodeSidecarErrorBase {
  kind: "notRunning";
}

export interface OpencodeSidecarInternalError extends OpencodeSidecarErrorBase {
  kind: "internal";
}

export type OpencodeSidecarError =
  | OpencodeSidecarPortInUseError
  | OpencodeSidecarMissingBinaryError
  | OpencodeSidecarLaunchFailureError
  | OpencodeSidecarHealthTimeoutError
  | OpencodeSidecarStaleProcessError
  | OpencodeSidecarNotRunningError
  | OpencodeSidecarInternalError;

export interface OpencodeSidecarStatus {
  running: boolean;
  baseUrl: string | null;
  health: SidecarHealthStatus;
  directory: string | null;
  port: number | null;
  pid: number | null;
  lastError: OpencodeSidecarError | null;
}

export function isOpencodeSidecarError(value: unknown): value is OpencodeSidecarError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "portInUse" ||
    kind === "missingBinary" ||
    kind === "launchFailure" ||
    kind === "healthTimeout" ||
    kind === "staleProcess" ||
    kind === "notRunning" ||
    kind === "internal"
  );
}

/**
 * M14-T4 — invoke wrappers for the OpenCode sidecar Tauri commands.
 *
 * The Rust sidecar accepts an optional `port` override (`u16`). When `Some`,
 * the sidecar (re)starts on that port before attaching to `directory`; when
 * `None`, the existing configured port is kept (default `4096` on first
 * attach). Settings UI passes the user's `opencode.sidecarPort` on attach;
 * Send / Settings Check connection / Refresh model list / config sub-panel
 * callers forward the same value so the running sidecar reflects the
 * persisted setting.
 */

export interface OpencodeSidecarAttachInput {
  directory: string;
  /** Optional port override (1024–65535). `undefined` keeps the existing
   * configured port. */
  port?: number;
}

export async function attachOpencodeSidecarWorkspace(
  input: OpencodeSidecarAttachInput,
): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_attach_workspace", {
    directory: input.directory,
    ...(input.port !== undefined ? { port: input.port } : {}),
  });
}

export async function startOpencodeSidecar(
  input: OpencodeSidecarAttachInput,
): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_start", {
    directory: input.directory,
    ...(input.port !== undefined ? { port: input.port } : {}),
  });
}

export async function stopOpencodeSidecar(): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_stop");
}

export async function restartOpencodeSidecar(
  input: OpencodeSidecarAttachInput,
): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_restart", {
    directory: input.directory,
    ...(input.port !== undefined ? { port: input.port } : {}),
  });
}

export async function getOpencodeSidecarStatus(): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_status");
}

export function healthFromSidecarStatus(status: SidecarHealthStatus): import("../domain/contracts").OpencodeHealthStatus {
  switch (status) {
    case "healthy":
      return "healthy";
    case "degraded":
      return "degraded";
    case "error":
      return "error";
    case "checking":
      return "checking";
    default:
      return "unknown";
  }
}
