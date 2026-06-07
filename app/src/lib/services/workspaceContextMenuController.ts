export type CloseWorkspaceAction = "save-all" | "discard-all" | "cancel";

export interface CloseWorkspacePrompts {
  confirmSaveAll: (dirtyCount: number) => boolean;
  confirmDiscardAll: () => boolean;
}

export function resolveCloseWorkspaceAction(
  dirtyDocumentCount: number,
  prompts: CloseWorkspacePrompts,
): CloseWorkspaceAction {
  if (dirtyDocumentCount === 0) {
    return "discard-all";
  }
  if (prompts.confirmSaveAll(dirtyDocumentCount)) {
    return "save-all";
  }
  return prompts.confirmDiscardAll() ? "discard-all" : "cancel";
}

export function findWorkspaceIndex(
  workspaceIds: readonly string[],
  workspaceId: string,
): number {
  return workspaceIds.findIndex((id) => id === workspaceId);
}

export function computeWorkspaceReorderTarget(
  currentIndex: number,
  direction: "up" | "down",
  workspaceCount: number,
): number | null {
  if (currentIndex < 0) {
    return null;
  }
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= workspaceCount) {
    return null;
  }
  return targetIndex;
}
