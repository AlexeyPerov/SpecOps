import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  decodeChatThreadFileSnapshot,
  encodeChatThreadFileSnapshot,
  getWorkspaceChatFilePath,
  readWorkspaceChatFileSnapshot,
  workspaceChatPathHashKey,
} from "./chatPersistence";
import type { ChatThreadFileSnapshot } from "../domain/contracts";

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
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

describe("workspace chat file path mapping", () => {
  beforeEach(() => {
    mkdirMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
  });

  it("maps different workspace paths to different files", async () => {
    const a = await getWorkspaceChatFilePath("/work/a");
    const b = await getWorkspaceChatFilePath("/work/b");

    expect(a).not.toBe(b);
    expect(a).toBe("/data/spec-ops/chat/" + workspaceChatPathHashKey("/work/a") + ".json");
    expect(b).toBe("/data/spec-ops/chat/" + workspaceChatPathHashKey("/work/b") + ".json");
  });
});

describe("chat snapshot codec", () => {
  it("round-trips thread snapshot", () => {
    const snapshot: ChatThreadFileSnapshot = {
      version: 1,
      thread: {
        metadata: {
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
      },
    };

    const encoded = encodeChatThreadFileSnapshot(snapshot);
    const decoded = decodeChatThreadFileSnapshot(encoded);
    expect(decoded).toEqual(snapshot);
  });
});

describe("chat snapshot file reads", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    mkdirMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("returns empty snapshot when chat file is corrupt", async () => {
    readTextFileMock.mockResolvedValue("{ broken json");
    await expect(readWorkspaceChatFileSnapshot("/work/a")).resolves.toEqual({
      version: 1,
      thread: null,
    });
  });
});
