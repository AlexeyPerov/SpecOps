import type { OpencodeSettings } from "../domain/contracts";

export const defaultOpencodeSettings: OpencodeSettings = {
  enabled: true,
  mode: "sidecar",
  baseUrl: "http://127.0.0.1:4096",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isOpencodeEnabled(settings?: OpencodeSettings | null): boolean {
  return settings?.enabled ?? true;
}

export function normalizeOpencodeSettings(input?: unknown): OpencodeSettings {
  const source = isRecord(input) ? input : {};
  const enabled = isBoolean(source.enabled) ? source.enabled : true;
  const mode = source.mode === "url" ? "url" : "sidecar";
  const baseUrl =
    typeof source.baseUrl === "string" && source.baseUrl.trim().length > 0
      ? source.baseUrl.trim()
      : defaultOpencodeSettings.baseUrl;
  return { enabled, mode, baseUrl };
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
