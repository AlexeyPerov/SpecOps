export const SETTINGS_DIALOG_VIEWPORT_MARGIN_PX = 12;

export function clampDialogPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = SETTINGS_DIALOG_VIEWPORT_MARGIN_PX,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  return {
    left: Math.min(maxLeft, Math.max(margin, Math.floor(left))),
    top: Math.min(maxTop, Math.max(margin, Math.floor(top))),
  };
}

export function centerDialogPosition(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = SETTINGS_DIALOG_VIEWPORT_MARGIN_PX,
): { left: number; top: number } {
  return clampDialogPosition(
    (viewportWidth - width) / 2,
    (viewportHeight - height) / 2,
    width,
    height,
    viewportWidth,
    viewportHeight,
    margin,
  );
}
