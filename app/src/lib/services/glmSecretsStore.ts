import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";

const FILE_NAME = "glm-secrets.json";

interface GlmSecretsFileV1 {
  version: 1;
  apiKey: string;
}

async function getSecretsPath(): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  return join(base, FILE_NAME);
}

function normalizeApiKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Loads the GLM API key from a dedicated secrets file (never settings.json). */
export async function loadGlmApiKey(): Promise<string> {
  try {
    const path = await getSecretsPath();
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as Partial<GlmSecretsFileV1>;
    if (parsed.version !== 1) {
      return "";
    }
    return normalizeApiKey(parsed.apiKey);
  } catch {
    return "";
  }
}

/** Persists the GLM API key to a dedicated secrets file (never settings.json). */
export async function saveGlmApiKey(apiKey: string): Promise<void> {
  const path = await getSecretsPath();
  const payload: GlmSecretsFileV1 = {
    version: 1,
    apiKey: apiKey.trim(),
  };
  await writeTextFile(path, JSON.stringify(payload, null, 2));
}
