import type { PromptAnchor } from "./promptAnchor";

export type LocalChangesStashApplyChoice =
  | { type: "cancel" }
  | { type: "block" }
  | { type: "stash-and-continue" };

export interface LocalChangesStashApplyPromptRequest {
  stashRef: string;
  /** Open as a bubble beside this rect (e.g. the button that asked). */
  anchor?: PromptAnchor;
}

type LocalChangesStashApplyPromptRunner = (
  request: LocalChangesStashApplyPromptRequest,
) => Promise<LocalChangesStashApplyChoice | null>;

let runner: LocalChangesStashApplyPromptRunner | null = null;

export function registerLocalChangesStashApplyPromptRunner(
  next: LocalChangesStashApplyPromptRunner | null,
): void {
  runner = next;
}

export function promptLocalChangesStashApply(
  request: LocalChangesStashApplyPromptRequest,
): Promise<LocalChangesStashApplyChoice | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}
