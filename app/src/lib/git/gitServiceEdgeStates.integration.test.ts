import { beforeEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createTempGitRepo, describeIfGitInstalled, type TempGitRepo } from "./test/gitTempRepoHarness";
import { resetGitCommandQueueForTests } from "./gitCommandQueue";
import { GitStashApplyConflictError, GitStashNotFoundError, GitStashNothingToSaveError } from "./gitErrors";
import { applyStash, createStash, dropStash, queryStashes } from "./gitTagsStash";
import { queryAheadBehind } from "./gitRepo";
import { pushRemote } from "./gitRemotes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (_command: string, { request }: { request: { repoRoot: string; args: string[] } }) => {
    const result = spawnSync("git", request.args, {
      cwd: request.repoRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, durationMs: 1 };
  }),
}));
vi.mock("../services/logging", () => ({ logDiagnostic: vi.fn() }));
vi.mock("./gitIntegrationGating", () => ({
  isGitIntegrationEnabledInApp: vi.fn(() => true),
  shouldRunGitForCallerScope: vi.fn(() => true),
}));

beforeEach(() => resetGitCommandQueueForTests());

function commit(repo: TempGitRepo, file: string, text: string): void {
  repo.writeFile(file, text);
  repo.run(["add", file]);
  repo.run(["commit", "-q", "-m", text]);
}

async function withRepo(run: (repo: TempGitRepo) => Promise<void>): Promise<void> {
  const repo = createTempGitRepo();
  try {
    repo.run(["checkout", "-q", "-B", "main"]);
    commit(repo, "f.txt", "base\n");
    await run(repo);
  } finally {
    repo.cleanup();
  }
}

describeIfGitInstalled("git edge states against real git", () => {
  it("createStash on a clean tree throws instead of returning an older stash", async () =>
    withRepo(async (repo) => {
      repo.writeFile("f.txt", "older work\n");
      const older = await createStash(repo.dir, "older");
      await expect(createStash(repo.dir, "nothing")).rejects.toBeInstanceOf(GitStashNothingToSaveError);
      expect((await queryStashes(repo.dir)).map((stash) => stash.sha)).toEqual([older]);
    }));

  it("createStash on a clean tree with an empty stack throws the typed error", async () =>
    withRepo(async (repo) => {
      await expect(createStash(repo.dir)).rejects.toBeInstanceOf(GitStashNothingToSaveError);
    }));

  it("stash apply and pop conflicts surface as GitStashApplyConflictError", async () =>
    withRepo(async (repo) => {
      repo.writeFile("f.txt", "stashed\n");
      const sha = await createStash(repo.dir, "work");
      commit(repo, "f.txt", "committed\n");
      await expect(applyStash(repo.dir, sha)).rejects.toBeInstanceOf(GitStashApplyConflictError);
      repo.run(["reset", "-q", "--hard"]);
      await expect(applyStash(repo.dir, sha, true)).rejects.toBeInstanceOf(GitStashApplyConflictError);
    }));

  it("dropStash drops the selected entry after the stack shifted, and fails once it is gone", async () =>
    withRepo(async (repo) => {
      repo.writeFile("f.txt", "first\n");
      const first = await createStash(repo.dir, "first");
      repo.writeFile("f.txt", "second\n");
      const second = await createStash(repo.dir, "second");
      // `first` was listed as stash@{0} before `second` pushed it to stash@{1}.
      await dropStash(repo.dir, first);
      expect((await queryStashes(repo.dir)).map((stash) => stash.sha)).toEqual([second]);
      await expect(dropStash(repo.dir, first)).rejects.toBeInstanceOf(GitStashNotFoundError);
    }));

  it("ahead/behind is null for a gone upstream and for detached HEAD", async () =>
    withRepo(async (repo) => {
      repo.run(["config", "branch.main.remote", "origin"]);
      repo.run(["config", "branch.main.merge", "refs/heads/gone"]);
      await expect(queryAheadBehind(repo.dir)).resolves.toBeNull();
      repo.run(["checkout", "-q", "--detach"]);
      await expect(queryAheadBehind(repo.dir)).resolves.toBeNull();
    }));

  it("pushRemote with a derived upstream branch pushes HEAD, not a same-named local branch", async () => {
    const remote = createTempGitRepo();
    const local = createTempGitRepo();
    try {
      remote.run(["checkout", "-q", "-B", "main"]);
      commit(remote, "base.txt", "base\n");
      remote.run(["checkout", "-q", "--detach"]);
      local.run(["remote", "add", "origin", remote.dir]);
      local.run(["fetch", "-q", "origin"]);
      local.run(["checkout", "-q", "-B", "main", "origin/main"]);
      const staleMain = String(local.run(["rev-parse", "HEAD"])).trim();
      local.run(["checkout", "-q", "-b", "feature", "--track", "origin/main"]);
      commit(local, "feature.txt", "feature\n");
      const featureHead = String(local.run(["rev-parse", "HEAD"])).trim();

      await pushRemote(local.dir, { remoteName: "origin" });

      const remoteMain = String(remote.run(["rev-parse", "refs/heads/main"])).trim();
      expect(remoteMain).toBe(featureHead);
      expect(remoteMain).not.toBe(staleMain);
    } finally {
      remote.cleanup();
      local.cleanup();
    }
  });
});
