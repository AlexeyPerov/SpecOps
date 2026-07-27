import { normalizePathSync } from "./diskFingerprint";
import type { LineCountResult } from "./lineCounter";

export interface LineCounterCacheEntry {
  result: LineCountResult;
  scannedAt: Date;
}

/** Soft cap so switching many workspaces cannot retain every scan forever. */
export const MAX_LINE_COUNTER_CACHE_ENTRIES = 8;

const cache = new Map<string, LineCounterCacheEntry>();

function cacheKey(root: string): string {
  return normalizePathSync(root).replace(/\/+$/, "");
}

export function getLineCounterCache(root: string): LineCounterCacheEntry | undefined {
  const key = cacheKey(root);
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  // Refresh LRU order.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setLineCounterCache(root: string, entry: LineCounterCacheEntry): void {
  const key = cacheKey(root);
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_LINE_COUNTER_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

/** Clears the in-memory cache (for unit tests). */
export function clearLineCounterCache(): void {
  cache.clear();
}

/** Current entry count (for tests). */
export function lineCounterCacheSize(): number {
  return cache.size;
}
