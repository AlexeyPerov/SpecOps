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

export async function attachOpencodeSidecarWorkspace(
  directory: string,
): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_attach_workspace", { directory });
}

export async function startOpencodeSidecar(directory: string): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_start", { directory });
}

export async function stopOpencodeSidecar(): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_stop");
}

export async function restartOpencodeSidecar(
  directory: string,
): Promise<OpencodeSidecarStatus> {
  return invoke<OpencodeSidecarStatus>("opencode_sidecar_restart", { directory });
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
