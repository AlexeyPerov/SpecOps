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
export interface CursorProfile {
  id: string;
  runtimeId: "cursor";
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
export class CursorProfileStore {
  constructor(readonly root: string) {
    privateDirectory(root);
  }
  home(id: string) {
    if (!validProfileId(id)) throw new Error("Invalid profile");
    const p = join(this.root, id);
    privateDirectory(p);
    return p;
  }
  list(): CursorProfile[] {
    return readdirSync(this.root)
      .filter(validProfileId)
      .flatMap((id) => {
        try {
          const p = join(this.home(id), "profile.json");
          if (lstatSync(p).isSymbolicLink()) return [];
          const v = JSON.parse(this.readKey(id, "profile.json")!);
          if (
            v.id !== id ||
            v.runtimeId !== "cursor" ||
            typeof v.label !== "string" || v.label.length > 80 ||
            typeof v.createdAt !== "string" ||
            v.createdAt.length > 40 ||
            !Number.isFinite(Date.parse(v.createdAt)) ||
            new Date(v.createdAt).toISOString() !== v.createdAt
          )
            return [];
          return [
            {
              id,
              runtimeId: "cursor" as const,
              label: String(redactForSerialization(v.label)).slice(0, 80),
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
    if (!p) throw new Error("Cursor profile not found");
    return p;
  }
  create(label: string): CursorProfile {
    if (label.trim().length > 80) throw new Error("Profile label exceeds 80 characters");
    const p: CursorProfile = {
      id: randomUUID(),
      runtimeId: "cursor",
      label:
        String(redactForSerialization(label.trim())).slice(0, 80) ||
        "Cursor profile",
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
    const fd = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const current = fstatSync(fd);
      if (
        !current.isFile() ||
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
    const profile = this.require(id);
    let label = profile.label;
    for (const secret of [this.readKey(id), key]) if (secret) label = label.replaceAll(secret, "[REDACTED]");
    if (label !== profile.label) {
      const file = join(this.home(id), "profile.json");
      const original = lstatSync(file);
      const fd = openSync(file, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try { const stat = fstatSync(fd); if (original.isSymbolicLink() || stat.ino !== original.ino || stat.dev !== original.dev || !stat.isFile() || stat.size > 8192 || (process.platform !== "win32" && stat.mode & 0o077)) throw new Error("Unsafe profile metadata"); ftruncateSync(fd, 0); writeFileSync(fd, JSON.stringify({ ...profile, label })); } finally { closeSync(fd); }
    }
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
    _key?: string,
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
      CURSOR_CONFIG_DIR: config,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: home,
    };
  }
}
