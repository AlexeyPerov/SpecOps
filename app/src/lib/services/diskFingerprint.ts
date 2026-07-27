import { stat } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint } from "../domain/contracts";
import { isCaseInsensitivePathPlatform } from "./platform";

function stripTrailingSlashes(path: string): string {
  let normalized = path.replaceAll("\\", "/");
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Preserve-case path form for persistence and display.
 * Slash-normalizes and strips trailing separators; does not fold case.
 */
export function normalizePathForStorage(path: string): string {
  return stripTrailingSlashes(path);
}

/**
 * Comparison / map key for paths.
 *
 * Slash-normalizes and case-folds on macOS and Windows (case-insensitive
 * default filesystems). Prefer {@link normalizePathForStorage} when persisting
 * a path so case-sensitive volumes keep the real casing.
 */
export function normalizePathSync(path: string): string {
  const normalized = stripTrailingSlashes(path);
  if (isCaseInsensitivePathPlatform()) {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePathSync(a) === normalizePathSync(b);
}

export function fingerprintsEqual(a: DiskFingerprint, b: DiskFingerprint): boolean {
  if (a.mtimeMs !== b.mtimeMs || a.sizeBytes !== b.sizeBytes) {
    return false;
  }
  if (a.contentHash !== undefined && b.contentHash !== undefined) {
    return a.contentHash === b.contentHash;
  }
  return true;
}

export function diskChanged(
  known: DiskFingerprint | null,
  current: DiskFingerprint,
): boolean {
  if (!known) {
    return true;
  }
  if (known.mtimeMs !== current.mtimeMs || known.sizeBytes !== current.sizeBytes) {
    return true;
  }
  if (known.contentHash !== undefined && current.contentHash !== undefined) {
    return known.contentHash !== current.contentHash;
  }
  // Size-only (null mtime → 0) cannot prove the file is unchanged unless we
  // already have a content hash on the known side for a later verify step.
  if (known.mtimeMs === 0 && known.contentHash === undefined) {
    return true;
  }
  return false;
}

/**
 * Metadata matched, but content may still have changed (coarse mtime, or a
 * watcher event that arrived without an mtime bump). Caller should re-hash.
 */
export function needsContentHashVerification(
  known: DiskFingerprint,
  trigger: "watcher" | "focus" | "tab" | "startup" | "manual",
): boolean {
  if (known.contentHash === undefined) {
    return false;
  }
  if (known.mtimeMs === 0) {
    return true;
  }
  return trigger === "watcher";
}

export function shouldSkipAsDismissed(
  dismissed: DiskFingerprint | null,
  current: DiskFingerprint,
): boolean {
  return dismissed !== null && fingerprintsEqual(dismissed, current);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashFileBytes(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer — some runtimes reject SharedArrayBuffer views.
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return bytesToHex(digest);
}

export function fingerprintFromStat(info: {
  size: number;
  mtime: Date | null;
}): DiskFingerprint {
  return {
    mtimeMs: info.mtime?.getTime() ?? 0,
    sizeBytes: info.size,
  };
}

export async function fingerprintFromStatAndBytes(
  info: { size: number; mtime: Date | null },
  bytes: Uint8Array,
): Promise<DiskFingerprint> {
  return {
    ...fingerprintFromStat(info),
    contentHash: await hashFileBytes(bytes),
  };
}

export async function fingerprintFromWrittenBytes(
  path: string,
  bytes: Uint8Array,
): Promise<DiskFingerprint> {
  const info = await stat(path);
  return fingerprintFromStatAndBytes(info, bytes);
}

export async function statDiskFingerprint(path: string): Promise<DiskFingerprint> {
  const info = await stat(path);
  return fingerprintFromStat(info);
}

/** Stat + read + re-stat until metadata is stable, then hash the bytes. */
export async function statDiskFingerprintWithContent(
  path: string,
  readBytes: (path: string) => Promise<Uint8Array>,
  maxAttempts = 3,
): Promise<{ fingerprint: DiskFingerprint; bytes: Uint8Array }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await stat(path);
    const bytes = await readBytes(path);
    const after = await stat(path);
    const beforeFp = fingerprintFromStat(before);
    const afterFp = fingerprintFromStat(after);
    if (!fingerprintsEqual(beforeFp, afterFp) && attempt + 1 < maxAttempts) {
      continue;
    }
    return {
      fingerprint: await fingerprintFromStatAndBytes(after, bytes),
      bytes,
    };
  }
  // Unreachable: the loop always returns on the final attempt.
  const info = await stat(path);
  const bytes = await readBytes(path);
  return {
    fingerprint: await fingerprintFromStatAndBytes(info, bytes),
    bytes,
  };
}

export function isFileMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("no such file") ||
    lower.includes("not found") ||
    lower.includes("os error 2") ||
    lower.includes("cannot find the path")
  );
}

/** Tauri fs plugin scope denial (e.g. dotfiles without requireLiteralLeadingDot). */
export function isFsScopePermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("forbidden path") || lower.includes("not allowed on the scope");
}
