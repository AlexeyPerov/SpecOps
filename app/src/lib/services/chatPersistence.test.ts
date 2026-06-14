import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import {
  chatScopeStorageSegment,
  decodeChatAgentThreadFileSnapshot,
  decodeWorkspaceAgentsIndexSnapshot,
  deleteAgentPersistence,
  deleteAgentThreadFileSnapshot,
  encodeChatAgentThreadFileSnapshot,
  encodeWorkspaceAgentsIndexSnapshot,
  getAgentThreadFilePath,
  getWorkspaceAgentsDir,
  getWorkspaceAgentsIndexFilePath,
  persistAgentThreadSnapshot,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
  resetChatPersistenceForTests,
  upsertAgentIndexEntry,
  workspaceChatPathHashKey,
  writeAgentThreadFileSnapshot,
  writeWorkspaceAgentsIndexSnapshot,
} from "./chatPersistence";
import type { ChatAgentThreadFileSnapshot, ChatThreadSnapshot } from "../domain/contracts";

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const mkdirMock = vi.mocked(mkdir);
const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);
const removeMock = vi.mocked(remove);

const WORKSPACE = "/work/a";
const AGENT_ID = "agent-1";

function sampleThread(agentId = AGENT_ID): ChatThreadSnapshot {
  return {
    metadata: {
      agentId,
      threadId: agentId,
      mode: "review",
      provider: "http",
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:01.000Z",
      summary: "summary",
    },
    messages: [
      {
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-05-25T00:00:00.000Z",
      },
      {
        id: "m-2",
        role: "system",
        content: "provider changed",
        createdAt: "2026-05-25T00:00:01.000Z",
        systemEvent: {
          type: "provider-switched",
          fromProvider: "http",
          toProvider: "debug-workspace",
        },
      },
    ],
  };
}

describe("workspace agent path mapping", () => {
  beforeEach(() => {
    mkdirMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
  });

  it("maps workspace to a dedicated agents directory", async () => {
    const workspaceDir = await getWorkspaceAgentsDir(WORKSPACE);
    const indexPath = await getWorkspaceAgentsIndexFilePath(WORKSPACE);
    const threadPath = await getAgentThreadFilePath(WORKSPACE, AGENT_ID);

    expect(workspaceDir).toBe("/data/spec-ops/chat/" + workspaceChatPathHashKey(WORKSPACE));
    expect(indexPath).toBe(workspaceDir + "/index.json");
    expect(threadPath).toBe(workspaceDir + "/" + AGENT_ID + ".json");
  });

  it("maps chat-http scope to a literal chat/chat-http/ directory", async () => {
    const chatHttpDir = await getWorkspaceAgentsDir(CHAT_HTTP_CONTEXT_ID);
    const indexPath = await getWorkspaceAgentsIndexFilePath(CHAT_HTTP_CONTEXT_ID);
    const threadPath = await getAgentThreadFilePath(CHAT_HTTP_CONTEXT_ID, AGENT_ID);

    expect(chatScopeStorageSegment(CHAT_HTTP_CONTEXT_ID)).toBe("chat-http");
    expect(chatHttpDir).toBe("/data/spec-ops/chat/chat-http");
    expect(indexPath).toBe("/data/spec-ops/chat/chat-http/index.json");
    expect(threadPath).toBe("/data/spec-ops/chat/chat-http/" + AGENT_ID + ".json");
  });
});

describe("agent thread snapshot codec", () => {
  it("round-trips per-agent thread snapshot", () => {
    const snapshot: ChatAgentThreadFileSnapshot = {
      version: 1,
      thread: sampleThread(),
    };

    const encoded = encodeChatAgentThreadFileSnapshot(snapshot);
    const decoded = decodeChatAgentThreadFileSnapshot(encoded);
    expect(decoded).toEqual(snapshot);
  });

  it("round-trips selectedModelId metadata and model-switched system events", () => {
    const snapshot: ChatAgentThreadFileSnapshot = {
      version: 1,
      thread: {
        ...sampleThread(),
        metadata: {
          ...sampleThread().metadata,
          selectedModelId: "gpt-4o-mini",
        },
        messages: [
          ...sampleThread().messages,
          {
            id: "m-3",
            role: "system",
            content: "model changed",
            createdAt: "2026-05-25T00:00:02.000Z",
            systemEvent: {
              type: "model-switched",
              fromModel: "gpt-4o-mini",
              toModel: "gpt-4.1",
            },
          },
        ],
      },
    };

    const encoded = encodeChatAgentThreadFileSnapshot(snapshot);
    const decoded = decodeChatAgentThreadFileSnapshot(encoded);
    expect(decoded).toEqual(snapshot);
  });

  it("round-trips opencodeAgentId and opencodeProviderId metadata", () => {
    const snapshot: ChatAgentThreadFileSnapshot = {
      version: 1,
      thread: {
        ...sampleThread(),
        metadata: {
          ...sampleThread().metadata,
          opencodeAgentId: "build",
          opencodeProviderId: "anthropic",
        },
      },
    };

    const encoded = encodeChatAgentThreadFileSnapshot(snapshot);
    const decoded = decodeChatAgentThreadFileSnapshot(encoded);
    expect(decoded).toEqual(snapshot);
  });

  it("decodes legacy snapshots without selectedModelId or model-switched events", () => {
    const legacy = encodeChatAgentThreadFileSnapshot({
      version: 1,
      thread: sampleThread(),
    });

    const decoded = decodeChatAgentThreadFileSnapshot(legacy);
    expect(decoded?.thread.metadata.selectedModelId).toBeUndefined();
    expect(decoded?.thread.messages.every((message) => message.systemEvent?.type !== "model-switched")).toBe(
      true,
    );
  });

  it('normalizes legacy provider "glm" to "http" on decode', () => {
    const rawLegacySnapshot = JSON.stringify({
      version: 1,
      thread: {
        metadata: {
          agentId: AGENT_ID,
          threadId: AGENT_ID,
          mode: "ask",
          provider: "glm",
          createdAt: "2026-05-25T00:00:00.000Z",
          updatedAt: "2026-05-25T00:00:01.000Z",
        },
        messages: [
          {
            id: "m-1",
            role: "user",
            content: "hello",
            createdAt: "2026-05-25T00:00:00.000Z",
          },
        ],
      },
    });

    const decoded = decodeChatAgentThreadFileSnapshot(rawLegacySnapshot);
    expect(decoded?.thread.metadata.provider).toBe("http");
  });

  it("preserves provider-switched events when model-switched events are present", () => {
    const snapshot: ChatAgentThreadFileSnapshot = {
      version: 1,
      thread: {
        ...sampleThread(),
        messages: [
          sampleThread().messages[1],
          {
            id: "m-3",
            role: "system",
            content: "model changed",
            createdAt: "2026-05-25T00:00:02.000Z",
            systemEvent: {
              type: "model-switched",
              fromModel: null,
              toModel: "gpt-4o-mini",
            },
          },
        ],
      },
    };

    const decoded = decodeChatAgentThreadFileSnapshot(encodeChatAgentThreadFileSnapshot(snapshot));
    expect(decoded?.thread.messages[0]?.systemEvent).toEqual({
      type: "provider-switched",
      fromProvider: "http",
      toProvider: "debug-workspace",
    });
    expect(decoded?.thread.messages[1]?.systemEvent).toEqual({
      type: "model-switched",
      fromModel: null,
      toModel: "gpt-4o-mini",
    });
  });

  it("rejects legacy single-thread envelopes", () => {
    const legacy = JSON.stringify({ version: 1, thread: null });
    expect(decodeChatAgentThreadFileSnapshot(legacy)).toBeNull();
  });
});

describe("workspace agents index codec", () => {
  it("round-trips agent index snapshot", () => {
    const snapshot = {
      version: 1 as const,
      agents: [
        {
          id: AGENT_ID,
          title: "hello",
          lastUsedAt: "2026-05-25T00:00:01.000Z",
          opencodeSessionId: "sess-1",
          opencodeModelId: "gpt-4o-mini",
          opencodeProviderId: "opencode",
        },
      ],
    };

    const encoded = encodeWorkspaceAgentsIndexSnapshot(snapshot);
    expect(decodeWorkspaceAgentsIndexSnapshot(encoded)).toEqual(snapshot);
  });

  it("drops invalid opencode mapping metadata from corrupted entries", () => {
    const raw = JSON.stringify({
      version: 1,
      agents: [
        {
          id: AGENT_ID,
          title: "hello",
          lastUsedAt: "2026-05-25T00:00:01.000Z",
          opencodeSessionId: 123,
        },
      ],
    });
    expect(decodeWorkspaceAgentsIndexSnapshot(raw)).toEqual({ version: 1, agents: [] });
  });

  it("upserts index entries by agent id", () => {
    const initial = {
      version: 1 as const,
      agents: [{ id: "a-1", title: "One", lastUsedAt: "2026-05-25T00:00:00.000Z" }],
    };

    const next = upsertAgentIndexEntry(initial, {
      id: "a-2",
      title: "Two",
      lastUsedAt: "2026-05-26T00:00:00.000Z",
    });
    expect(next.agents.map((entry) => entry.id)).toEqual(["a-1", "a-2"]);

    const updated = upsertAgentIndexEntry(next, {
      id: "a-1",
      title: "One updated",
      lastUsedAt: "2026-05-27T00:00:00.000Z",
    });
    expect(updated.agents).toEqual([
      { id: "a-2", title: "Two", lastUsedAt: "2026-05-26T00:00:00.000Z" },
      { id: "a-1", title: "One updated", lastUsedAt: "2026-05-27T00:00:00.000Z" },
    ]);
  });
});

describe("agent persistence reads and writes", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    removeMock.mockReset();
    mkdirMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
    writeTextFileMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
    resetChatPersistenceForTests();
  });

  it("returns null when agent thread file is missing (draft agents)", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(readAgentThreadFileSnapshot(WORKSPACE, AGENT_ID)).resolves.toBeNull();
  });

  it("returns empty index when index file is corrupt", async () => {
    readTextFileMock.mockResolvedValue("{ broken json");
    await expect(readWorkspaceAgentsIndexSnapshot(WORKSPACE)).resolves.toEqual({
      version: 1,
      agents: [],
    });
  });

  it("writes per-agent thread and index entry together", async () => {
    readTextFileMock.mockResolvedValue(
      encodeWorkspaceAgentsIndexSnapshot({ version: 1, agents: [] }),
    );

    const thread = sampleThread();
    await persistAgentThreadSnapshot(WORKSPACE, AGENT_ID, thread);

    expect(writeTextFileMock).toHaveBeenCalledTimes(2);
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/chat/" + workspaceChatPathHashKey(WORKSPACE) + "/index.json",
      encodeWorkspaceAgentsIndexSnapshot({
        version: 1,
        agents: [
          {
            id: AGENT_ID,
            title: "hello",
            lastUsedAt: thread.metadata.updatedAt,
          },
        ],
      }),
    );
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/chat/" + workspaceChatPathHashKey(WORKSPACE) + "/" + AGENT_ID + ".json",
      encodeChatAgentThreadFileSnapshot({ version: 1, thread }),
    );
  });

  it("does not create a thread file when only index is written", async () => {
    await writeWorkspaceAgentsIndexSnapshot(WORKSPACE, {
      version: 1,
      agents: [{ id: AGENT_ID, title: "New agent", lastUsedAt: "2026-05-28T00:00:00.000Z", isDraft: true }],
    });

    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/chat/" + workspaceChatPathHashKey(WORKSPACE) + "/index.json",
      expect.stringContaining("New agent"),
    );
  });

  it("deletes agent thread file and index entry", async () => {
    readTextFileMock.mockResolvedValue(
      encodeWorkspaceAgentsIndexSnapshot({
        version: 1,
        agents: [{ id: AGENT_ID, title: "hello", lastUsedAt: "2026-05-25T00:00:01.000Z" }],
      }),
    );

    await deleteAgentPersistence(WORKSPACE, AGENT_ID);

    expect(removeMock).toHaveBeenCalledWith(
      "/data/spec-ops/chat/" + workspaceChatPathHashKey(WORKSPACE) + "/" + AGENT_ID + ".json",
    );
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/chat/" + workspaceChatPathHashKey(WORKSPACE) + "/index.json",
      encodeWorkspaceAgentsIndexSnapshot({ version: 1, agents: [] }),
    );
  });

  it("deleteAgentThreadFileSnapshot tolerates missing files", async () => {
    removeMock.mockRejectedValue(new Error("missing"));
    await expect(deleteAgentThreadFileSnapshot(WORKSPACE, AGENT_ID)).resolves.toBeUndefined();
  });

  it("writes agent thread file without touching index when requested directly", async () => {
    const thread = sampleThread();
    await writeAgentThreadFileSnapshot(WORKSPACE, AGENT_ID, { version: 1, thread });

    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/chat/" + workspaceChatPathHashKey(WORKSPACE) + "/" + AGENT_ID + ".json",
      encodeChatAgentThreadFileSnapshot({ version: 1, thread }),
    );
  });
});
