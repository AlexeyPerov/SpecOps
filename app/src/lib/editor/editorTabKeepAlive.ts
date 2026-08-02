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
