import type { PromptAnchor } from "./promptAnchor";

export type LocalChangesPullChoice =
  | { type: "cancel" }
  | { type: "block" }
  | { type: "stash-and-pull" };

export interface LocalChangesPullPromptRequest {
  /** Open as a bubble beside this rect (e.g. the Pull button). */
  anchor?: PromptAnchor;
}

type LocalChangesPullPromptRunner = (
  request: LocalChangesPullPromptRequest,
) => Promise<LocalChangesPullChoice | null>;

let runner: LocalChangesPullPromptRunner | null = null;

export function registerLocalChangesPullPromptRunner(
  next: LocalChangesPullPromptRunner | null,
): void {
  runner = next;
}

export function promptLocalChangesPull(
  request: LocalChangesPullPromptRequest = {},
): Promise<LocalChangesPullChoice | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}
