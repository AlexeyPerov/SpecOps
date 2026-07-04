import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseStatusPorcelain, splitWorkingTreeStatus } from "./gitParse";
import {
  mapPorcelainStatusCodeToBadge,
  mapWorkingTreeStatusToAbsoluteBadges,
} from "./projectTreeFileStatusMap";
import { describeIfGitInstalled, withTempGitRepo } from "./test/gitTempRepoHarness";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("mapPorcelainStatusCodeToBadge", () => {
  it("maps common porcelain codes to M/A/D badges", () => {
    expect(mapPorcelainStatusCodeToBadge("??")).toBe("added");
    expect(mapPorcelainStatusCodeToBadge(" M")).toBe("modified");
    expect(mapPorcelainStatusCodeToBadge("M ")).toBe("modified");
    expect(mapPorcelainStatusCodeToBadge("MM")).toBe("modified");
    expect(mapPorcelainStatusCodeToBadge("A ")).toBe("added");
    expect(mapPorcelainStatusCodeToBadge("AM")).toBe("modified");
    expect(mapPorcelainStatusCodeToBadge(" D")).toBe("deleted");
    expect(mapPorcelainStatusCodeToBadge("D ")).toBe("deleted");
    expect(mapPorcelainStatusCodeToBadge("R  old -> new")).toBe("modified");
  });
});

describe("mapWorkingTreeStatusToAbsoluteBadges", () => {
  it("maps fixture porcelain output to absolute badge paths", () => {
    const status = splitWorkingTreeStatus(parseStatusPorcelain(readFixture("git-status-porcelain.txt")));
    const badges = mapWorkingTreeStatusToAbsoluteBadges("/tmp/repo", status);

    expect(badges.get("/tmp/repo/README.md")).toBe("modified");
    expect(badges.get("/tmp/repo/untracked.txt")).toBe("added");
    expect(badges.get("/tmp/repo/staged-only.txt")).toBe("modified");
    expect(badges.get("/tmp/repo/both-staged-unstaged.txt")).toBe("modified");
    expect(badges.get("/tmp/repo/added-staged.txt")).toBe("added");
    expect(badges.get("/tmp/repo/deleted-unstaged.txt")).toBe("deleted");
    expect(badges.get("/tmp/repo/deleted-staged.txt")).toBe("deleted");
    expect(badges.get("/tmp/repo/new-name.txt")).toBe("modified");
    expect(badges.get("/tmp/repo/path with spaces.txt")).toBe("added");
  });
});

describeIfGitInstalled("mapWorkingTreeStatusToAbsoluteBadges integration", () => {
  it("matches real git status output from a temp repository", () => {
    withTempGitRepo("specops-project-tree-badges-", (repo) => {
      repo.writeFile("tracked.txt", "v1");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);

      repo.writeFile("tracked.txt", "v2");
      repo.writeFile("new.txt", "new");
      repo.run(["add", "new.txt"]);

      const stdout = repo.run(["status", "--porcelain"]) as string;
      const status = splitWorkingTreeStatus(parseStatusPorcelain(stdout));
      const badges = mapWorkingTreeStatusToAbsoluteBadges(repo.dir, status);

      expect(badges.get(`${repo.dir}/tracked.txt`)).toBe("modified");
      expect(badges.get(`${repo.dir}/new.txt`)).toBe("added");
    });
  });
});
