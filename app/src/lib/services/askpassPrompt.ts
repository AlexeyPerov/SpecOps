import type { GitAskpassRequest, GitAskpassResponse } from "../git/types";

export type AskpassPromptResult =
  | { type: "submit"; value: string }
  | { type: "cancel" };

type AskpassPromptRunner = (request: GitAskpassRequest) => Promise<AskpassPromptResult>;

interface PendingAskpassRequest {
  request: GitAskpassRequest;
  resolve: (response: GitAskpassResponse) => void;
}

let runner: AskpassPromptRunner | null = null;
let activeRequestId: string | null = null;
const pendingRequests: PendingAskpassRequest[] = [];

function buildCancelledResponse(request: GitAskpassRequest): GitAskpassResponse {
  return {
    sessionId: request.sessionId,
    requestId: request.requestId,
    value: "",
    cancelled: true,
  };
}

function buildSubmitResponse(
  request: GitAskpassRequest,
  value: string,
): GitAskpassResponse {
  return {
    sessionId: request.sessionId,
    requestId: request.requestId,
    value,
  };
}

async function drainAskpassQueue(): Promise<void> {
  if (!runner || activeRequestId !== null) {
    return;
  }

  const next = pendingRequests.shift();
  if (!next) {
    return;
  }

  activeRequestId = next.request.requestId;
  try {
    const result = await runner(next.request);
    if (result.type === "cancel") {
      next.resolve(buildCancelledResponse(next.request));
    } else {
      next.resolve(buildSubmitResponse(next.request, result.value));
    }
  } finally {
    activeRequestId = null;
    void drainAskpassQueue();
  }
}

export function registerAskpassPromptRunner(next: AskpassPromptRunner | null): void {
  runner = next;
  if (!runner) {
    while (pendingRequests.length > 0) {
      const pending = pendingRequests.shift();
      pending?.resolve(buildCancelledResponse(pending.request));
    }
  }
}

export function isAskpassPromptActive(): boolean {
  return activeRequestId !== null;
}

/** Reset queue state (tests only). */
export function resetAskpassPromptQueueForTests(): void {
  pendingRequests.length = 0;
  activeRequestId = null;
}

export function promptGitCredentials(
  request: GitAskpassRequest,
): Promise<GitAskpassResponse> {
  if (!runner) {
    return Promise.resolve(buildCancelledResponse(request));
  }

  return new Promise((resolve) => {
    pendingRequests.push({ request, resolve });
    void drainAskpassQueue();
  });
}
