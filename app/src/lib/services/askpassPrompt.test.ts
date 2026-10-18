import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitAskpassRequest } from "../git/types";
import {
  dismissAskpassRequest,
  promptGitCredentials,
  registerAskpassPromptRunner,
  resetAskpassPromptQueueForTests,
} from "./askpassPrompt";

function makeRequest(id: string, timeoutMs = 120_000): GitAskpassRequest {
  return {
    sessionId: "session-1",
    requestId: id,
    prompt: `Password for ${id}:`,
    hostHint: "example.com",
    usernameHint: null,
    inputKind: "password",
    operation: "fetch",
    timeoutMs,
  };
}

describe("promptGitCredentials", () => {
  beforeEach(() => {
    resetAskpassPromptQueueForTests();
    registerAskpassPromptRunner(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runner that only settles when its signal aborts, recording what it saw. */
  function hangingRunner(seen: string[]) {
    return (request: GitAskpassRequest, signal: AbortSignal) =>
      new Promise<{ type: "cancel" }>((resolve) => {
        seen.push(request.requestId);
        signal.addEventListener("abort", () => {
          seen.push(`abort:${request.requestId}:${String(signal.reason)}`);
          resolve({ type: "cancel" });
        });
      });
  }

  it("auto-cancels the shown and the queued request after timeoutMs", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    registerAskpassPromptRunner(hangingRunner(seen));
    const first = promptGitCredentials(makeRequest("req-1", 1_000));
    // Queued behind req-1 and expiring first: it is never shown.
    const second = promptGitCredentials(makeRequest("req-2", 500));
    await vi.advanceTimersByTimeAsync(500);
    await expect(second).resolves.toMatchObject({ requestId: "req-2", cancelled: true });
    await vi.advanceTimersByTimeAsync(500);
    await expect(first).resolves.toMatchObject({ requestId: "req-1", cancelled: true });
    expect(seen).toEqual(["req-1", "abort:req-1:timeout"]);
  });

  it("closes a request resolved elsewhere without producing a response", async () => {
    const seen: string[] = [];
    registerAskpassPromptRunner(hangingRunner(seen));
    const first = promptGitCredentials(makeRequest("req-1"));
    const second = promptGitCredentials(makeRequest("req-2"));
    const third = promptGitCredentials(makeRequest("req-3"));
    await Promise.resolve();
    dismissAskpassRequest("session-1", "req-2");
    await expect(second).resolves.toBeNull();
    dismissAskpassRequest("session-1", "req-1");
    await expect(first).resolves.toBeNull();
    await vi.waitFor(() => expect(seen).toContain("req-3"));
    expect(seen).not.toContain("req-2");
    dismissAskpassRequest("other-session", "req-3");
    expect(seen).not.toContain("abort:req-3:dismissed");
    dismissAskpassRequest("session-1", "req-3");
    await expect(third).resolves.toBeNull();
  });

  it("does not let a runner that ignores the abort signal stall the queue", async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    registerAskpassPromptRunner((request) => {
      started.push(request.requestId);
      return new Promise(() => {});
    });
    const first = promptGitCredentials(makeRequest("req-1", 500));
    const second = promptGitCredentials(makeRequest("req-2", 5_000));
    await vi.advanceTimersByTimeAsync(500);
    await expect(first).resolves.toMatchObject({ cancelled: true });
    expect(started).toEqual(["req-1", "req-2"]);
    dismissAskpassRequest("session-1", "req-2");
    await expect(second).resolves.toBeNull();
  });

  it("queues concurrent askpass requests instead of cancelling them", async () => {
    const order: string[] = [];
    registerAskpassPromptRunner(async (request) => {
      order.push(`start:${request.requestId}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${request.requestId}`);
      return { type: "submit", value: request.requestId };
    });

    const [first, second] = await Promise.all([
      promptGitCredentials(makeRequest("req-1")),
      promptGitCredentials(makeRequest("req-2")),
    ]);

    expect(first).toEqual({
      sessionId: "session-1",
      requestId: "req-1",
      value: "req-1",
    });
    expect(second).toEqual({
      sessionId: "session-1",
      requestId: "req-2",
      value: "req-2",
    });
    expect(order).toEqual(["start:req-1", "end:req-1", "start:req-2", "end:req-2"]);
  });
});
