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
  getIsChatHttpActive: () => boolean;
  getIsAgentTabActive: () => boolean;
  getWorkspaceLayout: () => WorkspaceLayoutState;
  getConsoleOpen: () => boolean;
  setConsoleOpen: (open: boolean) => void;
  getAutoProjectPanelCollapsed: () => boolean;
  setAutoProjectPanelCollapsed: (collapsed: boolean) => void;
  getAutoAgentsSidebarCollapsed: () => boolean;
  setAutoAgentsSidebarCollapsed: (collapsed: boolean) => void;
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

  function toggleAgentsSidebarCollapsed(next: boolean): void {
    appState.setAgentsSidebarCollapsed(next);
  }

  function handleProjectPanelWidthChange(widthPx: number): void {
    appState.updateActiveWorkspaceLayout({ projectPanelWidthPx: widthPx });
  }

  function handleAgentsSidebarWidthChange(widthPx: number): void {
    appState.updateActiveWorkspaceLayout({ agentsSidebarWidthPx: widthPx });
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
      workspaceActive: Boolean(deps.getActiveWorkspaceRoot()) && !deps.getIsChatHttpActive(),
      isAgentTabActive: deps.getIsAgentTabActive(),
      workspaceLayout: deps.getWorkspaceLayout(),
      consoleOpen: deps.getConsoleOpen(),
    });
    if (deps.getAutoProjectPanelCollapsed() !== flags.autoProjectPanelCollapsed) {
      deps.setAutoProjectPanelCollapsed(flags.autoProjectPanelCollapsed);
    }
    if (deps.getAutoAgentsSidebarCollapsed() !== flags.autoAgentsSidebarCollapsed) {
      deps.setAutoAgentsSidebarCollapsed(flags.autoAgentsSidebarCollapsed);
    }
    if (deps.getConsoleOpen() !== flags.consoleOpen) {
      deps.setConsoleOpen(flags.consoleOpen);
    }
  }

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
    if (editorPaneEl) {
      observer.observe(editorPaneEl);
    }
  }

  function disconnectLayoutObserver(): void {
    deps.getLayoutResizeObserver()?.disconnect();
    deps.setLayoutResizeObserver(null);
  }

  return {
    toggleProjectPanelCollapsed,
    toggleAgentsSidebarCollapsed,
    handleProjectPanelWidthChange,
    handleAgentsSidebarWidthChange,
    toggleConsole,
    persistConsoleHeightNow,
    canFitMarkdownSplit,
    setMarkdownViewMode,
    updateLayoutMeasurements,
    applyResponsiveLayoutRules,
    setupLayoutObserver,
    disconnectLayoutObserver,
  };
}
