import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRemote } from "./types";

vi.mock("./gitService", () => ({ queryRemotes: vi.fn() }));
vi.mock("./gitRepo", () => ({ resolveRepoRoot: vi.fn() }));

import { queryRemotes } from "./gitService";
import { resolveRepoRoot } from "./gitRepo";
import { invalidateRemotesCache, loadRemotes, resetRemotesCacheForTests } from "./versionControlRemotesCache";
import { notifyVersionControlMutation } from "./versionControlRefresh";

const queryRemotesMock = vi.mocked(queryRemotes);
const resolveRepoRootMock = vi.mocked(resolveRepoRoot);

function remotes(name: string): GitRemote[] {
  return [{ name, fetchUrl: `https://example.com/${name}.git`, pushUrl: `https://example.com/${name}.git` }];
}

describe("loadRemotes cache invalidation", () => {
  beforeEach(() => {
    resetRemotesCacheForTests();
    queryRemotesMock.mockReset();
    resolveRepoRootMock.mockReset();
    // Never resolves: proves invalidation does not depend on the async lookup.
    resolveRepoRootMock.mockReturnValue(new Promise(() => {}));
  });

  it("drops the entry synchronously for a subdirectory workspace mutation", async () => {
    queryRemotesMock.mockResolvedValueOnce(remotes("old")).mockResolvedValueOnce(remotes("new"));
    expect(await loadRemotes("/repo")).toEqual(remotes("old"));

    notifyVersionControlMutation("/repo/packages/app", "fetch");
    // Same tick as the notification: the stale entry is already gone.
    expect(await loadRemotes("/repo")).toEqual(remotes("new"));
    expect(queryRemotesMock).toHaveBeenCalledTimes(2);
  });

  it("does not drop entries for unrelated sibling paths", async () => {
    queryRemotesMock.mockResolvedValue(remotes("origin"));
    await loadRemotes("/repo");
    notifyVersionControlMutation("/repo-other", "fetch");
    await loadRemotes("/repo");
    expect(queryRemotesMock).toHaveBeenCalledTimes(1);
  });

  it("keeps cached remotes across stage and working-tree edits", async () => {
    queryRemotesMock.mockResolvedValue(remotes("origin"));
    await loadRemotes("/repo");
    notifyVersionControlMutation("/repo", "stage");
    notifyVersionControlMutation("/repo", "workspace-edit");
    await loadRemotes("/repo");
    expect(queryRemotesMock).toHaveBeenCalledTimes(1);
  });

  it("does not let an in-flight pre-invalidation read repopulate the cache", async () => {
    let finishStale: (value: GitRemote[]) => void = () => {};
    queryRemotesMock
      .mockReturnValueOnce(new Promise<GitRemote[]>((resolve) => { finishStale = resolve; }))
      .mockResolvedValueOnce(remotes("fresh"));

    const stale = loadRemotes("/repo");
    invalidateRemotesCache("/repo");
    finishStale(remotes("stale"));
    expect(await stale).toEqual(remotes("stale"));

    expect(await loadRemotes("/repo")).toEqual(remotes("fresh"));
    expect(queryRemotesMock).toHaveBeenCalledTimes(2);
  });
});
