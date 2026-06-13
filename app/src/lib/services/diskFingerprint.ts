import { stat } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint } from "../domain/contracts";

function isMacOs(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac/i.test(navigator.platform);
}

/** Synchronous path key for registry and in-window deduplication. */
export function normalizePathSync(path: string): string {
  let normalized = path.replaceAll("\\", "/");
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (isMacOs()) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

export function fingerprintsEqual(a: DiskFingerprint, b: DiskFingerprint): boolean {
  return a.mtimeMs === b.mtimeMs && a.sizeBytes === b.sizeBytes;
}

export function diskChanged(
  known: DiskFingerprint | null,
  current: DiskFingerprint,
): boolean {
  if (!known) {
    return true;
  }
  return known.mtimeMs !== current.mtimeMs || known.sizeBytes !== current.sizeBytes;
}

export function shouldSkipAsDismissed(
  dismissed: DiskFingerprint | null,
  current: DiskFingerprint,
): boolean {
  return dismissed !== null && fingerprintsEqual(dismissed, current);
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

export async function statDiskFingerprint(path: string): Promise<DiskFingerprint> {
  const info = await stat(path);
  return fingerprintFromStat(info);
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
