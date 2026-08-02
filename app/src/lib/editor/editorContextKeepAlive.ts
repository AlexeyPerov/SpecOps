import type { ContextId } from "../domain/contracts";

/** Active context plus the two most recently used parked editor trees. */
export const MAX_MOUNTED_EDITOR_CONTEXTS = 3;

/**
 * Update least-recently-used context ids for keyed editor hosts.
 *
 * Missing/closed contexts are pruned, the active context is always newest,
 * and the returned list never exceeds the configured bound.
 */
export function updateMountedEditorContexts(
  current: readonly ContextId[],
  activeContextId: ContextId,
  availableContextIds: ReadonlySet<ContextId>,
  maxMounted: number = MAX_MOUNTED_EDITOR_CONTEXTS,
): ContextId[] {
  const boundedMax = Math.max(1, maxMounted);
  const next = current.filter(
    (contextId, index) =>
      contextId !== activeContextId &&
      availableContextIds.has(contextId) &&
      current.indexOf(contextId) === index,
  );
  if (availableContextIds.has(activeContextId)) {
    next.push(activeContextId);
  }
  return next.slice(-boundedMax);
}
