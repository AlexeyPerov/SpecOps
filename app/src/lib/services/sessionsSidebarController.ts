import {
  MAX_PANEL_WIDTH_PX,
  MIN_PANEL_WIDTH_PX,
  normalizePanelWidthPx,
} from "./panelLayout";
import { requestConfirm } from "./confirmDialogUi";
import type { PromptAnchor } from "./promptAnchor";

export type SessionsSidebarControllerDeps = {
  getCollapsed: () => boolean;
  getDisplayWidth: () => number;
  setDisplayWidth: (width: number) => void;
  setIsResizing: (value: boolean) => void;
  onPanelWidthChange: (width: number) => void;
  onToggleCollapsed: (next: boolean) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  /** Rename — the sidebar edits the title inline; the handler stores it. */
  onRenameSession: (sessionId: string, title: string) => void | Promise<void>;
};

export function clampSessionsSidebarWidth(next: number): number {
  return Math.max(MIN_PANEL_WIDTH_PX, Math.min(MAX_PANEL_WIDTH_PX, next));
}

export function syncSessionsSidebarDisplayWidth(
  panelWidthPx: number,
  isResizing: boolean,
): number | null {
  if (isResizing) {
    return null;
  }
  return normalizePanelWidthPx(panelWidthPx);
}

export function createSessionsSidebarController(deps: SessionsSidebarControllerDeps) {
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
      deps.setDisplayWidth(clampSessionsSidebarWidth(startWidth + deltaX));
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

  function handleNewSessionPointerDown(event: PointerEvent): void {
    event.preventDefault();
    deps.onNewSession();
  }

  function handleNewSessionClick(event: MouseEvent): void {
    if (event.detail !== 0) {
      return;
    }
    deps.onNewSession();
  }

  async function confirmDeleteSession(
    sessionId: string,
    title: string,
    entrySingularLabel: string,
    anchor?: PromptAnchor,
  ): Promise<void> {
    const confirmed = await requestConfirm({
      title: `Delete ${entrySingularLabel}`,
      message: `Delete ${entrySingularLabel} "${title}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      anchor,
    });
    if (!confirmed) {
      return;
    }
    deps.onDeleteSession(sessionId);
  }

  /** Delegates the inline-edited title to the handler (local-store update). */
  function renameSession(sessionId: string, title: string): void | Promise<void> {
    return deps.onRenameSession(sessionId, title);
  }

  return {
    handleResizeStart,
    handleTogglePointerDown,
    handleToggleButtonClick,
    handleNewSessionPointerDown,
    handleNewSessionClick,
    confirmDeleteSession,
    renameSession,
  };
}
