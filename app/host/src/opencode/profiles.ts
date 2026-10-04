import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validProfileId } from "../codex/profiles";
import { redactForLogs } from "../redact";
export interface RuntimeProfile {
  id: string;
  runtimeId: "opencode";
  label: string;
  createdAt: string;
  ownership: "local" | "external";
  endpoint?: string;
}
function directory(path: string): void {
  if (
    existsSync(path) &&
    (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
  )
    throw new Error("Unsafe runtime profile storage");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
export function endpoint(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("External endpoint is required");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol === "http:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  )
    throw new Error(
      "Use a loopback HTTP or HTTPS endpoint without credentials",
    );
  return url.origin;
}
export class RuntimeProfileStore {
  constructor(readonly root: string) {
    directory(root);
  }
  home(id: string): string {
    if (!validProfileId(id)) throw new Error("Invalid runtime profile");
    const path = join(this.root, id);
    directory(path);
    return path;
  }
  list(): RuntimeProfile[] {
    return readdirSync(this.root)
      .filter(validProfileId)
      .flatMap((id) => {
        try {
          const home = this.home(id);
          const file = join(home, "profile.json");
          if (lstatSync(file).isSymbolicLink())
            throw new Error("Unsafe profile metadata");
          const raw = JSON.parse(readFileSync(file, "utf8")) as RuntimeProfile;
          if (
            raw.id !== id ||
            raw.runtimeId !== "opencode" ||
            typeof raw.label !== "string" ||
            typeof raw.createdAt !== "string" ||
            !["local", "external"].includes(raw.ownership)
          )
            throw new Error("Invalid runtime profile");
          return [
            {
              id,
              runtimeId: "opencode" as const,
              label: String(redactForLogs(raw.label)),
              createdAt: raw.createdAt,
              ownership: raw.ownership,
              ...(raw.ownership === "external"
                ? { endpoint: endpoint(raw.endpoint) }
                : {}),
            },
          ];
        } catch {
          return [];
        }
      });
  }
  require(id: unknown): RuntimeProfile {
    const value = this.list().find((p) => p.id === id);
    if (!value) throw new Error("Runtime profile not found");
    return value;
  }
  create(label: string, external?: unknown): RuntimeProfile {
    const profile: RuntimeProfile = {
      id: randomUUID(),
      runtimeId: "opencode",
      label:
        String(redactForLogs(label.trim().slice(0, 80))) || "OpenCode profile",
      createdAt: new Date().toISOString(),
      ownership: external === undefined ? "local" : "external",
      ...(external === undefined ? {} : { endpoint: endpoint(external) }),
    };
    const home = this.home(profile.id);
    writeFileSync(join(home, "profile.json"), JSON.stringify(profile), {
      mode: 0o600,
      flag: "wx",
    });
    writeFileSync(
      join(home, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        share: "disabled",
        autoupdate: false,
      }),
      { mode: 0o600, flag: "wx" },
    );
    return profile;
  }
  secure(id: string): void {
    const home = this.home(id);
    for (const name of ["data", "config", "cache", "state"])
      directory(join(home, name));
    directory(join(home, "data", "opencode"));
    for (const path of [
      join(home, "opencode.json"),
      join(home, "data", "opencode", "auth.json"),
    ]) {
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("Unsafe runtime credential storage");
      chmodSync(path, 0o600);
    }
  }
  environment(
    id: string,
    ambient: NodeJS.ProcessEnv = process.env,
  ): NodeJS.ProcessEnv {
    this.secure(id);
    const home = this.home(id);
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(ambient))
      if (
        !/^(OPENCODE_|SPECOPS_|CODEX_|OPENAI_|ANTHROPIC_|AZURE_|AWS_|GOOGLE_|GEMINI_|GROQ_|MISTRAL_|COHERE_|DEEPSEEK_|OPENROUTER_|XDG_)/i.test(
          key,
        ) &&
        !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)$/i.test(key)
      )
        env[key] = value;
    for (const name of ["data", "config", "cache", "state"])
      directory(join(home, name));
    return {
      ...env,
      HOME: home,
      USERPROFILE: home,
      XDG_DATA_HOME: join(home, "data"),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
      OPENCODE_CONFIG: join(home, "opencode.json"),
      OPENCODE_DISABLE_AUTOUPDATE: "true",
    };
  }
}
