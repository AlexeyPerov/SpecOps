import type { PromptAnchor } from "./promptAnchor";
import type { GitRemote } from "../git/types";

export interface TagPushPromptRequest {
  tagName: string;
  remotes: GitRemote[];
  /** Open as a bubble beside this rect (e.g. the button that asked). */
  anchor?: PromptAnchor;
}

export interface TagPushPromptResult {
  type: "confirm";
  remoteNames: string[];
}

type TagPushPromptRunner = (request: TagPushPromptRequest) => Promise<TagPushPromptResult | null>;

let runner: TagPushPromptRunner | null = null;

export function registerTagPushPromptRunner(next: TagPushPromptRunner | null): void {
  runner = next;
}

export function promptTagPush(request: TagPushPromptRequest): Promise<TagPushPromptResult | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}
