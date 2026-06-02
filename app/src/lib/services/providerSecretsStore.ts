import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChatProviderId } from "../domain/contracts";
import { ensureSpecOpsDataDir } from "./appDataDir";

const FILE_NAME = "provider-secrets.json";

interface ProviderSecretsFileV1 {
  version: 1;
  keys: Partial<Record<ChatProviderId, string>>;
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
  const keys: Partial<Record<ChatProviderId, string>> = {};
  for (const [providerId, apiKey] of Object.entries(parsed.keys)) {
    keys[providerId as ChatProviderId] = normalizeApiKey(apiKey);
  }
  return { version: 1, keys };
}

/** Loads a provider API key from a dedicated secrets file (never settings.json). */
export async function loadProviderApiKey(providerId: ChatProviderId): Promise<string> {
  try {
    const path = await getSecretsPath();
    const raw = await readTextFile(path);
    const parsed = normalizeSecretsFile(JSON.parse(raw));
    return normalizeApiKey(parsed.keys[providerId]);
  } catch {
    return "";
  }
}

/** Persists a provider API key to a dedicated secrets file (never settings.json). */
export async function saveProviderApiKey(
  providerId: ChatProviderId,
  apiKey: string,
): Promise<void> {
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
    delete keys[providerId];
  } else {
    keys[providerId] = trimmed;
  }

  const payload: ProviderSecretsFileV1 = {
    version: 1,
    keys,
  };
  await writeTextFile(path, JSON.stringify(payload, null, 2));
}
