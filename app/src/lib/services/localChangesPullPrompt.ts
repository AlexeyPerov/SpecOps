export type LocalChangesPullChoice =
  | { type: "cancel" }
  | { type: "block" }
  | { type: "stash-and-pull" };

type LocalChangesPullPromptRunner = () => Promise<LocalChangesPullChoice | null>;

let runner: LocalChangesPullPromptRunner | null = null;

export function registerLocalChangesPullPromptRunner(
  next: LocalChangesPullPromptRunner | null,
): void {
  runner = next;
}

export function promptLocalChangesPull(): Promise<LocalChangesPullChoice | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner();
}
