import { describe, expect, it } from "vitest";
import {
  WorkspaceAgentBackendError,
  createWorkspaceAgentBackend,
  type OpencodeSessionMessageEntry,
} from "./workspaceAgentBackend";

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
    createOpencodeClient: () => ({
      async createSession() {
        return { id: "s1" };
      },
      async getSession() {
        return { id: "s1" };
      },
      async listSessions() {
        return [];
      },
      async deleteSession() {
        return null;
      },
      async sendPrompt() {
        return { sessionID: "s1" };
      },
      async replyPermission() {
        return null;
      },
      async replyQuestion() {
        return null;
      },
      async rejectQuestion() {
        return null;
      },
      async abortSession() {
        return null;
      },
      async *streamEvents() {
        // noop
      },
      async listMessages(): Promise<OpencodeSessionMessageEntry[]> {
        if (options?.listMessagesError) {
          throw options.listMessagesError;
        }
        return (Array.isArray(listMessagesResult)
          ? listMessagesResult
          : []) as OpencodeSessionMessageEntry[];
      },
      async updateSession(input) {
        return { id: input.sessionId, title: input.title ?? "", time: { created: 1, updated: 2 } };
      },
      async forkSession(input) {
        return {
          id: "fork",
          title: "fork",
          parentID: input.sessionId,
          time: { created: 3, updated: 3 },
        };
      },
      async revertSession(input) {
        return { id: input.sessionId, title: "", time: { created: 1, updated: 4 } };
      },
      async unrevertSession(input) {
        return { id: input.sessionId, title: "", time: { created: 1, updated: 5 } };
      },
      async shareSession(input) {
        return {
          id: input.sessionId,
          title: "",
          share: { url: "https://share/s" },
          time: { created: 1, updated: 6 },
        };
      },
      async unshareSession(input) {
        return { id: input.sessionId, title: "", time: { created: 1, updated: 7 } };
      },
      async summarizeSession() {
        return true;
      },
      async listSessionChildren() {
        return [];
      },
      async listModels() {
        return { data: [] };
      },
      async listProviders() {
        return { data: [] };
      },
      async listAgents() {
        return { data: [] };
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
