import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  fchmodSync,
  ftruncateSync,
  openSync,
  closeSync,
  constants,
  fstatSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validProfileId } from "../codex/profiles";
import { redactForSerialization } from "../redact";
export interface ClaudeProfile {
  id: string;
  runtimeId: "claude";
  label: string;
  createdAt: string;
}
function privateDirectory(path: string) {
  if (
    existsSync(path) &&
    (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
  )
    throw new Error("Unsafe profile directory");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}
export class ClaudeProfileStore {
  constructor(readonly root: string) {
    privateDirectory(root);
  }
  home(id: string) {
    if (!validProfileId(id)) throw new Error("Invalid profile");
    const p = join(this.root, id);
    privateDirectory(p);
    return p;
  }
  list(): ClaudeProfile[] {
    return readdirSync(this.root)
      .filter(validProfileId)
      .flatMap((id) => {
        try {
          const p = join(this.home(id), "profile.json");
          if (lstatSync(p).isSymbolicLink()) return [];
          const v = JSON.parse(readFileSync(p, "utf8"));
          if (
            v.id !== id ||
            v.runtimeId !== "claude" ||
            typeof v.label !== "string" ||
            typeof v.createdAt !== "string"
          )
            return [];
          return [
            {
              id,
              runtimeId: "claude" as const,
              label: String(redactForSerialization(v.label)),
              createdAt: v.createdAt,
            },
          ];
        } catch {
          return [];
        }
      });
  }
  require(id: unknown) {
    const p = this.list().find((p) => p.id === id);
    if (!p) throw new Error("Claude profile not found");
    return p;
  }
  create(label: string): ClaudeProfile {
    const p: ClaudeProfile = {
      id: randomUUID(),
      runtimeId: "claude",
      label:
        String(redactForSerialization(label.trim().slice(0, 80))) ||
        "Claude profile",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(this.home(p.id), "profile.json"), JSON.stringify(p), {
      flag: "wx",
      mode: 0o600,
    });
    return p;
  }
  readKey(id: string, name = "credential"): string | undefined {
    const path = join(this.home(id), name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("Credential file unavailable");
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 8192 ||
      (process.platform !== "win32" && stat.mode & 0o077)
    )
      throw new Error("Credential file must be private and bounded");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const current = fstatSync(fd);
      if (
        current.ino !== stat.ino ||
        current.dev !== stat.dev ||
        current.size > 8192 ||
        (process.platform !== "win32" && current.mode & 0o077)
      )
        throw new Error("Credential file changed");
      const key = readFileSync(fd, "utf8").trim();
      if (!key || /[\r\n\x00]/.test(key))
        throw new Error("Invalid credential file");
      return key;
    } finally {
      closeSync(fd);
    }
  }
  importKey(id: string) {
    const key = this.readKey(id, "api-key");
    if (!key)
      throw new Error(
        "Place a private api-key file in the selected profile home",
      );
    return key;
  }
  saveKey(id: string, key: string) {
    const p = join(this.home(id), "credential");
    const existing = this.readKey(id);
    const original = existing ? lstatSync(p) : undefined;
    const fd = openSync(
      p,
      constants.O_WRONLY |
        constants.O_CREAT |
        (existing ? 0 : constants.O_EXCL) |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      const stat = fstatSync(fd);
      if (
        (original &&
          (stat.ino !== original.ino || stat.dev !== original.dev)) ||
        !stat.isFile() ||
        stat.size > 8192 ||
        (process.platform !== "win32" && stat.mode & 0o077)
      )
        throw new Error("Unsafe credential storage");
      fchmodSync(fd, 0o600);
      ftruncateSync(fd, 0);
      writeFileSync(fd, key);
    } finally {
      closeSync(fd);
    }
  }
  logout(id: string) {
    const p = join(this.home(id), "credential");
    if (existsSync(p)) {
      this.readKey(id);
      unlinkSync(p);
    }
  }
  consumeImport(id: string, key: string) {
    if (this.readKey(id, "api-key") === key)
      unlinkSync(join(this.home(id), "api-key"));
  }
  environment(
    id: string,
    key?: string,
    ambient: NodeJS.ProcessEnv = process.env,
  ): NodeJS.ProcessEnv {
    const home = this.home(id);
    const config = join(home, "native");
    privateDirectory(config);
    // Allow only process essentials: provider, proxy, injected Node options and credential environments never inherit.
    const env: NodeJS.ProcessEnv = {};
    for (const name of [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "LC_ALL",
    ])
      if (ambient[name]) env[name] = ambient[name];
    return {
      ...env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: config,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: home,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_AGENT_SDK_CLIENT_APP: "specops/0.1.0",
      ...(key ? { ANTHROPIC_API_KEY: key } : {}),
    };
  }
}
