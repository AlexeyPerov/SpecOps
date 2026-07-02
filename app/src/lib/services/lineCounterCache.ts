import { normalizePathSync } from "./diskFingerprint";
import type { LineCountResult } from "./lineCounter";

export interface LineCounterCacheEntry {
  result: LineCountResult;
  scannedAt: Date;
}

const cache = new Map<string, LineCounterCacheEntry>();

function cacheKey(root: string): string {
  return normalizePathSync(root).replace(/\/+$/, "");
}

export function getLineCounterCache(root: string): LineCounterCacheEntry | undefined {
  return cache.get(cacheKey(root));
}

export function setLineCounterCache(root: string, entry: LineCounterCacheEntry): void {
  cache.set(cacheKey(root), entry);
}

/** Clears the in-memory cache (for unit tests). */
export function clearLineCounterCache(): void {
  cache.clear();
}
