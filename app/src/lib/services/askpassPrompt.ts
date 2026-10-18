import type { GitAskpassRequest, GitAskpassResponse } from "../git/types";

export type AskpassPromptResult =
  | { type: "submit"; value: string }
  | { type: "cancel" };

/**
 * Shows one credential dialog. `signal` aborts when the request no longer needs an
 * answer (timed out, or resolved elsewhere); the runner must then close its dialog.
 */
type AskpassPromptRunner = (
  request: GitAskpassRequest,
  signal: AbortSignal,
) => Promise<AskpassPromptResult>;

type AbortReason = "timeout" | "dismissed";

interface PendingAskpassRequest {
  request: GitAskpassRequest;
  /** `null` means the request was resolved elsewhere: send nothing back. */
  resolve: (response: GitAskpassResponse | null) => void;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
}

let runner: AskpassPromptRunner | null = null;
let active: PendingAskpassRequest | null = null;
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

function sameRequest(entry: PendingAskpassRequest, sessionId: string, requestId: string): boolean {
  return entry.request.sessionId === sessionId && entry.request.requestId === requestId;
}

function settle(entry: PendingAskpassRequest, response: GitAskpassResponse | null): void {
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.resolve(response);
}

/** Abort `entry`: queued entries settle now, the shown one through its runner. */
function abortEntry(entry: PendingAskpassRequest, reason: AbortReason): void {
  if (entry.controller.signal.aborted) return;
  entry.controller.abort(reason);
  const index = pendingRequests.indexOf(entry);
  if (index >= 0) {
    pendingRequests.splice(index, 1);
    settle(entry, reason === "timeout" ? buildCancelledResponse(entry.request) : null);
  }
}

function abortedResult(signal: AbortSignal): Promise<AskpassPromptResult> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ type: "cancel" });
      return;
    }
    signal.addEventListener("abort", () => resolve({ type: "cancel" }), { once: true });
  });
}

async function drainAskpassQueue(): Promise<void> {
  if (!runner || active !== null) {
    return;
  }

  const next = pendingRequests.shift();
  if (!next) {
    return;
  }

  active = next;
  const { signal } = next.controller;
  try {
    // Race the abort so a runner that ignores the signal cannot stall the queue.
    const result = await Promise.race([runner(next.request, signal), abortedResult(signal)]);
    if (signal.aborted && signal.reason === "dismissed") {
      settle(next, null);
    } else if (result.type === "cancel" || signal.aborted) {
      settle(next, buildCancelledResponse(next.request));
    } else {
      settle(next, buildSubmitResponse(next.request, result.value));
    }
  } catch {
    settle(next, buildCancelledResponse(next.request));
  } finally {
    active = null;
    void drainAskpassQueue();
  }
}

export function registerAskpassPromptRunner(next: AskpassPromptRunner | null): void {
  runner = next;
  if (!runner) {
    while (pendingRequests.length > 0) {
      const pending = pendingRequests.shift();
      if (pending) settle(pending, buildCancelledResponse(pending.request));
    }
  }
}

export function isAskpassPromptActive(): boolean {
  return active !== null;
}

/**
 * The backend no longer needs an answer for this request (another window answered
 * or cancelled it, it timed out, or git exited). Close or drop it without replying.
 */
export function dismissAskpassRequest(sessionId: string, requestId: string): void {
  if (active && sameRequest(active, sessionId, requestId)) {
    abortEntry(active, "dismissed");
    return;
  }
  const queued = pendingRequests.find((entry) => sameRequest(entry, sessionId, requestId));
  if (queued) abortEntry(queued, "dismissed");
}

/** Reset queue state (tests only). */
export function resetAskpassPromptQueueForTests(): void {
  for (const entry of pendingRequests) {
    if (entry.timer !== null) clearTimeout(entry.timer);
  }
  pendingRequests.length = 0;
  active = null;
}

/**
 * Ask the user for a credential. Resolves `null` when the request was resolved
 * elsewhere and nothing must be sent back. The request auto-cancels after
 * `timeoutMs` (counted from arrival, including time spent queued).
 */
export function promptGitCredentials(
  request: GitAskpassRequest,
): Promise<GitAskpassResponse | null> {
  if (!runner) {
    return Promise.resolve(buildCancelledResponse(request));
  }

  return new Promise((resolve) => {
    const entry: PendingAskpassRequest = {
      request,
      resolve,
      controller: new AbortController(),
      timer: null,
    };
    if (Number.isFinite(request.timeoutMs) && request.timeoutMs > 0) {
      entry.timer = setTimeout(() => {
        entry.timer = null;
        abortEntry(entry, "timeout");
      }, request.timeoutMs);
    }
    pendingRequests.push(entry);
    void drainAskpassQueue();
  });
}
