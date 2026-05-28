import { isAgentTab, type TabState } from "../domain/contracts";

export function isAgentEditorPaneActive(
  openTabs: TabState[],
  selectedTabId: string | null,
): boolean {
  const tab = openTabs.find((entry) => entry.id === selectedTabId);
  return Boolean(tab && isAgentTab(tab));
}
