import type { GitAskpassRequest, GitAskpassResponse } from "../git/types";

export type AskpassPromptResult =
  | { type: "submit"; value: string }
  | { type: "cancel" };

type AskpassPromptRunner = (request: GitAskpassRequest) => Promise<AskpassPromptResult>;

let runner: AskpassPromptRunner | null = null;
let activeRequestId: string | null = null;

export function registerAskpassPromptRunner(next: AskpassPromptRunner | null): void {
  runner = next;
}

export function isAskpassPromptActive(): boolean {
  return activeRequestId !== null;
}

export async function promptGitCredentials(
  request: GitAskpassRequest,
): Promise<GitAskpassResponse> {
  if (!runner) {
    return {
      sessionId: request.sessionId,
      requestId: request.requestId,
      value: "",
      cancelled: true,
    };
  }

  if (activeRequestId) {
    return {
      sessionId: request.sessionId,
      requestId: request.requestId,
      value: "",
      cancelled: true,
    };
  }

  activeRequestId = request.requestId;
  try {
    const result = await runner(request);
    if (result.type === "cancel") {
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        value: "",
        cancelled: true,
      };
    }
    return {
      sessionId: request.sessionId,
      requestId: request.requestId,
      value: result.value,
    };
  } finally {
    activeRequestId = null;
  }
}
