import {
  getSessionActiveTab,
  isSessionTab,
  isViewTab,
  type SessionState,
  type TabState,
} from "../domain/contracts";

/**
 * Sidecar-gating predicate: is the active editor surface showing a session tab?
 *
 * Split view (Phase 4): "the editor pane" is now the **active pane** of the
 * context's `EditorLayout`; its selected tab is derived via
 * `getSessionActiveTab` (activePane → activeTab, Q15). The session-tab
 * singleton invariant (Q5) keeps this lookup sound across panes — the session
 * tab lives in at most one pane, so checking the active pane's selection is
 * sufficient.
 *
 * This `(openTabs, selectedTabId)` overload is the explicit-values variant,
 * kept for the unit test and callers that already hold the active pane's
 * derived values. Prefer {@link isSessionTabActiveInActivePane} for new code.
 */
export function isSessionEditorPaneActive(
  openTabs: TabState[],
  selectedTabId: string | null,
): boolean {
  const tab = openTabs.find((entry) => entry.id === selectedTabId);
  return Boolean(tab && isSessionTab(tab));
}

/**
 * Sidecar-gating predicate reading off the active pane's selected tab.
 * The active-pane entry point for split view (Phase 4).
 */
export function isSessionTabActiveInActivePane(session: SessionState): boolean {
  const tab = getSessionActiveTab(session);
  return Boolean(tab && isSessionTab(tab));
}

/**
 * Resolves which (if any) view tab — Settings or Themes — is currently
 * selected in the editor pane. Returns `null` when the active tab is not a
 * view tab, so callers can fall through to the document/session panes.
 *
 * Split view (Phase 4): "the editor pane" is the **active pane**. This
 * `(openTabs, selectedTabId)` overload is the explicit-values variant; prefer
 * {@link activeViewKindInActivePane} for new code.
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

/**
 * Resolves the active pane's view-tab kind (Settings / Themes), reading off
 * the active pane's selected tab. The active-pane entry point for split view
 * (Phase 4).
 */
export function activeViewKindInActivePane(
  session: SessionState,
): "settings" | "themes" | null {
  const tab = getSessionActiveTab(session);
  if (tab && isViewTab(tab)) {
    return tab.view;
  }
  return null;
}
