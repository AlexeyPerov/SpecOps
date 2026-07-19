import type { OpencodeSettings } from "../domain/contracts";

/** Default port for the bundled OpenCode sidecar (matches the legacy
 * `DEFAULT_SIDECAR_PORT` constant in `opencode_sidecar.rs`). */
export const DEFAULT_OPENCODE_SIDECAR_PORT = 4096;
export const MIN_OPENCODE_SIDECAR_PORT = 1024;
export const MAX_OPENCODE_SIDECAR_PORT = 65535;
/** Hostname the sidecar binds to. URL mode covers remote hosts; this constant
 * is intentionally not configurable to keep sidecar-mode baseUrl derivation
 * simple (`http://${SIDECAR_HOSTNAME}:${port}`). */
export const OPENCODE_SIDECAR_HOSTNAME = "127.0.0.1";

export const defaultOpencodeSettings: OpencodeSettings = {
  enabled: false,
  mode: "sidecar",
  baseUrl: `http://${OPENCODE_SIDECAR_HOSTNAME}:${DEFAULT_OPENCODE_SIDECAR_PORT}`,
  sidecarPort: DEFAULT_OPENCODE_SIDECAR_PORT,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isOpencodeEnabled(settings?: OpencodeSettings | null): boolean {
  return settings?.enabled ?? false;
}

/**
 * Returns `true` when the candidate is an integer inside the sidecar port
 * range. Rejects NaN, ±Infinity, non-integers, strings, booleans, and out
 * of-range numbers — the same gates {@link normalizeOpencodeSettings} uses.
 */
export function isOpencodeSidecarPort(candidate: unknown): candidate is number {
  return (
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    Number.isInteger(candidate) &&
    candidate >= MIN_OPENCODE_SIDECAR_PORT &&
    candidate <= MAX_OPENCODE_SIDECAR_PORT
  );
}

/**
 * Returns `http://${OPENCODE_SIDECAR_HOSTNAME}:${port}` — the baseUrl the
 * sidecar will actually listen on. Sidecar mode keeps `baseUrl` in sync
 * with this helper so the UI's URL mode field never sees a sidecar URL.
 */
export function buildOpencodeSidecarBaseUrl(port: number): string {
  return `http://${OPENCODE_SIDECAR_HOSTNAME}:${port}`;
}

/**
 * Returns a user-facing error string when `port` is not a valid sidecar
 * port, or `null` when it is. Empty string is treated as "missing" and
 * surfaced to the user as a required-field message (the sidecar must bind
 * somewhere).
 */
export function validateOpencodeSidecarPort(port: number): string | null {
  if (!Number.isFinite(port) || !Number.isInteger(port)) {
    return `Sidecar port must be a whole number between ${MIN_OPENCODE_SIDECAR_PORT} and ${MAX_OPENCODE_SIDECAR_PORT}.`;
  }
  if (port < MIN_OPENCODE_SIDECAR_PORT || port > MAX_OPENCODE_SIDECAR_PORT) {
    return `Sidecar port must be between ${MIN_OPENCODE_SIDECAR_PORT} and ${MAX_OPENCODE_SIDECAR_PORT} (got ${port}).`;
  }
  return null;
}

export function normalizeOpencodeSettings(input?: unknown): OpencodeSettings {
  const source = isRecord(input) ? input : {};
  const enabled = isBoolean(source.enabled) ? source.enabled : false;
  const mode = source.mode === "url" ? "url" : "sidecar";
  const sidecarPort = isOpencodeSidecarPort(source.sidecarPort)
    ? source.sidecarPort
    : DEFAULT_OPENCODE_SIDECAR_PORT;
  // In sidecar mode the baseUrl is derived from the configured port so the
  // health probe and SDK wiring stay consistent. In URL mode the user-
  // supplied baseUrl is preserved verbatim (with trim + non-empty gate);
  // sidecarPort is still carried so a future switch to sidecar mode is
  // one click away.
  const baseUrl =
    mode === "sidecar"
      ? buildOpencodeSidecarBaseUrl(sidecarPort)
      : typeof source.baseUrl === "string" && source.baseUrl.trim().length > 0
        ? source.baseUrl.trim()
        : defaultOpencodeSettings.baseUrl;
  return { enabled, mode, baseUrl, sidecarPort };
}

export function validateOpencodeBaseUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return "OpenCode server URL is required in URL mode.";
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a valid OpenCode URL, for example https://opencode.example.com.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "OpenCode URL must start with http:// or https://.";
  }
  return null;
}