import type { DocumentState, WorkspaceLayoutState } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  canFitMarkdownSplit as canFitMarkdownSplitForWidth,
  computeResponsiveLayoutFlags,
} from "./appShellHelpers";
import { writeConsoleHeightPreference } from "./consoleTabPrefs";

export interface AppShellLayoutHandlersDeps {
  getShellMainRowEl: () => HTMLDivElement | null;
  getEditorPaneEl: () => HTMLElement | null;
  setShellMainRowWidth: (width: number) => void;
  setEditorPaneWidth: (width: number) => void;
  getShellMainRowWidth: () => number;
  getEditorPaneWidth: () => number;
  getActiveWorkspaceRoot: () => string | null;
  getIsSessionTabActive: () => boolean;
  getWorkspaceLayout: () => WorkspaceLayoutState;
  getConsoleOpen: () => boolean;
  setConsoleOpen: (open: boolean) => void;
  getAutoProjectPanelCollapsed: () => boolean;
  setAutoProjectPanelCollapsed: (collapsed: boolean) => void;
  getAutoSessionsSidebarCollapsed: () => boolean;
  setAutoSessionsSidebarCollapsed: (collapsed: boolean) => void;
  getActiveDocument: () => DocumentState | undefined;
  getConsoleHeightPx: () => number;
  setConsoleHeightPx: (heightPx: number) => void;
  getLayoutResizeObserver: () => ResizeObserver | null;
  setLayoutResizeObserver: (observer: ResizeObserver | null) => void;
}

export function createAppShellLayoutHandlers(deps: AppShellLayoutHandlersDeps) {
  function toggleProjectPanelCollapsed(next: boolean): void {
    appState.setProjectPanelCollapsed(next);
  }

  function toggleSessionsSidebarCollapsed(next: boolean): void {
    appState.setSessionsSidebarCollapsed(next);
  }

  function handleProjectPanelWidthChange(widthPx: number): void {
    appState.updateActiveWorkspaceLayout({ projectPanelWidthPx: widthPx });
  }

  function handleSessionsSidebarWidthChange(widthPx: number): void {
    appState.updateActiveWorkspaceLayout({ sessionsSidebarWidthPx: widthPx });
  }

  function handleActivityRailWidthChange(widthPx: number): void {
    appState.setActivityRailWidth(widthPx);
  }

  function toggleConsole(): void {
    deps.setConsoleOpen(!deps.getConsoleOpen());
  }

  function persistConsoleHeightNow(): void {
    void writeConsoleHeightPreference(deps.getConsoleHeightPx());
  }

  function canFitMarkdownSplit(): boolean {
    return canFitMarkdownSplitForWidth(deps.getEditorPaneWidth());
  }

  function setMarkdownViewMode(nextMode: "edit" | "split" | "preview"): void {
    const activeDocument = deps.getActiveDocument();
    if (!activeDocument) {
      return;
    }
    appState.setDocumentMarkdownViewMode(activeDocument.id, nextMode);
  }

  function updateLayoutMeasurements(): void {
    deps.setShellMainRowWidth(deps.getShellMainRowEl()?.clientWidth ?? 0);
    deps.setEditorPaneWidth(deps.getEditorPaneEl()?.clientWidth ?? 0);
  }

  function applyResponsiveLayoutRules(): void {
    const flags = computeResponsiveLayoutFlags({
      shellMainRowWidth: deps.getShellMainRowWidth(),
      workspaceActive: Boolean(deps.getActiveWorkspaceRoot()),
      isSessionTabActive: deps.getIsSessionTabActive(),
      workspaceLayout: deps.getWorkspaceLayout(),
      consoleOpen: deps.getConsoleOpen(),
    });
    if (deps.getAutoProjectPanelCollapsed() !== flags.autoProjectPanelCollapsed) {
      deps.setAutoProjectPanelCollapsed(flags.autoProjectPanelCollapsed);
    }
    if (deps.getAutoSessionsSidebarCollapsed() !== flags.autoSessionsSidebarCollapsed) {
      deps.setAutoSessionsSidebarCollapsed(flags.autoSessionsSidebarCollapsed);
    }
    if (deps.getConsoleOpen() !== flags.consoleOpen) {
      deps.setConsoleOpen(flags.consoleOpen);
    }
  }

  /**
   * H33: the editor pane element is torn down and recreated on every
   * active-pane change, so the element observed at setup goes stale (detached
   * but still observed) while new elements are never measured. The currently
   * observed element is tracked here and re-synced via
   * {@link syncEditorPaneObserved} whenever the bound element changes.
   */
  let observedEditorPaneEl: HTMLElement | null = null;

  function setupLayoutObserver(): void {
    updateLayoutMeasurements();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateLayoutMeasurements();
    });
    deps.setLayoutResizeObserver(observer);
    const shellMainRowEl = deps.getShellMainRowEl();
    if (shellMainRowEl) {
      observer.observe(shellMainRowEl);
    }
    const editorPaneEl = deps.getEditorPaneEl();
    observedEditorPaneEl = editorPaneEl;
    if (editorPaneEl) {
      observer.observe(editorPaneEl);
    }
  }

  /**
   * Re-point the layout observer at the current editor pane element (H33).
   * Called from an effect on the bound `editorPaneEl`; a no-op until the
   * observer exists and whenever the element is unchanged.
   */
  function syncEditorPaneObserved(): void {
    const observer = deps.getLayoutResizeObserver();
    if (!observer) {
      return;
    }
    const editorPaneEl = deps.getEditorPaneEl();
    if (editorPaneEl === observedEditorPaneEl) {
      return;
    }
    if (observedEditorPaneEl) {
      observer.unobserve(observedEditorPaneEl);
    }
    observedEditorPaneEl = editorPaneEl;
    if (editorPaneEl) {
      observer.observe(editorPaneEl);
    }
    // Measure immediately — the ResizeObserver only fires on future resizes,
    // and the new pane's width is what canFitMarkdownSplit() needs right now.
    updateLayoutMeasurements();
  }

  function disconnectLayoutObserver(): void {
    deps.getLayoutResizeObserver()?.disconnect();
    deps.setLayoutResizeObserver(null);
    observedEditorPaneEl = null;
  }

  return {
    toggleProjectPanelCollapsed,
    toggleSessionsSidebarCollapsed,
    handleProjectPanelWidthChange,
    handleSessionsSidebarWidthChange,
    handleActivityRailWidthChange,
    toggleConsole,
    persistConsoleHeightNow,
    canFitMarkdownSplit,
    setMarkdownViewMode,
    updateLayoutMeasurements,
    applyResponsiveLayoutRules,
    setupLayoutObserver,
    syncEditorPaneObserved,
    disconnectLayoutObserver,
  };
}
