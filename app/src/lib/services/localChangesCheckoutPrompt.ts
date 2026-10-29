import type { PromptAnchor } from "./promptAnchor";

export type LocalChangesCheckoutChoice =
  | { type: "cancel" }
  | { type: "block" }
  | { type: "stash-and-continue" };

export interface LocalChangesCheckoutPromptRequest {
  branchName: string;
  /** Open as a bubble beside this rect (e.g. the button that asked). */
  anchor?: PromptAnchor;
}

type LocalChangesCheckoutPromptRunner = (
  request: LocalChangesCheckoutPromptRequest,
) => Promise<LocalChangesCheckoutChoice | null>;

let runner: LocalChangesCheckoutPromptRunner | null = null;

export function registerLocalChangesCheckoutPromptRunner(
  next: LocalChangesCheckoutPromptRunner | null,
): void {
  runner = next;
}

export function promptLocalChangesCheckout(
  request: LocalChangesCheckoutPromptRequest,
): Promise<LocalChangesCheckoutChoice | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}
