import { join } from "@tauri-apps/api/path";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import { ensureSpecOpsDataDir } from "./appDataDir";

const FILE_NAME = "provider-secrets.json";

interface ProviderSecretsFileV1 {
  version: 1;
  keys: Record<string, string>;
}

export const OPENCODE_SERVER_PASSWORD_KEY = "opencode.serverPassword";

async function getSecretsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

function normalizeApiKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSecretsFile(raw: unknown): ProviderSecretsFileV1 {
  if (!raw || typeof raw !== "object") {
    return { version: 1, keys: {} };
  }
  const parsed = raw as Partial<ProviderSecretsFileV1>;
  if (parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== "object") {
    return { version: 1, keys: {} };
  }
  const keys: Record<string, string> = {};
  for (const [providerOrConnectionId, apiKey] of Object.entries(parsed.keys)) {
    const normalizedKey = normalizeApiKey(apiKey);
    if (normalizedKey.length === 0) {
      continue;
    }
    keys[providerOrConnectionId] = normalizedKey;
  }
  return { version: 1, keys };
}

/** Loads OpenCode server password from dedicated secrets storage. */
export async function loadOpencodeServerPassword(): Promise<string> {
  try {
    const path = await getSecretsPath();
    const raw = await readTextFile(path);
    const parsed = normalizeSecretsFile(JSON.parse(raw));
    return normalizeApiKey(parsed.keys[OPENCODE_SERVER_PASSWORD_KEY]);
  } catch {
    return "";
  }
}

/** Persists OpenCode server password to dedicated secrets storage. */
export async function saveOpencodeServerPassword(password: string): Promise<void> {
  const path = await getSecretsPath();
  let existing: ProviderSecretsFileV1 = { version: 1, keys: {} };
  try {
    const raw = await readTextFile(path);
    existing = normalizeSecretsFile(JSON.parse(raw));
  } catch {
    // Start fresh when the secrets file is missing or invalid.
  }

  const keys = { ...existing.keys };
  const trimmed = password.trim();
  if (trimmed.length === 0) {
    delete keys[OPENCODE_SERVER_PASSWORD_KEY];
  } else {
    keys[OPENCODE_SERVER_PASSWORD_KEY] = trimmed;
  }

  const payload: ProviderSecretsFileV1 = {
    version: 1,
    keys,
  };
  await atomicWriteTextFile(path, JSON.stringify(payload, null, 2));
}
