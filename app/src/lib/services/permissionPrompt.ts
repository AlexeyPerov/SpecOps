import type { PermissionReply } from "../session/events";
import {
  createSessionPromptQueue,
  type SessionPromptEntry,
  type SessionPromptTarget,
} from "./sessionPromptQueue";

export interface PermissionPromptRequest extends SessionPromptTarget {
  permissionId: string;
  label: string;
  payload: unknown;
}

export type PermissionPromptResult =
  | { reply: Exclude<PermissionReply, "reject"> }
  | { reply: "reject" };

export type PendingPermissionPrompt = SessionPromptEntry<PermissionPromptRequest>;

/**
 * Pending permission requests keyed by owning session. The session's chat
 * renders the entry as an inline card and answers it through
 * `answerPermissionPrompt`.
 */
export const pendingPermissionPrompts = createSessionPromptQueue<PermissionPromptRequest, PermissionPromptResult>({
  reply: "reject",
});

/**
 * Ask the user to approve an agent action in the requesting session's chat.
 * Resolves with `reject` when the request is aborted or superseded by a newer
 * request for the same session.
 */
export function promptPermission(request: PermissionPromptRequest): Promise<PermissionPromptResult> {
  return pendingPermissionPrompts.request(request);
}

export function answerPermissionPrompt(entry: Pick<PendingPermissionPrompt, "key" | "seq">, result: PermissionPromptResult): boolean {
  return pendingPermissionPrompts.respond(entry, result);
}
