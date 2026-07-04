import { describe, expect, it, vi } from "vitest";
import { promptGitCredentials, registerAskpassPromptRunner } from "../services/askpassPrompt";
import type { GitAskpassRequest } from "../git/types";

describe("askpassPrompt", () => {
  it("returns cancelled when no runner is registered", async () => {
    registerAskpassPromptRunner(null);
    const request: GitAskpassRequest = {
      sessionId: "session-1",
      requestId: "req-1",
      prompt: "Password for 'https://example.com':",
      hostHint: "example.com",
      usernameHint: null,
      inputKind: "password",
      operation: "push",
      timeoutMs: 120_000,
    };

    const response = await promptGitCredentials(request);
    expect(response).toEqual({
      sessionId: "session-1",
      requestId: "req-1",
      value: "",
      cancelled: true,
    });
  });

  it("serializes concurrent prompts to a single active request", async () => {
    const runner = vi.fn(async () => ({ type: "submit" as const, value: "secret" }));
    registerAskpassPromptRunner(runner);

    const first: GitAskpassRequest = {
      sessionId: "session-1",
      requestId: "req-1",
      prompt: "Username for 'https://example.com':",
      hostHint: "example.com",
      usernameHint: null,
      inputKind: "username",
      operation: "fetch",
      timeoutMs: 120_000,
    };
    const second: GitAskpassRequest = {
      ...first,
      requestId: "req-2",
    };

    const [firstResponse, secondResponse] = await Promise.all([
      promptGitCredentials(first),
      promptGitCredentials(second),
    ]);

    expect(firstResponse.cancelled).toBeUndefined();
    expect(firstResponse.value).toBe("secret");
    expect(secondResponse.cancelled).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);

    registerAskpassPromptRunner(null);
  });
});
