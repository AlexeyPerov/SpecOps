import { validCursorMetadata } from "./policy";
import { constants, openSync, fstatSync, readFileSync, closeSync, writeFileSync, renameSync, unlinkSync, mkdirSync, lstatSync, existsSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeSessionRef } from "../../../src/lib/session/adapter";
import type { CursorProfileStore } from "./profiles";
export interface CursorBinding {
  native: NativeSessionRef;
  storeId: string;
  credentialDigest: string;
  cursor: number;
  users: Record<string, { id: string; createdAt: string; runId?: string; settled: boolean }>;
}
const nativeId = /^agent-[a-zA-Z0-9_-]{1,150}$/;
const storeId = /^[a-f0-9-]{36}$/;
export class CursorBindings {
  constructor(readonly profiles: CursorProfileStore) {}
  store(profileId: string, id: string) {
    if (!storeId.test(id)) throw new Error("Invalid native store identifier");
    const root = join(this.profiles.home(profileId), "native", "agents");
    for (const path of [join(this.profiles.home(profileId), "native"), root, join(root, id)]) {
      if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) throw new Error("Unsafe native store");
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    return join(root, id);
  }
  private path(native: NativeSessionRef) {
    this.profiles.require(native.connectionProfileId);
    if (native.runtimeId !== "cursor" || !nativeId.test(native.nativeSessionId)) throw new Error("Invalid native agent identifier");
    return join(this.profiles.home(native.connectionProfileId!), `session-${native.nativeSessionId}.json`);
  }
  read(native: NativeSessionRef): CursorBinding | undefined {
    let fd: number;
    try { fd = openSync(this.path(native), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw new Error("Native binding unavailable"); }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 1048576 || (process.platform !== "win32" && stat.mode & 0o077)) throw new Error("Unsafe native binding");
      const b = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(fd))) as CursorBinding;
      if (!b || !b.native || b.native.runtimeId !== "cursor" || b.native.nativeSessionId !== native.nativeSessionId || b.native.connectionProfileId !== native.connectionProfileId || !storeId.test(b.storeId) || !/^[a-f0-9]{64}$/.test(b.credentialDigest) || !Number.isSafeInteger(b.cursor) || b.cursor < 0 || !b.users || typeof b.users !== "object" || Array.isArray(b.users) || Object.keys(b.users).length > 4096 || Object.entries(b.users).some(([id, u]) => !id || id.length > 500 || !u || typeof u.id !== "string" || u.id !== id || typeof u.createdAt !== "string" || u.createdAt.length > 50 || typeof u.settled !== "boolean" || (u.runId !== undefined && !/^run-[A-Za-z0-9_-]{1,150}$/.test(u.runId)))) throw new Error("Invalid native binding");
      const n = b.native, meta = n.runtimeMetadata;
      if (Object.keys(b).some((k) => !["native", "storeId", "credentialDigest", "cursor", "users"].includes(k)) || Object.keys(n).some((k) => !["runtimeId", "nativeSessionId", "connectionProfileId", "modelId", "modeId", "runtimeMetadata"].includes(k)) || typeof n.modelId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(n.modelId) || n.modeId !== "agent" || !meta || !validCursorMetadata(meta) || Object.values(b.users).some((u) => Object.keys(u).some((k) => !["id", "createdAt", "runId", "settled"].includes(k)) || !Number.isFinite(Date.parse(u.createdAt)) || new Date(u.createdAt).toISOString() !== u.createdAt)) throw new Error("Invalid native immutable binding");
      b.users = Object.assign(Object.create(null), b.users);
      return b;
    } finally { closeSync(fd); }
  }
  save(b: CursorBinding) {
    const path = this.path(b.native), text = JSON.stringify(b), temp = path + "." + randomUUID() + ".tmp";
    if (Buffer.byteLength(text) > 1048576 || Object.keys(b.users).length > 4096) throw new Error("Native mapping exceeds capacity");
    try {
      const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, path);
      const parent = openSync(this.profiles.home(b.native.connectionProfileId!), constants.O_RDONLY);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } finally { if (existsSync(temp)) unlinkSync(temp); }
  }
}
