import type { GitRemote } from "../git/types";

export interface TagDeletePromptRequest {
  tagName: string;
  remotes: GitRemote[];
}

export interface TagDeletePromptResult {
  type: "confirm";
  deleteFromRemotes: boolean;
}

type TagDeletePromptRunner = (
  request: TagDeletePromptRequest,
) => Promise<TagDeletePromptResult | null>;

let runner: TagDeletePromptRunner | null = null;

export function registerTagDeletePromptRunner(next: TagDeletePromptRunner | null): void {
  runner = next;
}

export function promptTagDelete(
  request: TagDeletePromptRequest,
): Promise<TagDeletePromptResult | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}
