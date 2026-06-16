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
  replyPermissionError?: unknown;
  replyQuestionError?: unknown;
  rejectQuestionError?: unknown;
  abortSessionError?: unknown;
  streamEvents?: unknown[];
}) {
  const calls: Array<{ baseUrl: string; workspaceRootPath: string; serverPassword: string }> = [];
  const sendPromptCalls: Array<{ sessionId: string; prompt: string; model?: string }> = [];
  const backend = createWorkspaceAgentBackend("opencode", {
    resolveRuntimeConfig: async () => ({
      mode: params?.mode ?? "url",
      baseUrl: params?.baseUrl ?? "http://opencode.local",
    }),
    resolveServerPassword: async () => "",
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
        async sendPrompt(input) {
          sendPromptCalls.push(input);
          return params?.sendPromptResult ?? {
            sessionID: "sess-1",
          };
        },
        async replyPermission() {
          if (params?.replyPermissionError) {
            throw params.replyPermissionError;
          }
          return null;
        },
        async replyQuestion() {
          if (params?.replyQuestionError) {
            throw params.replyQuestionError;
          }
          return null;
        },
        async rejectQuestion() {
          if (params?.rejectQuestionError) {
            throw params.rejectQuestionError;
          }
          return null;
        },
        async abortSession() {
          if (params?.abortSessionError) {
            throw params.abortSessionError;
          }
          return null;
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
        async listMessages() {
          return [];
        },
        async listModels() {
          return { data: [{ id: "model-a", name: "Model A" }] };
        },
        async listProviders() {
          return { data: [{ id: "provider-a", name: "Provider A" }] };
        },
        async listAgents() {
          return { data: [{ id: "agent-a", name: "Agent A" }] };
        },
      };
    },
  });
  return { backend, calls, sendPromptCalls };
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
        serverPassword: "",
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
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(status === 400 ? "directory is invalid" : "request failed", { status }),
      );
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

  it("sends authorization header when server password is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "sess-1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const backend = createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => ({
        mode: "url",
        baseUrl: "http://opencode.local",
      }),
      resolveServerPassword: async () => "s3cr3t",
    });
    await backend.listSessions({ workspaceRootPath: "/tmp/workspace" });
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.headers.get("Authorization")).toMatch(/^Basic /);
  });

  it("omits authorization header when no server password is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "sess-1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const backend = createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => ({
        mode: "url",
        baseUrl: "http://opencode.local",
      }),
      resolveServerPassword: async () => "",
    });
    await backend.listSessions({ workspaceRootPath: "/tmp/workspace" });
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.headers.get("Authorization")).toBeNull();
  });

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

  it("sends prompt through canonical session prompt contract", async () => {
    const { backend, sendPromptCalls } = createOpencodeBackendForTests({
      sendPromptResult: { sessionID: "sess-updated" },
    });
    await expect(
      backend.send({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
        prompt: "hello",
        model: "gpt-4.1",
      }),
    ).resolves.toEqual({ sessionId: "sess-updated" });
    expect(sendPromptCalls).toEqual([
      {
        sessionId: "sess-1",
        prompt: "hello",
        model: "gpt-4.1",
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

  it("supports permission and question reply commands", async () => {
    const { backend } = createOpencodeBackendForTests();
    await expect(
      backend.replyPermission({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
        requestId: "perm-1",
        reply: "once",
      }),
    ).resolves.toBeUndefined();
    await expect(
      backend.replyQuestion({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
        requestId: "q-1",
        answers: [["yes"]],
      }),
    ).resolves.toBeUndefined();
    await expect(
      backend.rejectQuestion({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
        requestId: "q-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("supports aborting the active session", async () => {
    const { backend } = createOpencodeBackendForTests();
    await expect(
      backend.abortSession({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("maps reply and abort command errors via backend error rules", async () => {
    const notFoundError = new WorkspaceAgentBackendError({
      code: "notFound",
      status: 404,
      message: "not found",
    });
    const transportError = new WorkspaceAgentBackendError({
      code: "transportError",
      status: 500,
      message: "transport",
    });

    const permissionBackend = createOpencodeBackendForTests({
      replyPermissionError: notFoundError,
    }).backend;
    await expect(
      permissionBackend.replyPermission({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
        requestId: "perm-1",
        reply: "reject",
      }),
    ).rejects.toBe(notFoundError);

    const abortBackend = createOpencodeBackendForTests({
      abortSessionError: transportError,
    }).backend;
    await expect(
      abortBackend.abortSession({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
      }),
    ).rejects.toBe(transportError);
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

  it("normalizes tool failure events from SDK", async () => {
    const { backend } = createOpencodeBackendForTests({
      streamEvents: [
        {
          type: "session.next.tool.called",
          data: { tool: "write_file", callID: "call-err", input: { path: "/readonly" } },
        },
        {
          type: "session.next.tool.failed",
          data: { tool: "write_file", callID: "call-err", error: "permission denied" },
        },
        { type: "session.status", data: { status: { type: "idle" } } },
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
        type: "tool.started",
        toolName: "write_file",
        callId: "call-err",
        input: { path: "/readonly" },
      },
      {
        type: "tool.completed",
        toolName: "write_file",
        callId: "call-err",
        output: "permission denied",
        isError: true,
      },
      { type: "run.completed" },
    ]);
  });

  it("normalizes message.completed from text.ended SDK event", async () => {
    const { backend } = createOpencodeBackendForTests({
      streamEvents: [
        { type: "session.next.text.delta", data: { delta: "Hello " } },
        { type: "session.next.text.ended", data: { text: "Hello world" } },
        { type: "session.status", data: { status: { type: "idle" } } },
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
      { type: "message.delta", delta: "Hello " },
      { type: "message.completed", message: "Hello world" },
      { type: "run.completed" },
    ]);
  });

  it("skips malformed frames with missing type", async () => {
    const { backend } = createOpencodeBackendForTests({
      streamEvents: [
        { data: { delta: "orphan" } },
        { type: "session.next.text.delta", data: { delta: "valid" } },
        { type: "session.status", data: { status: { type: "idle" } } },
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
      { type: "message.delta", delta: "valid" },
      { type: "run.completed" },
    ]);
  });

  it("skips delta events with empty delta strings", async () => {
    const { backend } = createOpencodeBackendForTests({
      streamEvents: [
        { type: "session.next.text.delta", data: { delta: "" } },
        { type: "session.next.text.delta", data: { delta: "real content" } },
        { type: "session.next.text.delta", data: {} },
        { type: "session.status", data: { status: { type: "idle" } } },
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
      { type: "message.delta", delta: "real content" },
      { type: "run.completed" },
    ]);
  });

  it("handles multiple concurrent tool calls with interleaved dedup", async () => {
    const { backend } = createOpencodeBackendForTests({
      streamEvents: [
        {
          id: "e1",
          type: "session.next.tool.called",
          data: { tool: "read_file", callID: "c1", input: { path: "a" } },
        },
        {
          id: "e2",
          type: "session.next.tool.called",
          data: { tool: "read_file", callID: "c2", input: { path: "b" } },
        },
        {
          id: "e1",
          type: "session.next.tool.called",
          data: { tool: "read_file", callID: "c1", input: { path: "a" } },
        },
        {
          id: "e3",
          type: "session.next.tool.success",
          data: { tool: "read_file", callID: "c1", result: "a-content" },
        },
        {
          id: "e4",
          type: "session.next.tool.success",
          data: { tool: "read_file", callID: "c2", result: "b-content" },
        },
        { type: "session.status", data: { status: { type: "idle" } } },
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
        type: "tool.started",
        toolName: "read_file",
        callId: "c1",
        input: { path: "a" },
      },
      {
        type: "tool.started",
        toolName: "read_file",
        callId: "c2",
        input: { path: "b" },
      },
      {
        type: "tool.completed",
        toolName: "read_file",
        callId: "c1",
        output: "a-content",
        isError: false,
      },
      {
        type: "tool.completed",
        toolName: "read_file",
        callId: "c2",
        output: "b-content",
        isError: false,
      },
      { type: "run.completed" },
    ]);
  });

  describe("reasoning / subtask / step normalization", () => {
    it("maps reasoning.delta and reasoning.ended events", async () => {
      const { backend } = createOpencodeBackendForTests({
        streamEvents: [
          {
            type: "session.next.reasoning.delta",
            data: { reasoningID: "r-1", delta: "Let me think " },
          },
          {
            type: "session.next.reasoning.delta",
            data: { reasoningID: "r-1", delta: "about this." },
          },
          {
            type: "session.next.reasoning.ended",
            data: { reasoningID: "r-1", text: "Let me think about this." },
          },
          { type: "session.status", data: { status: { type: "idle" } } },
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
        { type: "reasoning.delta", reasoningId: "r-1", delta: "Let me think " },
        { type: "reasoning.delta", reasoningId: "r-1", delta: "about this." },
        { type: "reasoning.ended", reasoningId: "r-1", text: "Let me think about this." },
        { type: "run.completed" },
      ]);
    });

    it("skips reasoning deltas with empty delta strings", async () => {
      const { backend } = createOpencodeBackendForTests({
        streamEvents: [
          { type: "session.next.reasoning.delta", data: { reasoningID: "r-1", delta: "" } },
          { type: "session.next.reasoning.delta", data: { reasoningID: "r-1", delta: "valid" } },
          { type: "session.status", data: { status: { type: "idle" } } },
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
        { type: "reasoning.delta", reasoningId: "r-1", delta: "valid" },
        { type: "run.completed" },
      ]);
    });

    it("maps step.started event with model info", async () => {
      const { backend } = createOpencodeBackendForTests({
        streamEvents: [
          {
            type: "session.next.step.started",
            data: {
              assistantMessageID: "msg-1",
              agent: "build",
              model: { id: "claude-4", providerID: "anthropic" },
            },
          },
          { type: "session.status", data: { status: { type: "idle" } } },
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
          type: "step.started",
          stepId: "msg-1",
          agent: "build",
          modelId: "claude-4",
          providerId: "anthropic",
        },
        { type: "run.completed" },
      ]);
    });

    it("maps step.ended event with cost and token payload", async () => {
      const { backend } = createOpencodeBackendForTests({
        streamEvents: [
          {
            type: "session.next.step.ended",
            data: {
              assistantMessageID: "msg-1",
              finish: "stop",
              cost: 0.051,
              tokens: {
                input: 1200,
                output: 300,
                reasoning: 80,
                cache: { read: 200, write: 50 },
              },
            },
          },
          { type: "session.status", data: { status: { type: "idle" } } },
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
          type: "step.finished",
          stepId: "msg-1",
          reason: "stop",
          cost: 0.051,
          tokens: {
            input: 1200,
            output: 300,
            reasoning: 80,
            cache: { read: 200, write: 50 },
          },
        },
        { type: "run.completed" },
      ]);
    });

    it("maps step.failed event with error message", async () => {
      const { backend } = createOpencodeBackendForTests({
        streamEvents: [
          {
            type: "session.next.step.failed",
            data: {
              assistantMessageID: "msg-1",
              error: { message: "rate limited" },
            },
          },
          { type: "session.status", data: { status: { type: "idle" } } },
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
        { type: "step.failed", stepId: "msg-1", message: "rate limited" },
        { type: "run.completed" },
      ]);
    });

    it("maps subtask from message.part.updated events", async () => {
      const { backend } = createOpencodeBackendForTests({
        streamEvents: [
          {
            type: "message.part.updated",
            data: {
              part: {
                id: "sub-1",
                type: "subtask",
                agent: "explore",
                description: "Search the codebase",
                prompt: "find all references to X",
              },
            },
          },
          { type: "session.status", data: { status: { type: "idle" } } },
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
          type: "subtask.started",
          subtaskId: "sub-1",
          agent: "explore",
          description: "Search the codebase",
          prompt: "find all references to X",
        },
        { type: "run.completed" },
      ]);
    });

    it("ignores message.part.updated events for non-subtask parts", async () => {
      const { backend } = createOpencodeBackendForTests({
        streamEvents: [
          {
            type: "message.part.updated",
            data: {
              part: { id: "f-1", type: "file", mime: "image/png", url: "file:///x.png" },
            },
          },
          { type: "session.status", data: { status: { type: "idle" } } },
        ],
      });

      const seen: WorkspaceAgentStreamEvent[] = [];
      for await (const event of backend.streamEvents({
        workspaceRootPath: "/tmp/workspace",
        sessionId: "sess-1",
      })) {
        seen.push(event);
      }

      expect(seen).toEqual([{ type: "run.completed" }]);
    });
  });

  describe("catalog listing", () => {
    it("lists models from /api/model", async () => {
      const { backend } = createOpencodeBackendForTests();
      const models = await backend.listModels({ workspaceRootPath: "/tmp/project" });
      expect(models).toEqual([{ id: "model-a", name: "Model A" }]);
    });

    it("lists providers from /api/provider", async () => {
      const { backend } = createOpencodeBackendForTests();
      const providers = await backend.listProviders({ workspaceRootPath: "/tmp/project" });
      expect(providers).toEqual([{ id: "provider-a", name: "Provider A" }]);
    });

    it("lists agents from /api/agent", async () => {
      const { backend } = createOpencodeBackendForTests();
      const agents = await backend.listAgents({ workspaceRootPath: "/tmp/project" });
      expect(agents).toEqual([{ id: "agent-a", name: "Agent A" }]);
    });

    it("handles empty catalog responses", async () => {
      const { backend } = createOpencodeBackendForTests();
      const models = await backend.listModels({ workspaceRootPath: "/tmp/project" });
      expect(models).toEqual([{ id: "model-a", name: "Model A" }]);
    });

    it("keeps cursor-local catalog methods as stubs", async () => {
      const backend = createWorkspaceAgentBackend("cursor-local");
      await expect(backend.listModels({ workspaceRootPath: "/tmp" })).rejects.toThrow(
        "not implemented yet",
      );
      await expect(backend.listProviders({ workspaceRootPath: "/tmp" })).rejects.toThrow(
        "not implemented yet",
      );
      await expect(backend.listAgents({ workspaceRootPath: "/tmp" })).rejects.toThrow(
        "not implemented yet",
      );
    });
  });

  describe("SDK transport", () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    function createSdkFetchBackend(serverPassword?: string) {
      const requests: Request[] = [];
      const fetchMock = vi.fn(async (req: Request) => {
        requests.push(req);
        const url = new URL(req.url);
        let payload: unknown = [{ id: "sess-1", title: "S" }];
        if (req.method === "POST" && url.pathname === "/session") {
          payload = { id: "sess-new", title: "T" };
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
        resolveServerPassword: async () => serverPassword ?? "",
      });
      return { backend, requests };
    }

    it("routes requests through the SDK client and unwraps response data", async () => {
      const { backend } = createSdkFetchBackend();
      const sessions = await backend.listSessions({ workspaceRootPath: "/tmp/proj" });
      expect(sessions).toEqual([
        { id: "sess-1", title: "S", createdAt: null, updatedAt: null },
      ]);
    });

    it("sends the workspace directory via the SDK directory header on POSTs", async () => {
      const { backend, requests } = createSdkFetchBackend();
      await backend.createSession({ workspaceRootPath: "/tmp/proj", title: "T" });
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe("POST");
      expect(requests[0].headers.get("x-opencode-directory")).toBe(
        encodeURIComponent("/tmp/proj"),
      );
    });

    it("maps SDK JSON error bodies using the message field", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: "NotFoundError", message: "session gone" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
      });
      await expect(
        backend.send({
          workspaceRootPath: "/tmp/proj",
          sessionId: "sess-1",
          prompt: "hi",
        }),
      ).rejects.toMatchObject({ code: "notFound", message: "session gone", status: 404 });
    });

    it("maps SDK network failures to serverUnavailable", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      );
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
      });
      await expect(
        backend.listSessions({ workspaceRootPath: "/tmp/proj" }),
      ).rejects.toMatchObject({ code: "serverUnavailable" });
    });

    it("forwards prompted prompts through the SDK prompt API with text parts", async () => {
      const requests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (req: Request) => {
          requests.push(req);
          return new Response(JSON.stringify({ id: "msg-1", sessionID: "sess-1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }),
      );
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
      });
      const result = await backend.send({
        workspaceRootPath: "/tmp/proj",
        sessionId: "sess-1",
        prompt: "hello world",
        model: "claude-3-5-sonnet",
        provider: "anthropic",
      });
      expect(result).toEqual({ sessionId: "sess-1" });
      expect(requests).toHaveLength(1);
      const body = await requests[0].json();
      expect(body.parts).toEqual([{ type: "text", text: "hello world" }]);
      expect(body.model).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" });
    });

    it("does not attach a model object when provider or model is missing", async () => {
      const requests: Request[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (req: Request) => {
          requests.push(req);
          return new Response(JSON.stringify({ id: "msg-1", sessionID: "sess-1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }),
      );
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
      });
      await backend.send({
        workspaceRootPath: "/tmp/proj",
        sessionId: "sess-1",
        prompt: "hi",
      });
      const body = await requests[0].json();
      expect(body.model).toBeUndefined();
    });

    it("normalizes events streamed through the SDK event subscriber", async () => {
      const encoder = new TextEncoder();
      const sseBody = [
        'data: {"type":"session.next.text.delta","data":{"delta":"hi"}}\n\n',
        'data: {"type":"session.status","data":{"status":{"type":"idle"}}}\n\n',
      ].join("");
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode(sseBody));
                  controller.close();
                },
              }),
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
          ),
        ),
      );
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({
          mode: "url",
          baseUrl: "http://opencode.local",
        }),
      });
      const seen: WorkspaceAgentStreamEvent[] = [];
      for await (const event of backend.streamEvents({
        workspaceRootPath: "/tmp/proj",
        sessionId: "sess-1",
      })) {
        seen.push(event);
      }
      expect(seen).toEqual([
        { type: "message.delta", delta: "hi" },
        { type: "run.completed" },
      ]);
    });
  });
});
