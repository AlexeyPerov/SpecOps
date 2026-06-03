export interface EntryNamePromptRequest {
  title: string;
  defaultValue: string;
  confirmLabel?: string;
}

type EntryNamePromptRunner = (request: EntryNamePromptRequest) => Promise<string | null>;

let runner: EntryNamePromptRunner | null = null;

export function registerEntryNamePromptRunner(next: EntryNamePromptRunner | null): void {
  runner = next;
}

export function promptEntryName(request: EntryNamePromptRequest): Promise<string | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}
