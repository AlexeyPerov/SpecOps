import type { FileContentKind } from "./fileContentKind";

export const DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES = 200 * 1024;

const MIN_MAX_BINARY_OPEN_AS_TEXT_BYTES = 1024;
const MAX_MAX_BINARY_OPEN_AS_TEXT_BYTES = 10 * 1024 * 1024;

export function normalizeMaxBinaryOpenAsTextBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES;
  }
  const rounded = Math.round(value);
  return Math.min(
    MAX_MAX_BINARY_OPEN_AS_TEXT_BYTES,
    Math.max(MIN_MAX_BINARY_OPEN_AS_TEXT_BYTES, rounded),
  );
}

/**
 * Decide whether a byte-sniffed-as-binary file is small enough to be worth trying to
 * show as text.
 *
 * This is only the size gate. It deliberately does not decode: it used to return a
 * lossy UTF-8 decode, which produced an *editable* buffer where every invalid byte had
 * become U+FFFD — so opening a small `.so`, `.bin`, or UTF-16 file and pressing Cmd+S
 * overwrote it with mojibake. The caller must follow up with a strict decode
 * (`decodeTextFile`) and keep the document `binary` when that fails.
 */
export function resolveBinaryFileOpen(
  sizeBytes: number,
  maxBinaryOpenAsTextBytes: number,
): { contentKind: FileContentKind } {
  return {
    contentKind: sizeBytes <= maxBinaryOpenAsTextBytes ? "text" : "binary",
  };
}
