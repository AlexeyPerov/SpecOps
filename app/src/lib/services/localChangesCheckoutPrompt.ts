export type LocalChangesCheckoutChoice =
  | { type: "cancel" }
  | { type: "block" }
  | { type: "stash-and-continue" };

export interface LocalChangesCheckoutPromptRequest {
  branchName: string;
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
