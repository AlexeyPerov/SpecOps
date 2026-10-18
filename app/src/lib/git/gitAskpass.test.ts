import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startGitAskpassBridge, stopGitAskpassBridge } from "./gitAskpass";
import {
  registerAskpassPromptRunner,
  resetAskpassPromptQueueForTests,
} from "../services/askpassPrompt";

const listeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
const disposers = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, listener: (event: { payload: unknown }) => void) => {
    listeners.set(name, listener);
    const dispose = vi.fn(() => listeners.delete(name));
    disposers.push(dispose);
    return dispose;
  }),
}));

const REQUEST_EVENT = "spec-ops/git/askpass-request";
const RESOLVED_EVENT = "spec-ops/git/askpass-resolved";
const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};

function emitRequest(requestId: string) {
  listeners.get(REQUEST_EVENT)?.({
    payload: {
      sessionId: "s1",
      requestId,
      prompt: "Password for 'https://example.com':",
      inputKind: "password",
      timeoutMs: 60_000,
    },
  });
}

describe("git askpass bridge", () => {
  beforeEach(async () => {
    await stopGitAskpassBridge();
    resetAskpassPromptQueueForTests();
    listeners.clear();
    disposers.length = 0;
    vi.clearAllMocks();
  });
  afterEach(async () => {
    registerAskpassPromptRunner(null);
    await stopGitAskpassBridge();
  });

  it("closes the local dialog without replying when another window resolved the request", async () => {
    const aborted: string[] = [];
    registerAskpassPromptRunner(
      (request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted.push(request.requestId);
            resolve({ type: "cancel" });
          });
        }),
    );
    await startGitAskpassBridge();
    emitRequest("askpass-1");
    await flush();
    listeners.get(RESOLVED_EVENT)?.({ payload: { sessionId: "s1", requestId: "askpass-1", reason: "answered" } });
    await flush();
    expect(aborted).toEqual(["askpass-1"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the submitted secret untouched", async () => {
    registerAskpassPromptRunner(async () => ({ type: "submit", value: "  pw  " }));
    await startGitAskpassBridge();
    emitRequest("askpass-1");
    await flush();
    expect(invoke).toHaveBeenCalledWith("respond_git_askpass", {
      request: { sessionId: "s1", requestId: "askpass-1", value: "  pw  ", cancelled: false },
    });
  });

  it("does not keep listeners when stopped while still subscribing", async () => {
    const starting = startGitAskpassBridge();
    await stopGitAskpassBridge();
    await starting;
    expect(listen).toHaveBeenCalledTimes(2);
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    await startGitAskpassBridge();
    expect(listeners.has(REQUEST_EVENT)).toBe(true);
    expect(listeners.has(RESOLVED_EVENT)).toBe(true);
  });
});
