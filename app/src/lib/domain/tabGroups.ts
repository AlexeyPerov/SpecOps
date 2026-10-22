import type { ContextId, ContextSnapshot, TabGroupEntry, TabGroupId } from "./workspace";

export const DEFAULT_TAB_GROUP_ID: TabGroupId = "tabs-default";
export const DEFAULT_TAB_GROUP_NAME = "Tabs";

export function isTabGroupId(id: ContextId): id is TabGroupId {
  return id.startsWith("tabs-");
}

export function findTabGroup(tabGroups: readonly TabGroupEntry[], id: ContextId): TabGroupEntry | null {
  return tabGroups.find((group) => group.id === id) ?? null;
}

/** The window's fallback context; restore and creation keep the default group first. */
export function defaultTabGroupSnapshot(contexts: { tabGroups: readonly TabGroupEntry[] }): ContextSnapshot {
  return (findTabGroup(contexts.tabGroups, DEFAULT_TAB_GROUP_ID) ?? contexts.tabGroups[0]).snapshot;
}

/** Returns `tabGroups` unchanged when the group is missing or already holds `snapshot`. */
export function withTabGroupSnapshot(
  tabGroups: TabGroupEntry[],
  id: ContextId,
  snapshot: ContextSnapshot,
): TabGroupEntry[] {
  const index = tabGroups.findIndex((group) => group.id === id);
  if (index < 0 || tabGroups[index].snapshot === snapshot) {
    return tabGroups;
  }
  const next = [...tabGroups];
  next[index] = { ...tabGroups[index], snapshot };
  return next;
}
