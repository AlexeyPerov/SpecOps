import { isSessionTab, isViewTab, type TabState } from "../domain/contracts";

export function isSessionEditorPaneActive(
  openTabs: TabState[],
  selectedTabId: string | null,
): boolean {
  const tab = openTabs.find((entry) => entry.id === selectedTabId);
  return Boolean(tab && isSessionTab(tab));
}

/**
 * Resolves which (if any) view tab — Settings or Themes — is currently
 * selected in the editor pane. Returns `null` when the active tab is not a
 * view tab, so callers can fall through to the document/session panes.
 */
export function activeViewKind(
  openTabs: TabState[],
  selectedTabId: string | null,
): "settings" | "themes" | null {
  const tab = openTabs.find((entry) => entry.id === selectedTabId);
  if (tab && isViewTab(tab)) {
    return tab.view;
  }
  return null;
}
