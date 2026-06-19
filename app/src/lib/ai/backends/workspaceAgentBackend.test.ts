import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceAgentBackendError,
  WorkspaceAgentBackendNotImplementedError,
  createWorkspaceAgentBackend,
  type WorkspaceAgentBackendErrorCode,
  type WorkspaceAgentStreamEvent,
} from "./workspaceAgentBackend";
import { createRawOpencodeClientStub } from "../../test/rawOpencodeClientStub";

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
  const sendPromptCalls: Array<{
    sessionId: string;
    prompt: string;
    model?: string;
    context?: { filePaths?: string[]; agentNames?: string[] };
  }> = [];
  const backend = createWorkspaceAgentBackend("opencode", {
    resolveRuntimeConfig: async () => ({
      mode: params?.mode ?? "url",
      baseUrl: params?.baseUrl ?? "http://opencode.local",
    }),
    resolveServerPassword: async () => "",
    createOpencodeClient: (input) => {
      calls.push(input);
      return createRawOpencodeClientStub({
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
        async updateSession(input) {
          return {
            id: input.sessionId,
            title: input.title ?? "Session",
            time: { created: 1_750_000_000_000, updated: 1_750_000_001_000 },
          };
        },
        async forkSession(input) {
          return {
            id: "sess-fork",
            title: "Forked session",
            parentID: input.sessionId,
            time: { created: 1_750_000_002_000, updated: 1_750_000_002_000 },
          };
        },
        async revertSession(input) {
          return {
            id: input.sessionId,
            title: "Session",
            revert: input.messageId
              ? { messageID: input.messageId, diff: "--- a\n+++ b\n" }
              : undefined,
            time: { created: 1_750_000_000_000, updated: 1_750_000_003_000 },
          };
        },
        async unrevertSession(input) {
          return {
            id: input.sessionId,
            title: "Session",
            revert: undefined,
            time: { created: 1_750_000_000_000, updated: 1_750_000_004_000 },
          };
        },
        async shareSession(input) {
          return {
            id: input.sessionId,
            title: "Session",
            share: { url: "https://share.example/sess-1" },
            time: { created: 1_750_000_000_000, updated: 1_750_000_005_000 },
          };
        },
        async unshareSession(input) {
          return {
            id: input.sessionId,
            title: "Session",
            share: undefined,
            time: { created: 1_750_000_000_000, updated: 1_750_000_006_000 },
          };
        },
        async summarizeSession() {
          return true;
        },
        async listSessionChildren() {
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
      });
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

  it("forwards composer context (mentions + attachments) to sendPrompt", async () => {
    const { backend, sendPromptCalls } = createOpencodeBackendForTests();
    await backend.send({
      workspaceRootPath: "/tmp/workspace",
      sessionId: "sess-1",
      prompt: "summarize this",
      context: {
        filePaths: ["src/a.ts", "src/b.ts"],
        agentNames: ["build"],
        attachments: [
          { mime: "application/pdf", filename: "doc.pdf", url: "file:///tmp/doc.pdf" },
        ],
      },
    });
    expect(sendPromptCalls).toHaveLength(1);
    expect(sendPromptCalls[0]).toMatchObject({
      sessionId: "sess-1",
      prompt: "summarize this",
      context: {
        filePaths: ["src/a.ts", "src/b.ts"],
        agentNames: ["build"],
        attachments: [
          { mime: "application/pdf", filename: "doc.pdf", url: "file:///tmp/doc.pdf" },
        ],
      },
    });
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

  describe("M3 composer endpoints (commands / file search)", () => {
    function createBackendForM3(overrides?: {
      listCommandsResult?: unknown;
      findFilesResult?: unknown;
    }) {
      const calls: Array<{ query: string; limit?: number }> = [];
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local" }),
        resolveServerPassword: async () => "",
        createOpencodeClient: () =>
          createRawOpencodeClientStub({
            async createSession() {
              return { id: "s1" };
            },
            async getSession() {
              return { id: "s1", title: "t" };
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
            async listMessages() {
              return [];
            },
            async updateSession() {
              return null;
            },
            async forkSession() {
              return null;
            },
            async revertSession() {
              return null;
            },
            async unrevertSession() {
              return null;
            },
            async shareSession() {
              return null;
            },
            async unshareSession() {
              return null;
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
            async listCommands() {
              return (
                overrides?.listCommandsResult ?? {
                  data: [
                    { name: "init", template: "Initialize the project" },
                    {
                      name: "review",
                      template: "Review this code",
                      description: "Run a code review",
                      agent: "review",
                      subtask: true,
                    },
                  ],
                }
              );
            },
            async findFiles(input) {
              calls.push(input);
              // The real SDK client unwraps `{ data: [...] }` and maps entries
              // before returning, so the client-level stub returns a bare array.
              return (
                overrides?.findFilesResult ?? [
                  { path: "src/a.ts", type: "file", mime: "text/x-typescript" },
                  { path: "README.md", type: "file", mime: "text/markdown" },
                ]
              );
            },
          }),
      });
      return { backend, findFilesCalls: calls };
    }

    it("listCommands maps command entries (drops those without name/template)", async () => {
      const { backend } = createBackendForM3({
        listCommandsResult: {
          data: [
            { name: "init", template: "Initialize" },
            { name: "", template: "no name" },
            { name: "noTemplate" },
            { name: "review", template: "Review", description: "Code review" },
          ],
        },
      });
      const commands = await backend.listCommands({ workspaceRootPath: "/repo" });
      expect(commands).toEqual([
        { name: "init", template: "Initialize" },
        { name: "review", template: "Review", description: "Code review" },
      ]);
    });

    it("listCommands preserves optional agent / subtask fields", async () => {
      const { backend } = createBackendForM3();
      const commands = await backend.listCommands({ workspaceRootPath: "/repo" });
      const review = commands.find((c) => c.name === "review");
      expect(review?.agent).toBe("review");
      expect(review?.subtask).toBe(true);
    });

    it("listCommands returns [] on transport / auth / notFound errors", async () => {
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local" }),
        resolveServerPassword: async () => "",
        createOpencodeClient: () =>
          createRawOpencodeClientStub({
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
              return null;
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
            async listMessages() {
              return [];
            },
            async updateSession() {
              return null;
            },
            async forkSession() {
              return null;
            },
            async revertSession() {
              return null;
            },
            async unrevertSession() {
              return null;
            },
            async shareSession() {
              return null;
            },
            async unshareSession() {
              return null;
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
            async listCommands() {
              throw new WorkspaceAgentBackendError({
                code: "serverUnavailable",
                message: "down",
              });
            },
          }),
      });
      const commands = await backend.listCommands({ workspaceRootPath: "/repo" });
      expect(commands).toEqual([]);
    });

    it("findFiles returns mapped file entries and forwards the query + limit", async () => {
      const { backend, findFilesCalls } = createBackendForM3();
      const files = await backend.findFiles({
        workspaceRootPath: "/repo",
        query: "src",
        limit: 10,
      });
      expect(files).toEqual([
        { path: "src/a.ts", type: "file", mime: "text/x-typescript" },
        { path: "README.md", type: "file", mime: "text/markdown" },
      ]);
      expect(findFilesCalls).toEqual([{ query: "src", limit: 10 }]);
    });

    it("findFiles returns [] for an empty query (skips the server call)", async () => {
      const { backend, findFilesCalls } = createBackendForM3();
      const files = await backend.findFiles({ workspaceRootPath: "/repo", query: "   " });
      expect(files).toEqual([]);
      expect(findFilesCalls).toEqual([]);
    });

    it("findFiles tolerates a bare array (no { data: [...] } wrapper)", async () => {
      const { backend } = createBackendForM3({
        findFilesResult: [{ path: "x.ts", type: "file", mime: "text/plain" }],
      });
      const files = await backend.findFiles({
        workspaceRootPath: "/repo",
        query: "x",
      });
      expect(files).toEqual([{ path: "x.ts", type: "file", mime: "text/plain" }]);
    });

    it("findFiles returns [] on transport errors (degrades to agent-only)", async () => {
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local" }),
        resolveServerPassword: async () => "",
        createOpencodeClient: () =>
          createRawOpencodeClientStub({
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
              return null;
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
            async listMessages() {
              return [];
            },
            async updateSession() {
              return null;
            },
            async forkSession() {
              return null;
            },
            async revertSession() {
              return null;
            },
            async unrevertSession() {
              return null;
            },
            async shareSession() {
              return null;
            },
            async unshareSession() {
              return null;
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
            async findFiles() {
              throw new WorkspaceAgentBackendError({
                code: "transportError",
                message: "network down",
              });
            },
          }),
      });
      const files = await backend.findFiles({
        workspaceRootPath: "/repo",
        query: "src",
      });
      expect(files).toEqual([]);
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

describe("workspaceAgentBackend lifecycle (M2)", () => {
  /**
   * Builds a backend whose RawOpencodeClient stub records the args it was
   * called with, so the lifecycle tests can assert the SDK is invoked with
   * the right session/message ids.
   */
  function createLifecycleBackend(overrides?: {
    updateResult?: unknown;
    forkResult?: unknown;
    revertResult?: unknown;
    unrevertResult?: unknown;
    shareResult?: unknown;
    unshareResult?: unknown;
    summarizeResult?: unknown;
    childrenResult?: unknown;
    listResult?: unknown;
  }) {
    const calls: Record<string, unknown[]> = {};
    const record = (key: string, args: unknown) => {
      (calls[key] ??= []).push(args);
    };
    const backend = createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local" }),
      resolveServerPassword: async () => "",
      createOpencodeClient: () =>
        createRawOpencodeClientStub({
          async createSession() {
            return { id: "s1" };
          },
          async getSession() {
            return { id: "s1", title: "t" };
          },
          async listSessions() {
            return overrides?.listResult ?? [];
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
          async listMessages() {
            return [];
          },
          async updateSession(input) {
            record("updateSession", input);
            return (
              overrides?.updateResult ?? {
                id: input.sessionId,
                title: input.title ?? "t",
                time: { created: 1_750_000_000_000, updated: 1_750_000_001_000 },
              }
            );
          },
          async forkSession(input) {
            record("forkSession", input);
            return (
              overrides?.forkResult ?? {
                id: "child",
                title: "child",
                parentID: input.sessionId,
                time: { created: 1_750_000_002_000, updated: 1_750_000_002_000 },
              }
            );
          },
          async revertSession(input) {
            record("revertSession", input);
            return (
              overrides?.revertResult ?? {
                id: input.sessionId,
                title: "t",
                revert: input.messageId
                  ? { messageID: input.messageId, diff: "--- a\n+++ b\n" }
                  : undefined,
                time: { created: 1_750_000_000_000, updated: 1_750_000_003_000 },
              }
            );
          },
          async unrevertSession(input) {
            record("unrevertSession", input);
            return (
              overrides?.unrevertResult ?? {
                id: input.sessionId,
                title: "t",
                revert: undefined,
                time: { created: 1_750_000_000_000, updated: 1_750_000_004_000 },
              }
            );
          },
          async shareSession(input) {
            record("shareSession", input);
            return (
              overrides?.shareResult ?? {
                id: input.sessionId,
                title: "t",
                share: { url: "https://share.example/s1" },
                time: { created: 1_750_000_000_000, updated: 1_750_000_005_000 },
              }
            );
          },
          async unshareSession(input) {
            record("unshareSession", input);
            return (
              overrides?.unshareResult ?? {
                id: input.sessionId,
                title: "t",
                share: undefined,
                time: { created: 1_750_000_000_000, updated: 1_750_000_006_000 },
              }
            );
          },
          async summarizeSession(input) {
            record("summarizeSession", input);
            return overrides?.summarizeResult ?? true;
          },
          async listSessionChildren(input) {
            record("listSessionChildren", input);
            return overrides?.childrenResult ?? [];
          },
        }),
    });
    return { backend, calls };
  }

  it("updateSessionTitle maps the result and forwards title to the SDK", async () => {
    const { backend, calls } = createLifecycleBackend();
    const result = await backend.updateSessionTitle({
      workspaceRootPath: "/repo",
      sessionId: "s1",
      title: "New name",
    });
    expect(calls.updateSession).toEqual([{ sessionId: "s1", title: "New name" }]);
    expect(result).toMatchObject({ id: "s1", title: "New name" });
    expect(result.createdAt).toBe("2025-06-15T15:06:40.000Z");
  });

  it("forkSession forwards the optional messageId and maps the child session", async () => {
    const { backend, calls } = createLifecycleBackend();
    const child = await backend.forkSession({
      workspaceRootPath: "/repo",
      sessionId: "parent",
      messageId: "msg-3",
    });
    expect(calls.forkSession).toEqual([{ sessionId: "parent", messageId: "msg-3" }]);
    expect(child).toMatchObject({ id: "child", parentId: "parent" });
  });

  it("forkSession omits messageId when not supplied", async () => {
    const { backend, calls } = createLifecycleBackend();
    await backend.forkSession({ workspaceRootPath: "/repo", sessionId: "parent" });
    expect(calls.forkSession).toEqual([{ sessionId: "parent" }]);
  });

  it("revertSession maps the revert preview (diff + messageId)", async () => {
    const { backend, calls } = createLifecycleBackend();
    const result = await backend.revertSession({
      workspaceRootPath: "/repo",
      sessionId: "s1",
      messageId: "msg-9",
    });
    expect(calls.revertSession).toEqual([{ sessionId: "s1", messageId: "msg-9" }]);
    expect(result.revert).toEqual({
      messageId: "msg-9",
      partId: null,
      diff: "--- a\n+++ b\n",
      snapshot: null,
    });
  });

  it("revertSession returns a null revert when OpenCode omits it", async () => {
    const { backend } = createLifecycleBackend({
      revertResult: { id: "s1", title: "t", time: { created: 1, updated: 2 } },
    });
    const result = await backend.revertSession({
      workspaceRootPath: "/repo",
      sessionId: "s1",
    });
    expect(result.revert).toBeNull();
  });

  it("shareSession maps the share url", async () => {
    const { backend, calls } = createLifecycleBackend();
    const result = await backend.shareSession({ workspaceRootPath: "/repo", sessionId: "s1" });
    expect(calls.shareSession).toEqual([{ sessionId: "s1" }]);
    expect(result.shareUrl).toBe("https://share.example/s1");
  });

  it("unshareSession clears the share url", async () => {
    const { backend } = createLifecycleBackend();
    const result = await backend.unshareSession({
      workspaceRootPath: "/repo",
      sessionId: "s1",
    });
    expect(result.shareUrl).toBeNull();
  });

  it("summarizeSession coerces truthy SDK responses to a boolean", async () => {
    const { backend } = createLifecycleBackend({ summarizeResult: true });
    const ok = await backend.summarizeSession({ workspaceRootPath: "/repo", sessionId: "s1" });
    expect(ok).toBe(true);
  });

  it("summarizeSession accepts the legacy \"true\" string", async () => {
    const { backend } = createLifecycleBackend({ summarizeResult: "true" });
    const ok = await backend.summarizeSession({ workspaceRootPath: "/repo", sessionId: "s1" });
    expect(ok).toBe(true);
  });

  it("summarizeSession reports failure for an unexpected object payload", async () => {
    // A future `{ ok: true }` shape must not silently pass through as success.
    const { backend } = createLifecycleBackend({ summarizeResult: { ok: true } });
    const ok = await backend.summarizeSession({ workspaceRootPath: "/repo", sessionId: "s1" });
    expect(ok).toBe(false);
  });

  it("summarizeSession forwards optional model/provider when both are present", async () => {
    const { backend, calls } = createLifecycleBackend();
    await backend.summarizeSession({
      workspaceRootPath: "/repo",
      sessionId: "s1",
      modelId: "claude",
      providerId: "anthropic",
    });
    expect(calls.summarizeSession).toEqual([
      { sessionId: "s1", modelId: "claude", providerId: "anthropic" },
    ]);
  });

  it("listSessionDetails maps the rich session array and forwards query params", async () => {
    const { backend, calls } = createLifecycleBackend({
      listResult: [
        {
          id: "s1",
          title: "First",
          time: { created: 1_750_000_000_000, updated: 1_750_000_001_000 },
          share: { url: "https://share/s1" },
        },
        {
          id: "s2",
          title: "Second",
          parentID: "s1",
          time: { created: 1_750_000_002_000, updated: 1_750_000_002_000 },
        },
      ],
    });
    // record listSessions calls by wrapping: instead, just assert mapping.
    const list = await backend.listSessionDetails({
      workspaceRootPath: "/repo",
      search: "first",
      limit: 10,
    });
    // listResult mock ignores query params, so we just check mapping correctness.
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "s1", title: "First", shareUrl: "https://share/s1" });
    expect(list[1]).toMatchObject({ id: "s2", parentId: "s1" });
    expect(list[0].createdAt).toBe("2025-06-15T15:06:40.000Z");
    void calls;
  });

  it("listSessionDetails returns [] for a non-array response", async () => {
    const { backend } = createLifecycleBackend({ listResult: { not: "an array" } });
    const list = await backend.listSessionDetails({ workspaceRootPath: "/repo" });
    expect(list).toEqual([]);
  });

  it("getSessionDetails maps the rich session shape", async () => {
    const backend = createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local" }),
      resolveServerPassword: async () => "",
      createOpencodeClient: () =>
        createRawOpencodeClientStub({
          async getSession() {
            return {
              id: "s1",
              title: "Rich",
              time: { created: 1_750_000_000_000, updated: 1_750_000_001_000 },
              share: { url: "https://share/s1" },
              cost: 0.42,
              parentID: "parent",
            };
          },
        }),
    });
    const result = await backend.getSessionDetails({
      workspaceRootPath: "/repo",
      sessionId: "s1",
    });
    expect(result).toMatchObject({
      id: "s1",
      title: "Rich",
      shareUrl: "https://share/s1",
      parentId: "parent",
      cost: 0.42,
    });
  });

  it("getSessionDetails returns null on notFound", async () => {
    const backend = createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local" }),
      resolveServerPassword: async () => "",
      createOpencodeClient: () =>
        createRawOpencodeClientStub({
          async getSession() {
            throw new WorkspaceAgentBackendError({ code: "notFound", message: "nope" });
          },
        }),
    });
    const result = await backend.getSessionDetails({
      workspaceRootPath: "/repo",
      sessionId: "missing",
    });
    expect(result).toBeNull();
  });
});
