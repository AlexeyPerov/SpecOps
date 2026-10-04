import {
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { NativeSessionRef } from "../../../src/lib/session/adapter";
import type { ClaudeProfileStore } from "./profiles";
export interface ClaudeBinding {
  native: NativeSessionRef;
  credentialDigest: string;
  started: boolean;
  cursor: number;
  cost: number;
  users: Record<string, { id: string; createdAt: string }>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class ClaudeBindings {
  constructor(private store: ClaudeProfileStore) {}
  path(native: NativeSessionRef) {
    this.store.require(native.connectionProfileId);
    if (!uuid.test(native.nativeSessionId))
      throw new Error("Invalid native session identifier");
    return join(
      this.store.home(native.connectionProfileId!),
      `session-${native.nativeSessionId}.json`,
    );
  }
  read(native: NativeSessionRef): ClaudeBinding | undefined {
    const path = this.path(native);
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024)
      throw new Error("Invalid native binding storage");
    const value = JSON.parse(readFileSync(path, "utf8")) as ClaudeBinding;
    if (
      !/^[a-f0-9]{64}$/.test(value.credentialDigest) ||
      !value.native ||
      value.native.runtimeId !== "claude" ||
      value.native.nativeSessionId !== native.nativeSessionId ||
      value.native.connectionProfileId !== native.connectionProfileId ||
      !value.users ||
      typeof value.started !== "boolean" ||
      !Number.isSafeInteger(value.cursor) ||
      value.cursor < 0 ||
      !Number.isFinite(value.cost) ||
      value.cost < 0
    )
      throw new Error("Invalid native binding storage");
    if (
      Object.keys(value.users).length > 4096 ||
      Object.entries(value.users).some(
        ([key, user]) =>
          !uuid.test(key) ||
          !user ||
          typeof user.id !== "string" ||
          !user.id ||
          user.id.length > 500 ||
          typeof user.createdAt !== "string" ||
          user.createdAt.length > 50,
      )
    )
      throw new Error("Invalid native user mapping");
    return value;
  }
  save(binding: ClaudeBinding) {
    if (Object.keys(binding.users).length > 4096)
      throw new Error("Native user mapping exceeds capacity");
    const path = this.path(binding.native);
    const serialized = JSON.stringify(binding);
    if (Buffer.byteLength(serialized) > 1024 * 1024)
      throw new Error("Native binding exceeds capacity");
    const temp = path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temp, serialized, { flag: "wx", mode: 0o600 });
      renameSync(temp, path);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
}
