import { isSessionTab, type TabState } from "../domain/contracts";

export function isSessionEditorPaneActive(
  openTabs: TabState[],
  selectedTabId: string | null,
): boolean {
  const tab = openTabs.find((entry) => entry.id === selectedTabId);
  return Boolean(tab && isSessionTab(tab));
}
