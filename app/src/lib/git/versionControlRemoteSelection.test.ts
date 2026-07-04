import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { GitRemote } from "./types";
import {
  emptyRemoteSelection,
  parsePersistedRemoteSelection,
  parsePersistedRemoteSelectionSnapshot,
  readPersistedRemoteSelection,
  reconcileRemoteSelection,
  remoteOperationTarget,
  resolveDefaultRemoteName,
  serializeRemoteSelection,
  writePersistedRemoteSelection,
} from "./versionControlRemoteSelection";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../services/appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);

const origin: GitRemote = {
  name: "origin",
  fetchUrl: "https://example.com/origin.git",
  pushUrl: "https://example.com/origin.git",
};

const upstream: GitRemote = {
  name: "upstream",
  fetchUrl: "https://example.com/upstream.git",
  pushUrl: "https://example.com/upstream.git",
};

describe("resolveDefaultRemoteName", () => {
  it("prefers origin over other remotes", () => {
    expect(resolveDefaultRemoteName([upstream, origin])).toBe("origin");
  });

  it("falls back to the first remote when origin is missing", () => {
    expect(resolveDefaultRemoteName([upstream])).toBe("upstream");
  });

  it("returns null when no remotes exist", () => {
    expect(resolveDefaultRemoteName([])).toBeNull();
  });
});

describe("reconcileRemoteSelection", () => {
  it("restores a persisted remote when it still exists", () => {
    expect(
      reconcileRemoteSelection({ remoteName: "upstream", remoteBranch: "main" }, [
        origin,
        upstream,
      ]),
    ).toEqual({
      remoteName: "upstream",
      remoteBranch: "main",
    });
  });

  it("falls back when the stored remote was removed", () => {
    expect(
      reconcileRemoteSelection({ remoteName: "gone", remoteBranch: "dev" }, [origin, upstream]),
    ).toEqual({
      remoteName: "origin",
      remoteBranch: null,
    });
  });

  it("defaults to origin when nothing is stored", () => {
    expect(reconcileRemoteSelection(null, [upstream, origin])).toEqual({
      remoteName: "origin",
      remoteBranch: null,
    });
  });

  it("returns empty selection when no remotes exist", () => {
    expect(reconcileRemoteSelection({ remoteName: "origin", remoteBranch: null }, [])).toEqual(
      emptyRemoteSelection(),
    );
  });
});

describe("remoteOperationTarget", () => {
  it("returns undefined when no remotes are configured", () => {
    expect(remoteOperationTarget({ remoteName: "origin", remoteBranch: null }, [])).toBeUndefined();
  });

  it("returns the reconciled remote when valid", () => {
    expect(
      remoteOperationTarget({ remoteName: "upstream", remoteBranch: "main" }, [origin, upstream]),
    ).toEqual({
      remoteName: "upstream",
      remoteBranch: "main",
    });
  });
});

describe("serializeRemoteSelection", () => {
  it("trims and drops empty strings", () => {
    expect(
      serializeRemoteSelection({ remoteName: " origin ", remoteBranch: "   " }),
    ).toEqual({
      remoteName: "origin",
      remoteBranch: null,
    });
  });
});

describe("parsePersistedRemoteSelection", () => {
  it("parses valid persisted rows", () => {
    expect(parsePersistedRemoteSelection({ remoteName: "origin", remoteBranch: "main" })).toEqual({
      remoteName: "origin",
      remoteBranch: "main",
    });
  });

  it("returns null for invalid payloads", () => {
    expect(parsePersistedRemoteSelection(null)).toBeNull();
    expect(parsePersistedRemoteSelection("origin")).toBeNull();
  });
});

describe("remote selection persistence", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("returns null when the prefs file is missing", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(readPersistedRemoteSelection("/tmp/repo")).resolves.toBeNull();
  });

  it("writes and reads selection keyed by normalized repo root", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await writePersistedRemoteSelection("/tmp/repo/", {
      remoteName: "origin",
      remoteBranch: null,
    });

    const [, content] = writeTextFileMock.mock.calls[0];
    const snapshot = parsePersistedRemoteSelectionSnapshot(content as string);
    expect(snapshot?.byRepo["/tmp/repo"]).toEqual({
      remoteName: "origin",
      remoteBranch: null,
    });

    readTextFileMock.mockResolvedValue(content as string);
    await expect(readPersistedRemoteSelection("/tmp/repo")).resolves.toEqual({
      remoteName: "origin",
      remoteBranch: null,
    });
  });

  it("removes repo entry when selection is cleared", async () => {
    const existing = {
      version: 1,
      updatedAt: "2026-07-04T00:00:00.000Z",
      byRepo: {
        "/tmp/repo": { remoteName: "origin", remoteBranch: null },
      },
    };
    readTextFileMock.mockResolvedValue(JSON.stringify(existing));

    await writePersistedRemoteSelection("/tmp/repo", emptyRemoteSelection());

    const [, content] = writeTextFileMock.mock.calls[0];
    const snapshot = parsePersistedRemoteSelectionSnapshot(content as string);
    expect(snapshot?.byRepo["/tmp/repo"]).toBeUndefined();
  });
});
