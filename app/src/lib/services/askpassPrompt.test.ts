import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitAskpassRequest } from "../git/types";
import {
  promptGitCredentials,
  registerAskpassPromptRunner,
  resetAskpassPromptQueueForTests,
} from "./askpassPrompt";

function makeRequest(id: string): GitAskpassRequest {
  return {
    sessionId: "session-1",
    requestId: id,
    prompt: `Password for ${id}:`,
    hostHint: "example.com",
    usernameHint: null,
    inputKind: "password",
    operation: "fetch",
    timeoutMs: 120_000,
  };
}

describe("promptGitCredentials", () => {
  beforeEach(() => {
    resetAskpassPromptQueueForTests();
    registerAskpassPromptRunner(null);
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
