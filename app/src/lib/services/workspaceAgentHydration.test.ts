import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIndexEntry } from "../domain/contracts";
import { WorkspaceAgentBackendError } from "../ai/backends/workspaceAgentBackend";

const mocks = vi.hoisted(() => ({
  setThreadMessages: vi.fn(),
}));

vi.mock("../state/chatStore", () => ({
  chatStore: {
    setThreadMessages: mocks.setThreadMessages,
  },
}));

const { hydrateWorkspaceAgentMessages } = await import("./workspaceAgentHydration");

function makeAgent(input: { id: string; opencodeSessionId?: string }): AgentIndexEntry {
  return {
    id: input.id,
    title: input.id,
    lastUsedAt: "2026-06-15T00:00:00.000Z",
    ...(input.opencodeSessionId ? { opencodeSessionId: input.opencodeSessionId } : {}),
  };
}

function makeBackend(listMessagesImpl: (sessionId: string) => Promise<unknown[]>) {
  return {
    listMessages: vi.fn(async ({ sessionId }: { workspaceRootPath: string; sessionId: string }) =>
      listMessagesImpl(sessionId),
    ),
  };
}

describe("hydrateWorkspaceAgentMessages", () => {
  beforeEach(() => {
    mocks.setThreadMessages.mockReset();
  });

  it("fetches messages for each agent with a linked session and replaces thread contents", async () => {
    const backend = makeBackend(async (sessionId) => {
      if (sessionId === "sess-a") {
        return [
          {
            info: { id: "u1", role: "user", time: { created: 1 } },
            parts: [{ type: "text", text: "hi" }],
          },
        ];
      }
      return [];
    });
    const agents = [
      makeAgent({ id: "agent-a", opencodeSessionId: "sess-a" }),
      makeAgent({ id: "agent-b", opencodeSessionId: "sess-b" }),
      makeAgent({ id: "agent-c" }), // no session link — skipped
    ];

    await hydrateWorkspaceAgentMessages({
      backend: backend as never,
      workspaceRootPath: "/repo",
      agents,
    });

    expect(backend.listMessages).toHaveBeenCalledTimes(2);
    expect(mocks.setThreadMessages).toHaveBeenCalledTimes(1);
    const [messages, agentId, root] = mocks.setThreadMessages.mock.calls[0];
    expect(agentId).toBe("agent-a");
    expect(root).toBe("/repo");
    expect(messages).toEqual([
      {
        id: "u1",
        role: "user",
        content: "hi",
        createdAt: new Date(1).toISOString(),
        parts: [{ type: "text", text: "hi" }],
      },
    ]);
  });

  it("skips setThreadMessages when session.messages returns an empty list", async () => {
    const backend = makeBackend(async () => []);
    const agents = [makeAgent({ id: "agent-a", opencodeSessionId: "sess-a" })];

    await hydrateWorkspaceAgentMessages({
      backend: backend as never,
      workspaceRootPath: "/repo",
      agents,
    });

    expect(backend.listMessages).toHaveBeenCalledTimes(1);
    expect(mocks.setThreadMessages).not.toHaveBeenCalled();
  });

  it("keeps the local snapshot when backend returns serverUnavailable (non-fatal)", async () => {
    const backend = {
      listMessages: vi.fn(async () => {
        throw new WorkspaceAgentBackendError({
          code: "serverUnavailable",
          message: "offline",
        });
      }),
    };
    const agents = [makeAgent({ id: "agent-a", opencodeSessionId: "sess-a" })];

    await expect(
      hydrateWorkspaceAgentMessages({
        backend: backend as never,
        workspaceRootPath: "/repo",
        agents,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.setThreadMessages).not.toHaveBeenCalled();
  });

  it("treats notFound as non-fatal (session deleted concurrently)", async () => {
    const backend = {
      listMessages: vi.fn(async () => {
        throw new WorkspaceAgentBackendError({
          code: "notFound",
          message: "session gone",
        });
      }),
    };
    const agents = [makeAgent({ id: "agent-a", opencodeSessionId: "sess-a" })];

    await expect(
      hydrateWorkspaceAgentMessages({
        backend: backend as never,
        workspaceRootPath: "/repo",
        agents,
      }),
    ).resolves.toBeUndefined();
    expect(mocks.setThreadMessages).not.toHaveBeenCalled();
  });

  it("rethrows unexpected errors", async () => {
    const backend = {
      listMessages: vi.fn(async () => {
        throw new Error("unexpected boom");
      }),
    };
    const agents = [makeAgent({ id: "agent-a", opencodeSessionId: "sess-a" })];

    await expect(
      hydrateWorkspaceAgentMessages({
        backend: backend as never,
        workspaceRootPath: "/repo",
        agents,
      }),
    ).rejects.toThrow("unexpected boom");
  });

  it("drops malformed entries rather than failing the whole hydration", async () => {
    const backend = makeBackend(async () => [
      null,
      { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [] },
      { info: null, parts: [] },
    ]);
    const agents = [makeAgent({ id: "agent-a", opencodeSessionId: "sess-a" })];

    await hydrateWorkspaceAgentMessages({
      backend: backend as never,
      workspaceRootPath: "/repo",
      agents,
    });

    const [messages] = mocks.setThreadMessages.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("u1");
  });
});
