import { describe, expect, it } from "vitest";
import {
  WorkspaceAgentBackendError,
  WorkspaceAgentBackendNotImplementedError,
  createWorkspaceAgentBackend,
  type WorkspaceAgentStreamEvent,
} from "./workspaceAgentBackend";

function createOpencodeBackendForTests(params?: {
  mode?: "sidecar" | "url";
  baseUrl?: string;
  createSessionResult?: unknown;
  getSessionResult?: unknown;
  listSessionsResult?: unknown;
  deleteSessionError?: unknown;
  createRunResult?: unknown;
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
        async createRun() {
          return params?.createRunResult ?? {
            runId: "run-1",
          };
        },
        async *streamRunEvents() {
          const events = params?.streamEvents ?? [
            { type: "messageDelta", content: "Hello" },
            { type: "tool.call.started", toolName: "read_file", callId: "call-1", input: { path: "a" } },
            {
              type: "tool.call.completed",
              toolName: "read_file",
              callId: "call-1",
              output: { ok: true },
              isError: false,
            },
            { type: "runComplete", runId: "run-1" },
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

  it("normalizes stream events without exposing raw SDK shapes", async () => {
    const { backend } = createOpencodeBackendForTests();
    const seen: WorkspaceAgentStreamEvent[] = [];
    for await (const event of backend.streamEvents({
      workspaceRootPath: "/tmp/workspace",
      sessionId: "sess-1",
      runId: "run-1",
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
        runId: "run-1",
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
});
