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

export function resolveBinaryFileOpen(
  bytes: Uint8Array,
  sizeBytes: number,
  maxBinaryOpenAsTextBytes: number,
): { content: string; contentKind: FileContentKind } {
  if (sizeBytes <= maxBinaryOpenAsTextBytes) {
    return {
      content: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      contentKind: "text",
    };
  }
  return {
    content: "",
    contentKind: "binary",
  };
}
