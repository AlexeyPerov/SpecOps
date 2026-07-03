import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LANE_BASE_X,
  LANE_WIDTH,
  ROW_HEIGHT,
  buildCommitGraphLayout,
} from "./commitGraphLayout";
import { GIT_LOG_FORMAT, parseLogCommits } from "./gitParse";
import { describeIfGitInstalled, withTempGitRepo } from "./test/gitTempRepoHarness";
import type { CommitSummary } from "./types";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readCommitFixture(name: string): CommitSummary[] {
  const raw = readFileSync(join(fixturesDir, name), "utf8");
  return JSON.parse(raw) as CommitSummary[];
}

function laneCenterX(lane: number): number {
  return LANE_BASE_X + lane * LANE_WIDTH;
}

function rowCenterY(rowIndex: number): number {
  return rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
}

describe("buildCommitGraphLayout", () => {
  it("returns empty layout for an empty commit list", () => {
    const layout = buildCommitGraphLayout([]);

    expect(layout.dots).toEqual([]);
    expect(layout.segments).toEqual([]);
    expect(layout.curves).toEqual([]);
    expect(layout.laneCount).toBe(0);
    expect(layout.rowHeight).toBe(ROW_HEIGHT);
  });

  it("assigns stable single-lane dots for a linear five-commit chain", () => {
    const commits = readCommitFixture("commit-graph-linear.json");
    const layout = buildCommitGraphLayout(commits);

    expect(layout.dots).toHaveLength(5);
    expect(layout.laneCount).toBe(1);
    expect(layout.dots.every((dot) => dot.lane === 0)).toBe(true);
    expect(layout.dots[0]).toMatchObject({
      rowIndex: 0,
      lane: 0,
      kind: "head",
      sha: "linear-c5-head",
    });
    expect(layout.dots[4]).toMatchObject({
      rowIndex: 4,
      lane: 0,
      kind: "default",
      sha: "linear-c1",
    });
  });

  it("places the first three linear rows at expected lane and row centers", () => {
    const commits = readCommitFixture("commit-graph-linear.json");
    const layout = buildCommitGraphLayout(commits);

    for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
      const dot = layout.dots[rowIndex]!;
      expect(dot.lane).toBe(0);
      expect(dot.sha).toBe(commits[rowIndex]!.sha);

      const matchingCurve = layout.curves.find(
        (curve) => curve.start.y === rowCenterY(rowIndex),
      );
      expect(matchingCurve).toBeUndefined();
    }

    expect(layout.dots[0]!.kind).toBe("head");
    expect(layout.dots[1]!.kind).toBe("default");
    expect(layout.dots[2]!.kind).toBe("default");

    const expectedLaneX = laneCenterX(0);
    expect(layout.segments.some((segment) => segment.points[0]?.x === expectedLaneX)).toBe(
      true,
    );
  });

  it("produces merge dots and curves for a feature-branch merge topology", () => {
    const commits = readCommitFixture("commit-graph-merge.json");
    const layout = buildCommitGraphLayout(commits);

    expect(layout.dots).toHaveLength(9);
    expect(layout.laneCount).toBeGreaterThan(1);

    const mergeDot = layout.dots.find((dot) => dot.sha === "merge-commit");
    expect(mergeDot).toMatchObject({
      kind: "merge",
    });
    expect(layout.curves.length).toBeGreaterThan(0);
  });

  it("completes gracefully when a parent SHA is missing from the fetched window", () => {
    const commits = readCommitFixture("commit-graph-truncated.json");

    expect(() => buildCommitGraphLayout(commits)).not.toThrow();

    const layout = buildCommitGraphLayout(commits);
    expect(layout.dots).toHaveLength(3);
    expect(layout.laneCount).toBeGreaterThanOrEqual(1);
  });

  it("handles a single-commit repository", () => {
    const commits = readCommitFixture("commit-graph-linear.json").slice(0, 1);
    const layout = buildCommitGraphLayout(commits);

    expect(layout.dots).toHaveLength(1);
    expect(layout.dots[0]).toMatchObject({
      rowIndex: 0,
      kind: "head",
      lane: 0,
    });
    expect(layout.laneCount).toBe(1);
  });
});

describeIfGitInstalled("buildCommitGraphLayout integration (temp repo)", () => {
  it("accepts queryCommits-shaped output from a real merge repository", () => {
    withTempGitRepo("specops-git-graph-merge-", (repo) => {
      repo.writeFile("README.md", "base");
      repo.run(["add", "README.md"]);
      repo.run(["commit", "-m", "Initial"]);

      repo.writeFile("README.md", "mainline");
      repo.run(["add", "README.md"]);
      repo.run(["commit", "-m", "Main advance"]);

      repo.run(["branch", "feature"]);
      repo.run(["checkout", "feature"]);
      repo.writeFile("feature.txt", "work");
      repo.run(["add", "feature.txt"]);
      repo.run(["commit", "-m", "Feature work"]);

      repo.run(["checkout", "master"]);
      repo.writeFile("README.md", "main again");
      repo.run(["add", "README.md"]);
      repo.run(["commit", "-m", "Parallel main"]);

      repo.run(["merge", "feature", "-m", "Merge feature"]);

      const stdout = repo.run([
        "log",
        "--no-show-signature",
        "--decorate=full",
        `--format=${GIT_LOG_FORMAT}`,
        "-20",
      ]) as string;

      const commits = parseLogCommits(stdout);
      expect(commits.length).toBeGreaterThanOrEqual(4);

      expect(() => buildCommitGraphLayout(commits)).not.toThrow();

      const layout = buildCommitGraphLayout(commits);
      expect(layout.dots.length).toBe(commits.length);
      expect(layout.dots[0]?.kind).toBe("head");

      const hasMerge = layout.dots.some((dot) => dot.kind === "merge");
      if (hasMerge) {
        expect(layout.curves.length).toBeGreaterThan(0);
        expect(layout.laneCount).toBeGreaterThan(1);
      }
    });
  });
});
