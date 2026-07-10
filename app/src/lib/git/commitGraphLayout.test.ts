import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LANE_BASE_X,
  LANE_WIDTH,
  ROW_HEIGHT,
  buildCommitGraphLayout,
  computeCurrentBranchCommitSet,
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

describe("computeCurrentBranchCommitSet", () => {
  it("walks the first-parent chain from HEAD on a merge fixture", () => {
    const commits = readCommitFixture("commit-graph-merge.json");
    const headSha = "merge-main-head";
    const highlighted = computeCurrentBranchCommitSet(commits, headSha);

    expect(highlighted.has("merge-main-head")).toBe(true);
    expect(highlighted.has("merge-main-tip")).toBe(true);
    expect(highlighted.has("merge-commit")).toBe(true);
    expect(highlighted.has("merge-base")).toBe(true);
    expect(highlighted.has("merge-root-2")).toBe(true);
    expect(highlighted.has("merge-root-1")).toBe(true);

    expect(highlighted.has("merge-feature-tip")).toBe(false);
    expect(highlighted.has("merge-feature-2")).toBe(false);
    expect(highlighted.has("merge-feature-1")).toBe(false);
  });

  it("stops at the loaded window boundary", () => {
    const commits = readCommitFixture("commit-graph-truncated.json");
    const headSha = commits[0]!.sha;
    const highlighted = computeCurrentBranchCommitSet(commits, headSha);

    expect(highlighted.has("trunc-tip")).toBe(true);
    expect(highlighted.has("trunc-mid")).toBe(true);
    expect(highlighted.has("trunc-older")).toBe(false);
    expect(highlighted.size).toBe(2);
  });
});

describe("buildCommitGraphLayout highlighting", () => {
  it("dims side-branch primitives while keeping main-line commits highlighted", () => {
    const commits = readCommitFixture("commit-graph-merge.json");
    const highlightedShas = computeCurrentBranchCommitSet(commits, "merge-main-head");
    const layout = buildCommitGraphLayout(commits, { highlightedShas });

    const mainHead = layout.dots.find((dot) => dot.sha === "merge-main-head");
    const featureTip = layout.dots.find((dot) => dot.sha === "merge-feature-tip");

    expect(mainHead?.isHighlighted).toBe(true);
    expect(featureTip?.isHighlighted).toBe(false);

    expect(layout.segments.some((segment) => segment.isHighlighted === true)).toBe(true);
    expect(layout.segments.some((segment) => segment.isHighlighted === false)).toBe(true);
    expect(layout.curves.some((curve) => curve.isHighlighted === false)).toBe(true);
  });

  it("marks all primitives highlighted when no highlightedShas option is passed", () => {
    const commits = readCommitFixture("commit-graph-merge.json");
    const layout = buildCommitGraphLayout(commits);

    expect(layout.dots.every((dot) => dot.isHighlighted !== false)).toBe(true);
    expect(layout.segments.every((segment) => segment.isHighlighted !== false)).toBe(true);
    expect(layout.curves.every((curve) => curve.isHighlighted !== false)).toBe(true);
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

      const defaultBranch = (repo.run(["rev-parse", "--abbrev-ref", "HEAD"]) as string).trim();

      repo.run(["branch", "feature"]);
      repo.run(["checkout", "feature"]);
      repo.writeFile("feature.txt", "work");
      repo.run(["add", "feature.txt"]);
      repo.run(["commit", "-m", "Feature work"]);

      repo.run(["checkout", defaultBranch]);
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
