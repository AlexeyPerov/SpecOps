import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceAgentBackendError,
  WorkspaceAgentBackendNotImplementedError,
  createWorkspaceAgentBackend,
  type WorkspaceAgentBackendErrorCode,
  type WorkspaceAgentStreamEvent,
} from "./workspaceAgentBackend";

function createOpencodeBackendForTests(params?: {
  mode?: "sidecar" | "url";
  baseUrl?: string;
  createSessionResult?: unknown;
  getSessionResult?: unknown;
  listSessionsResult?: unknown;
  deleteSessionError?: unknown;
  sendPromptResult?: unknown;
  streamEvents?: unknown[];
}) {
  const calls: Array<{ baseUrl: string; workspaceRootPath: string }> = [];
  const backend = createWorkspaceAgentBackend("opencode", {
    resolveRuntimeConfig: async () => ({
      mode: params?.mode ?? "url",
      baseUrl: params?.baseUrl ?? "http://opencode.local",
    }),
    createOpencodeClient: (input) => {
      calls.push(input);
      return {
        async createSession() {
          return params?.createSessionResult ?? {
            id: "sess-1",
            title: "New session",
            createdAt: "2026-06-09T19:00:00.000Z",
            updatedAt: "2026-06-09T19:00:00.000Z",
          };
        },
        async getSession() {
          if (params?.getSessionResult instanceof Error) {
            throw params.getSessionResult;
          }
          return params?.getSessionResult ?? {
            id: "sess-1",
            title: "Session",
          };
        },
        async listSessions() {
          return (
            params?.listSessionsResult ?? [
              {
                id: "sess-1",
                title: "Session A",
              },
            ]
          );
        },
        async deleteSession() {
          if (params?.deleteSessionError) {
            throw params.deleteSessionError;
          }
          return null;
        },
        async sendPrompt() {
          return params?.sendPromptResult ?? {
            sessionID: "sess-1",
          };
        },
        async *streamEvents() {
          const events = params?.streamEvents ?? [
            { type: "session.next.text.delta", data: { delta: "Hello" } },
            {
              type: "session.next.tool.called",
              data: { tool: "read_file", callID: "call-1", input: { path: "a" } },
            },
            {
              type: "session.next.tool.success",
              data: { tool: "read_file", callID: "call-1", result: { ok: true } },
            },
            { type: "session.status", data: { status: { type: "idle" } } },
          ];
          for (const event of events) {
            yield event;
          }
        },
      };
    },
  });
  return { backend, calls };
}

describe("workspaceAgentBackend", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps cursor-local as phase 5 stub", async () => {
    const backend = createWorkspaceAgentBackend("cursor-local");
    await expect(
      backend.createSession({
        workspaceRootPath: "/tmp/project",
      }),
    ).rejects.toBeInstanceOf(WorkspaceAgentBackendNotImplementedError);
  });

  it("creates a functional opencode backend", async () => {
    const { backend, calls } = createOpencodeBackendForTests();
    const session = await backend.createSession({
      workspaceRootPath: "/tmp/workspace",
      title: "Sprint",
    });
    expect(session.id).toBe("sess-1");
    expect(calls).toEqual([
      {
        baseUrl: "http://opencode.local",
        workspaceRootPath: "/tmp/workspace",
      },
    ]);
  });

  it("maps invalid directory errors", async () => {
    const { backend } = createOpencodeBackendForTests();
    await expect(
      backend.listSessions({
        workspaceRootPath: "   ",
      }),
    ).rejects.toMatchObject({
      code: "invalidDirectory",
    });
  });

  it.each([
    [401, "authFailure"],
    [404, "notFound"],
    [400, "invalidDirectory"],
    [503, "serverUnavailable"],
    [500, "transportError"],
  ] as const)(
    "maps HTTP %s into backend error code %s",
    async (status, expectedCode) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: async () => (status === 400 ? "directory is invalid" : "request failed"),
      });
      vi.stubGlobal("fetch", fetchMock);
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
      });

      await expect(
        backend.listSessions({
          workspaceRootPath: "/tmp/workspace",
        }),
      ).rejects.toMatchObject({
        code: expectedCode as WorkspaceAgentBackendErrorCode,
      });
    },
  );

  it("normalizes stream events without exposing raw SDK shapes", async () => {
    const { backend } = createOpencodeBackendForTests();
    const seen: WorkspaceAgentStreamEvent[] = [];
    for await (const event of backend.streamEvents({
      workspaceRootPath: "/tmp/workspace",
      sessionId: "sess-1",
    })) {
      seen.push(event);
    }
    expect(seen).toEqual([
      { type: "message.delta", delta: "Hello" },
      {
        type: "tool.started",
        toolName: "read_file",
        callId: "call-1",
        input: { path: "a" },
      },
      {
        type: "tool.completed",
        toolName: "read_file",
        callId: "call-1",
        output: { ok: true },
        isError: false,
      },
      {
        type: "run.completed",
      },
    ]);
  });

  it("maps session payload validation failures", async () => {
    const { backend } = createOpencodeBackendForTests({
      createSessionResult: { title: "missing id" },
    });
    await expect(
      backend.createSession({
        workspaceRootPath: "/tmp/workspace",
      }),
    ).rejects.toBeInstanceOf(WorkspaceAgentBackendError);
  });

  it("normalizes permission/question/run failed stream events", async () => {
    const { backend } = createOpencodeBackendForTests({
      streamEvents: [
        {
          type: "permission.v2.asked",
          data: {
            id: "perm-1",
            action: "Read file",
            path: "a.txt",
          },
        },
        {
          type: "question.v2.asked",
          data: {
            id: "q-1",
            questions: [
              {
                header: "Continue?",
                options: [{ label: "yes" }, { label: "no" }],
              },
            ],
            step: 1,
          },
        },
        {
          type: "session.error",
          data: {
            message: "boom",
          },
        },
      ],
    });

    const seen: WorkspaceAgentStreamEvent[] = [];
    for await (const event of backend.streamEvents({
      workspaceRootPath: "/tmp/workspace",
      sessionId: "sess-1",
    })) {
      seen.push(event);
    }

    expect(seen).toEqual([
      {
        type: "permission.requested",
        permissionId: "perm-1",
        label: "Read file",
        payload: { id: "perm-1", action: "Read file", path: "a.txt" },
      },
      {
        type: "question.requested",
        questionId: "q-1",
        prompt: "Continue?",
        choices: ["yes", "no"],
        payload: {
          id: "q-1",
          questions: [{ header: "Continue?", options: [{ label: "yes" }, { label: "no" }] }],
          step: 1,
        },
      },
      {
        type: "run.failed",
        message: "boom",
      },
    ]);
  });

  it("deduplicates repeated stream ids and supports out-of-order tool completion", async () => {
    const { backend } = createOpencodeBackendForTests({
      streamEvents: [
        {
          id: "evt-1",
          type: "session.next.text.delta",
          data: { delta: "A" },
        },
        {
          id: "evt-1",
          type: "session.next.text.delta",
          data: { delta: "A" },
        },
        {
          id: "evt-2",
          type: "session.next.tool.success",
          data: { tool: "read_file", callID: "call-9", result: { ok: true } },
        },
        {
          id: "evt-3",
          type: "session.next.tool.progress",
          data: { tool: "read_file", callID: "call-9", progress: { pct: 50 } },
        },
      ],
    });

    const seen: WorkspaceAgentStreamEvent[] = [];
    for await (const event of backend.streamEvents({
      workspaceRootPath: "/tmp/workspace",
      sessionId: "sess-1",
    })) {
      seen.push(event);
    }

    expect(seen).toEqual([
      { type: "message.delta", delta: "A" },
      {
        type: "tool.started",
        toolName: "read_file",
        callId: "call-9",
        input: null,
      },
      {
        type: "tool.completed",
        toolName: "read_file",
        callId: "call-9",
        output: { ok: true },
        isError: false,
      },
      {
        type: "tool.progress",
        toolName: "read_file",
        callId: "call-9",
        output: { pct: 50 },
      },
    ]);
  });
});
