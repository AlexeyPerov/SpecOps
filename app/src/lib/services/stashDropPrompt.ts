export interface StashDropPromptRequest {
  stashRef: string;
  message: string;
}

export interface StashDropPromptResult {
  type: "confirm";
}

type StashDropPromptRunner = (
  request: StashDropPromptRequest,
) => Promise<StashDropPromptResult | null>;

let runner: StashDropPromptRunner | null = null;

export function registerStashDropPromptRunner(next: StashDropPromptRunner | null): void {
  runner = next;
}

export function promptStashDrop(
  request: StashDropPromptRequest,
): Promise<StashDropPromptResult | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}
