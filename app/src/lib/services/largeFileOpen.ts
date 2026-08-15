import { isImageFilePath } from "./fileContentKind";

export const DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES = 1024 * 1024;

const MIN_MAX_OPEN_WITHOUT_CONFIRM_BYTES = 1024;
const MAX_MAX_OPEN_WITHOUT_CONFIRM_BYTES = 10 * 1024 * 1024;

export function normalizeMaxOpenWithoutConfirmBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES;
  }
  const rounded = Math.round(value);
  return Math.min(
    MAX_MAX_OPEN_WITHOUT_CONFIRM_BYTES,
    Math.max(MIN_MAX_OPEN_WITHOUT_CONFIRM_BYTES, rounded),
  );
}

export function exceedsOpenWithoutConfirmLimit(
  sizeBytes: number,
  maxOpenWithoutConfirmBytes: number,
): boolean {
  return sizeBytes > maxOpenWithoutConfirmBytes;
}

export function isImagePathForOpenGate(filePath: string): boolean {
  return isImageFilePath(filePath);
}

export function shouldGateFileOpenBySize(
  filePath: string,
  sizeBytes: number,
  maxOpenWithoutConfirmBytes: number,
): boolean {
  if (isImagePathForOpenGate(filePath)) {
    return false;
  }
  return exceedsOpenWithoutConfirmLimit(sizeBytes, maxOpenWithoutConfirmBytes);
}

/**
 * Drag-and-drop opens skip the user's confirm threshold — the drop itself is
 * the explicit gesture — but a hard ceiling still catches pathological
 * multi-gigabyte files that would stall the editor if loaded wholesale.
 */
export const DROP_OPEN_HARD_MAX_BYTES = 512 * 1024 * 1024;

export function shouldGateDroppedFileBySize(filePath: string, sizeBytes: number): boolean {
  if (isImagePathForOpenGate(filePath)) {
    return false;
  }
  return exceedsOpenWithoutConfirmLimit(sizeBytes, DROP_OPEN_HARD_MAX_BYTES);
}
