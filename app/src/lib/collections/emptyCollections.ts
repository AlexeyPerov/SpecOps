/** Fresh empty sets/maps for Svelte prop defaults (avoids Rollup `@__PURE__` warnings on inline `new`). */
export function emptySet<T = never>(): Set<T> {
  return new Set<T>();
}

export function emptyMap<K = never, V = never>(): Map<K, V> {
  return new Map<K, V>();
}

export function emptyWeakSet<T extends object>(): WeakSet<T> {
  return new WeakSet<T>();
}
