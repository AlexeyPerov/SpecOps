import type { GitRemote } from "../git/types";
import { resolveDefaultRemote } from "../git/gitParse";

export interface TagDeletePromptRequest {
  tagName: string;
  remotes: GitRemote[];
}

export interface TagDeletePromptResult {
  type: "confirm";
  /**
   * Empty array: delete the tag locally only. Non-empty: delete it locally
   * and from the named remotes. The user picks which remotes in the prompt,
   * mirroring the push-tag flow — previously the only choice was "all or
   * none", so a single confirm deleted the tag on every configured remote
   * (M7).
   */
  remoteNames: string[];
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

/**
 * Resolve the default remote selection for the delete prompt. Exported so the
 * prompt component and tests share one resolution rule with the push-tag
 * prompt, which uses {@link resolveDefaultRemote}.
 */
export function resolveDefaultDeleteRemote(
  remotes: GitRemote[],
): GitRemote | undefined {
  return resolveDefaultRemote(remotes) ?? remotes[0];
}
