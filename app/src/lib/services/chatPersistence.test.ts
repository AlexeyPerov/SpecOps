import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import {
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
      provider: "glm",
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
          fromProvider: "glm",
          toProvider: "cursor",
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
        },
      ],
    };

    const encoded = encodeWorkspaceAgentsIndexSnapshot(snapshot);
    expect(decodeWorkspaceAgentsIndexSnapshot(encoded)).toEqual(snapshot);
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
