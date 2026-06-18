import { describe, expect, it } from "vitest";
import {
  WorkspaceAgentBackendError,
  createWorkspaceAgentBackend,
  type OpencodeSessionMessageEntry,
} from "./workspaceAgentBackend";
import { createRawOpencodeClientStub } from "../../test/rawOpencodeClientStub";

function createBackendWithMessages(
  listMessagesResult: unknown,
  options?: { listMessagesError?: unknown },
) {
  return createWorkspaceAgentBackend("opencode", {
    resolveRuntimeConfig: async () => ({
      mode: "url",
      baseUrl: "http://opencode.local",
    }),
    resolveServerPassword: async () => "",
    createOpencodeClient: () =>
      createRawOpencodeClientStub({
        async listMessages(): Promise<OpencodeSessionMessageEntry[]> {
          if (options?.listMessagesError) {
            throw options.listMessagesError;
          }
          return (Array.isArray(listMessagesResult)
            ? listMessagesResult
            : []) as OpencodeSessionMessageEntry[];
        },
      }),
  });
}

describe("workspaceAgentBackend.listMessages", () => {
  it("returns the unwrapped { info, parts } entries from SDK session.messages", async () => {
    const backend = createBackendWithMessages([
      {
        info: { id: "u1", sessionID: "s1", role: "user", time: { created: 1 } },
        parts: [{ type: "text", text: "hi" }],
      },
      {
        info: {
          id: "a1",
          sessionID: "s1",
          role: "assistant",
          time: { created: 2 },
        },
        parts: [{ type: "text", text: "hello" }],
      },
    ]);

    const entries = await backend.listMessages({
      workspaceRootPath: "/repo",
      sessionId: "s1",
    });

    expect(entries).toEqual([
      {
        info: { id: "u1", sessionID: "s1", role: "user", time: { created: 1 } },
        parts: [{ type: "text", text: "hi" }],
      },
      {
        info: {
          id: "a1",
          sessionID: "s1",
          role: "assistant",
          time: { created: 2 },
        },
        parts: [{ type: "text", text: "hello" }],
      },
    ]);
  });

  it("returns [] when SDK returns a non-array payload", async () => {
    const backend = createBackendWithMessages({ not: "an array" });
    const entries = await backend.listMessages({
      workspaceRootPath: "/repo",
      sessionId: "s1",
    });
    expect(entries).toEqual([]);
  });

  it("coerces entries without parts into empty parts arrays", async () => {
    const backend = createBackendWithMessages([{ info: { id: "x" } }]);
    const entries = await backend.listMessages({
      workspaceRootPath: "/repo",
      sessionId: "s1",
    });
    expect(entries).toEqual([{ info: { id: "x" }, parts: [] }]);
  });

  it("returns [] on notFound errors (session deleted concurrently)", async () => {
    const backend = createBackendWithMessages([], {
      listMessagesError: new WorkspaceAgentBackendError({
        code: "notFound",
        message: "session gone",
      }),
    });
    const entries = await backend.listMessages({
      workspaceRootPath: "/repo",
      sessionId: "s1",
    });
    expect(entries).toEqual([]);
  });

  it("rethrows non-notFound errors", async () => {
    const backend = createBackendWithMessages([], {
      listMessagesError: new WorkspaceAgentBackendError({
        code: "transportError",
        message: "boom",
      }),
    });
    await expect(
      backend.listMessages({ workspaceRootPath: "/repo", sessionId: "s1" }),
    ).rejects.toBeInstanceOf(WorkspaceAgentBackendError);
  });
});
