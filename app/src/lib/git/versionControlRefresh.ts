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

/** True when the mutation may move HEAD (history selection should reset). */
export function mutationChangesHead(scope: VersionControlMutationScope): boolean {
  return (
    scope === "commit" ||
    scope === "checkout" ||
    scope === "branch" ||
    scope === "pull"
  );
}
