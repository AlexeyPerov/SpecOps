import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import GitLogPopover from "./GitLogPopover.svelte";
import { loadPathGitLog } from "../services/pathGitLog";
import type { CommitSummary } from "../git/types";

vi.mock("../services/pathGitLog", () => ({
  PATH_GIT_LOG_PAGE_SIZE: 2,
  loadPathGitLog: vi.fn(),
  workspaceRootForPath: vi.fn(() => "/repo"),
}));

const commit = (i: number): CommitSummary => ({
  sha: i.toString(16).padStart(40, "0"),
  parents: [],
  refs: [],
  subject: `Commit ${i}`,
  authorName: "Test Author",
  authorEmail: "author@example.test",
  authorTime: 1700000000,
  committerName: "Test Author",
  committerEmail: "author@example.test",
  committerTime: 1700000000,
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    flushSync();
  }
}

beforeEach(() => {
  vi.mocked(loadPathGitLog).mockReset();
});

describe("GitLogPopover", () => {
  it("skips commits already shown when a later page overlaps", async () => {
    vi.mocked(loadPathGitLog)
      .mockResolvedValueOnce({ kind: "commits", repoRoot: "/repo", commits: [commit(1), commit(2)], hasMore: true })
      .mockResolvedValueOnce({ kind: "commits", repoRoot: "/repo", commits: [commit(2), commit(3)], hasMore: false });
    const host = document.createElement("div");
    document.body.append(host);
    const popover = mount(GitLogPopover, { target: host, props: {} }) as unknown as {
      openGitLog: (event: MouseEvent, target: { path: string; isFile: boolean; label: string }) => void;
    };
    popover.openGitLog(new MouseEvent("contextmenu", { clientX: 10, clientY: 10 }), {
      path: "/repo/file.md",
      isFile: true,
      label: "file.md",
    });
    await settle();
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Load more")!
      .click();
    await settle();
    const subjects = Array.from(host.querySelectorAll(".git-log-popover-subject")).map((s) => s.textContent);
    expect(subjects).toEqual(["Commit 1", "Commit 2", "Commit 3"]);
    unmount(popover);
    host.remove();
  });
});
