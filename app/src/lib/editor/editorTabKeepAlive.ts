/** Active text tab plus the three most recently used parked editors per pane. */
export const MAX_LIVE_EDITOR_TABS_PER_PANE = 4;

/**
 * Update the bounded least-recently-used list of live editor tab ids.
 * Closed/non-text tabs are pruned and the eligible active tab becomes newest.
 */
export function updateLiveEditorTabs(
  current: readonly string[],
  activeTabId: string | null,
  openTextTabIds: ReadonlySet<string>,
  maxLive: number = MAX_LIVE_EDITOR_TABS_PER_PANE,
): string[] {
  const boundedMax = Math.max(1, maxLive);
  const next = current.filter(
    (tabId, index) =>
      tabId !== activeTabId &&
      openTextTabIds.has(tabId) &&
      current.indexOf(tabId) === index,
  );
  if (activeTabId && openTextTabIds.has(activeTabId)) {
    next.push(activeTabId);
  }
  return next.slice(-boundedMax);
}

export interface PartitionedLiveTabs {
  /** Tabs to mount immediately (already mounted + the active tab if missing). */
  immediate: readonly string[];
  /**
   * Desired live tabs that are not yet mounted and are not the active tab.
   * These should be hydrated on an idle callback so a cold context switch
   * mounts only the visible editor synchronously and staggers the rest.
   */
  deferred: readonly string[];
}

/**
 * Split the desired live tab list into tabs that must mount immediately and
 * tabs that can be deferred to an idle callback.
 *
 * - Already-mounted tabs stay immediate (no benefit to unmounting them).
 * - The active tab is always immediate so the visible editor is never blank.
 * - Newly-desired, non-active tabs are deferred so a cold-context remount
 *   pays only one synchronous `EditorState.create` (the visible tab) and
 *   staggers the sibling mounts across idle frames.
 *
 * `mountedTabIds` is the set of tab ids already in the keep-alive list.
 */
export function partitionImmediateAndDeferred(
  desiredLiveTabIds: readonly string[],
  activeTabId: string | null,
  mountedTabIds: ReadonlySet<string>,
): PartitionedLiveTabs {
  const immediate: string[] = [];
  const deferred: string[] = [];
  for (const tabId of desiredLiveTabIds) {
    if (mountedTabIds.has(tabId) || tabId === activeTabId) {
      immediate.push(tabId);
    } else {
      deferred.push(tabId);
    }
  }
  return { immediate, deferred };
}
