/** Identifies which git mutation triggered a version-control UI refresh. */
export type VersionControlMutationScope =
  | "stage"
  | "commit"
  | "checkout"
  | "branch"
  | "fetch"
  | "pull"
  | "push"
  | "tag";

export type VersionControlMutationListener = (
  workspaceRootPath: string,
  scope: VersionControlMutationScope,
) => void;

const mutationListeners = new Set<VersionControlMutationListener>();

/** Subscribe to version-control mutations (stage, commit, pull, etc.). */
export function subscribeVersionControlMutations(
  listener: VersionControlMutationListener,
): () => void {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}

/** Notify listeners that a version-control mutation completed for a workspace. */
export function notifyVersionControlMutation(
  workspaceRootPath: string,
  scope: VersionControlMutationScope,
): void {
  for (const listener of mutationListeners) {
    listener(workspaceRootPath, scope);
  }
}

/** True when the mutation may move HEAD (history selection should reset). */
export function mutationChangesHead(scope: VersionControlMutationScope): boolean {
  return (
    scope === "commit" ||
    scope === "checkout" ||
    scope === "branch" ||
    scope === "pull"
  );
}
