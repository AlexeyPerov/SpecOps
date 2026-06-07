import { tick } from "svelte";
import {
  centerDialogPosition,
  clampDialogPosition,
} from "../../services/settingsDialogGeometry";
import type { SettingsDialogTab } from "../../services/settingsDialogUi";

export const SETTINGS_TAB_SIDEBAR_WIDTH_PX = 132;
export const SETTINGS_BODY_PADDING_X_PX = 24;
export const SETTINGS_DIALOG_CHROME_BUFFER_PX = 8;

const VIEWPORT_SIZE_FRACTION = 0.96;

export function clampDialogSize(
  width: number,
  height: number,
  initialWidthPx: number,
  initialHeightPx: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): { width: number; height: number } {
  const maxWidth = Math.floor(viewportWidth * VIEWPORT_SIZE_FRACTION);
  const maxHeight = Math.floor(viewportHeight * VIEWPORT_SIZE_FRACTION);
  return {
    width: Math.max(initialWidthPx, Math.min(maxWidth, Math.floor(width))),
    height: Math.max(initialHeightPx, Math.min(maxHeight, Math.floor(height))),
  };
}

export interface SettingsDialogBounds {
  dialogWidthPx: number;
  dialogHeightPx: number;
  dialogLeftPx: number;
  dialogTopPx: number;
}

export function centerDialogInViewport(
  dialogWidthPx: number,
  dialogHeightPx: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): { left: number; top: number } {
  return centerDialogPosition(
    dialogWidthPx,
    dialogHeightPx,
    viewportWidth,
    viewportHeight,
  );
}

export function syncDialogBoundsToViewport(
  bounds: SettingsDialogBounds,
  initialWidthPx: number,
  initialHeightPx: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): SettingsDialogBounds {
  const nextSize = clampDialogSize(
    bounds.dialogWidthPx,
    bounds.dialogHeightPx,
    initialWidthPx,
    initialHeightPx,
    viewportWidth,
    viewportHeight,
  );
  const nextPosition = clampDialogPosition(
    bounds.dialogLeftPx,
    bounds.dialogTopPx,
    nextSize.width,
    nextSize.height,
    viewportWidth,
    viewportHeight,
  );
  return {
    dialogWidthPx: nextSize.width,
    dialogHeightPx: nextSize.height,
    dialogLeftPx: nextPosition.left,
    dialogTopPx: nextPosition.top,
  };
}

export interface MeasureSettingsDialogSizeInput {
  headerEl: HTMLElement | null;
  tabMeasureEls: Partial<Record<SettingsDialogTab, HTMLElement>>;
  tabIds: readonly SettingsDialogTab[];
  positionInitialized: boolean;
  dialogLeftPx: number;
  dialogTopPx: number;
  dialogWidthPx: number;
  dialogHeightPx: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface MeasureSettingsDialogSizeResult {
  initialWidthPx: number;
  initialHeightPx: number;
  dialogWidthPx: number;
  dialogHeightPx: number;
  dialogLeftPx: number;
  dialogTopPx: number;
  positionInitialized: boolean;
}

export async function measureSettingsDialogInitialSize(
  input: MeasureSettingsDialogSizeInput,
): Promise<MeasureSettingsDialogSizeResult> {
  await tick();
  const viewportWidth = input.viewportWidth ?? window.innerWidth;
  const viewportHeight = input.viewportHeight ?? window.innerHeight;

  const headerHeight = input.headerEl?.offsetHeight ?? 0;
  const tabHeights = input.tabIds.map((tabId) => input.tabMeasureEls[tabId]?.scrollHeight ?? 0);
  const tabWidths = input.tabIds.map((tabId) => input.tabMeasureEls[tabId]?.scrollWidth ?? 0);
  const bodyHeight = Math.max(...tabHeights, 0);
  const bodyWidth = Math.max(...tabWidths, 0);

  const measuredWidth =
    SETTINGS_TAB_SIDEBAR_WIDTH_PX +
    bodyWidth +
    SETTINGS_BODY_PADDING_X_PX +
    SETTINGS_DIALOG_CHROME_BUFFER_PX;
  const measuredHeight = headerHeight + bodyHeight + SETTINGS_DIALOG_CHROME_BUFFER_PX;

  const maxWidth = Math.floor(viewportWidth * VIEWPORT_SIZE_FRACTION);
  const maxHeight = Math.floor(viewportHeight * VIEWPORT_SIZE_FRACTION);
  const width = Math.min(maxWidth, measuredWidth);
  const height = Math.min(maxHeight, measuredHeight);

  let dialogLeftPx = input.dialogLeftPx;
  let dialogTopPx = input.dialogTopPx;
  let positionInitialized = input.positionInitialized;

  if (!positionInitialized) {
    const centered = centerDialogInViewport(width, height, viewportWidth, viewportHeight);
    dialogLeftPx = centered.left;
    dialogTopPx = centered.top;
    positionInitialized = true;
  } else {
    const synced = syncDialogBoundsToViewport(
      {
        dialogWidthPx: width,
        dialogHeightPx: height,
        dialogLeftPx,
        dialogTopPx,
      },
      width,
      height,
      viewportWidth,
      viewportHeight,
    );
    dialogLeftPx = synced.dialogLeftPx;
    dialogTopPx = synced.dialogTopPx;
  }

  return {
    initialWidthPx: width,
    initialHeightPx: height,
    dialogWidthPx: width,
    dialogHeightPx: height,
    dialogLeftPx,
    dialogTopPx,
    positionInitialized,
  };
}

export interface SettingsDialogDragContext {
  sizeInitialized: boolean;
  isResizing: boolean;
  dialogLeftPx: number;
  dialogTopPx: number;
  dialogWidthPx: number;
  dialogHeightPx: number;
  onDraggingChange: (dragging: boolean) => void;
  onPositionChange: (left: number, top: number) => void;
}

export function handleSettingsDialogDragStart(
  event: PointerEvent,
  context: SettingsDialogDragContext,
): void {
  if (!context.sizeInitialized || context.isResizing) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest(".settings-dialog-close, .settings-dialog-resize-handle")) {
    return;
  }

  event.preventDefault();
  context.onDraggingChange(true);
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = context.dialogLeftPx;
  const startTop = context.dialogTopPx;
  const dragTarget = event.currentTarget as HTMLElement | null;
  dragTarget?.setPointerCapture(pointerId);

  const onPointerMove = (moveEvent: PointerEvent): void => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    const next = clampDialogPosition(
      startLeft + deltaX,
      startTop + deltaY,
      context.dialogWidthPx,
      context.dialogHeightPx,
      window.innerWidth,
      window.innerHeight,
    );
    context.onPositionChange(next.left, next.top);
  };

  const onPointerEnd = (): void => {
    context.onDraggingChange(false);
    dragTarget?.releasePointerCapture(pointerId);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerEnd);
    window.removeEventListener("pointercancel", onPointerEnd);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
}

export interface SettingsDialogResizeContext {
  sizeInitialized: boolean;
  initialWidthPx: number;
  initialHeightPx: number;
  dialogWidthPx: number;
  dialogHeightPx: number;
  onResizingChange: (resizing: boolean) => void;
  onSizeChange: (width: number, height: number) => void;
}

export function handleSettingsDialogResizeStart(
  event: PointerEvent,
  context: SettingsDialogResizeContext,
): void {
  if (!context.sizeInitialized) {
    return;
  }
  event.preventDefault();
  context.onResizingChange(true);
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = context.dialogWidthPx;
  const startHeight = context.dialogHeightPx;
  const target = event.currentTarget as HTMLElement | null;
  target?.setPointerCapture(pointerId);

  const onPointerMove = (moveEvent: PointerEvent): void => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    const next = clampDialogSize(
      startWidth + deltaX,
      startHeight + deltaY,
      context.initialWidthPx,
      context.initialHeightPx,
    );
    context.onSizeChange(next.width, next.height);
  };

  const onPointerEnd = (): void => {
    context.onResizingChange(false);
    target?.releasePointerCapture(pointerId);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerEnd);
    window.removeEventListener("pointercancel", onPointerEnd);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
}
