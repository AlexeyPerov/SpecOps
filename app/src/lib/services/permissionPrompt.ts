import type { PermissionReply } from "../session/events";

export interface PermissionPromptRequest {
  permissionId: string;
  label: string;
  payload: unknown;
}

export type PermissionPromptResult =
  | { reply: Exclude<PermissionReply, "reject"> }
  | { reply: "reject" };

type PermissionPromptRunner = (request: PermissionPromptRequest) => Promise<PermissionPromptResult>;

let runner: PermissionPromptRunner | null = null;

export function registerPermissionPromptRunner(next: PermissionPromptRunner | null): void {
  runner = next;
}

export function promptPermission(request: PermissionPromptRequest): Promise<PermissionPromptResult> {
  if (!runner) {
    return Promise.resolve({ reply: "reject" });
  }
  return runner(request);
}
