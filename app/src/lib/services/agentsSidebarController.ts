import {
  MAX_PANEL_WIDTH_PX,
  MIN_PANEL_WIDTH_PX,
  normalizePanelWidthPx,
} from "./panelLayout";

export type AgentsSidebarControllerDeps = {
  getCollapsed: () => boolean;
  getDisplayWidth: () => number;
  setDisplayWidth: (width: number) => void;
  setIsResizing: (value: boolean) => void;
  onPanelWidthChange: (width: number) => void;
  onToggleCollapsed: (next: boolean) => void;
  onNewAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
};

export function clampAgentsSidebarWidth(next: number): number {
  return Math.max(MIN_PANEL_WIDTH_PX, Math.min(MAX_PANEL_WIDTH_PX, next));
}

export function syncAgentsSidebarDisplayWidth(
  panelWidthPx: number,
  isResizing: boolean,
): number | null {
  if (isResizing) {
    return null;
  }
  return normalizePanelWidthPx(panelWidthPx);
}

export function createAgentsSidebarController(deps: AgentsSidebarControllerDeps) {
  function handleResizeStart(event: PointerEvent): void {
    if (deps.getCollapsed()) {
      return;
    }
    event.preventDefault();
    deps.setIsResizing(true);
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = deps.getDisplayWidth();
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startX;
      deps.setDisplayWidth(clampAgentsSidebarWidth(startWidth + deltaX));
    };

    const onPointerEnd = (): void => {
      deps.setIsResizing(false);
      target?.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      deps.onPanelWidthChange(deps.getDisplayWidth());
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  }

  function handleToggleClick(): void {
    deps.onToggleCollapsed(!deps.getCollapsed());
  }

  function handleTogglePointerDown(event: PointerEvent): void {
    event.preventDefault();
    handleToggleClick();
  }

  function handleToggleButtonClick(event: MouseEvent): void {
    if (event.detail !== 0) {
      return;
    }
    handleToggleClick();
  }

  function handleNewAgentPointerDown(event: PointerEvent): void {
    event.preventDefault();
    deps.onNewAgent();
  }

  function handleNewAgentClick(event: MouseEvent): void {
    if (event.detail !== 0) {
      return;
    }
    deps.onNewAgent();
  }

  function confirmDeleteAgent(
    agentId: string,
    title: string,
    entrySingularLabel: string,
  ): void {
    const confirmed = window.confirm(
      `Delete ${entrySingularLabel} "${title}"? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    deps.onDeleteAgent(agentId);
  }

  return {
    handleResizeStart,
    handleTogglePointerDown,
    handleToggleButtonClick,
    handleNewAgentPointerDown,
    handleNewAgentClick,
    confirmDeleteAgent,
  };
}
