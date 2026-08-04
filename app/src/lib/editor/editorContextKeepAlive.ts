import type { ContextId } from "../domain/contracts";

/**
 * Active context plus the most recently used parked editor trees.
 *
 * Parked contexts are `display:none` hosts whose editor views are bounded per
 * pane by {@link MAX_LIVE_EDITOR_TABS_PER_PANE}, so the memory cost of a parked
 * context is bounded and does not consume CPU (the CodeMirror views are laid out
 * but not actively updating). Raising this from 3 to 6 means a user with up to
 * six workspaces never pays the cold-context remount cost (full
 * `EditorState.create` — document parse + extension setup — for every live tab
 * in every pane) when switching between them. The display:none keep-alive means
 * the warm path stays a CSS visibility toggle.
 */
export const MAX_MOUNTED_EDITOR_CONTEXTS = 6;

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
