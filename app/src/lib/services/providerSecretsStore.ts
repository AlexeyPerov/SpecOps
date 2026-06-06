import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { DEFAULT_HTTP_CONNECTION_ID } from "../ai/providers/httpConnectionSettings";

const FILE_NAME = "provider-secrets.json";

interface ProviderSecretsFileV1 {
  version: 1;
  keys: Record<string, string>;
}

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
  // One-time legacy read normalization: old files used provider id "http".
  if (!keys[DEFAULT_HTTP_CONNECTION_ID] && keys.http) {
    keys[DEFAULT_HTTP_CONNECTION_ID] = keys.http;
  }
  return { version: 1, keys };
}

/** Loads one API key by connection id from dedicated secrets storage. */
export async function loadConnectionApiKey(connectionId: string): Promise<string> {
  try {
    const path = await getSecretsPath();
    const raw = await readTextFile(path);
    const parsed = normalizeSecretsFile(JSON.parse(raw));
    return normalizeApiKey(parsed.keys[connectionId]);
  } catch {
    return "";
  }
}

/** Loads all API keys keyed by HTTP connection id from dedicated secrets storage. */
export async function loadConnectionApiKeys(): Promise<Record<string, string>> {
  try {
    const path = await getSecretsPath();
    const raw = await readTextFile(path);
    const parsed = normalizeSecretsFile(JSON.parse(raw));
    return { ...parsed.keys };
  } catch {
    return {};
  }
}

/** Persists one connection API key to dedicated secrets storage. */
export async function saveConnectionApiKey(connectionId: string, apiKey: string): Promise<void> {
  const path = await getSecretsPath();
  let existing: ProviderSecretsFileV1 = { version: 1, keys: {} };
  try {
    const raw = await readTextFile(path);
    existing = normalizeSecretsFile(JSON.parse(raw));
  } catch {
    // Start fresh when the secrets file is missing or invalid.
  }

  const keys = { ...existing.keys };
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    delete keys[connectionId];
  } else {
    keys[connectionId] = trimmed;
  }

  const payload: ProviderSecretsFileV1 = {
    version: 1,
    keys,
  };
  await writeTextFile(path, JSON.stringify(payload, null, 2));
}

/** Deletes one connection API key from dedicated secrets storage. */
export async function deleteConnectionApiKey(connectionId: string): Promise<void> {
  await saveConnectionApiKey(connectionId, "");
}

/** @deprecated Use `loadConnectionApiKey`. */
export async function loadProviderApiKey(providerId: string): Promise<string> {
  return loadConnectionApiKey(providerId);
}

/** @deprecated Use `saveConnectionApiKey`. */
export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  await saveConnectionApiKey(providerId, apiKey);
}
