import type { WorkspacePermissionReply } from "../ai/backends/workspaceAgentBackend";

export interface PermissionPromptRequest {
  permissionId: string;
  label: string;
  payload: unknown;
}

export type PermissionPromptResult =
  | { reply: Exclude<WorkspacePermissionReply, "reject"> }
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
