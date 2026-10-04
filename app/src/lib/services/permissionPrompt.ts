import type { PermissionReply } from "../session/events";

export interface PermissionPromptRequest {
  permissionId: string;
  label: string;
  payload: unknown;
  signal?: AbortSignal;
}

export type PermissionPromptResult =
  | { reply: Exclude<PermissionReply, "reject"> }
  | { reply: "reject" };

type PermissionPromptRunner = (request: PermissionPromptRequest) => Promise<PermissionPromptResult>;

let runner: PermissionPromptRunner | null = null;
const pending = new Map<string, { request: PermissionPromptRequest; deliver: () => void }>();

export function registerPermissionPromptRunner(next: PermissionPromptRunner | null): void {
  runner = next;
  if (next) for (const entry of pending.values()) entry.deliver();
}

export function promptPermission(request: PermissionPromptRequest): Promise<PermissionPromptResult> {
  if (!runner) {
    return Promise.resolve({ reply: "reject" });
  }
  if (request.signal?.aborted) return Promise.resolve({ reply: "reject" });
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: PermissionPromptResult) => { if (settled) return; settled = true; pending.delete(request.permissionId); request.signal?.removeEventListener('abort', abort); resolve(value); };
    const abort = () => finish({ reply: "reject" });
    const deliver = () => { if (runner && !settled) void runner(request).then(finish, abort); };
    pending.set(request.permissionId, { request, deliver });
    request.signal?.addEventListener('abort', abort, { once: true });
    deliver();
  });
}
