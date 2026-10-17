import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOT_RADIUS,
  LANE_BASE_X,
  LANE_WIDTH,
  ROW_HEIGHT,
  buildCommitGraphLayout,
  commitGraphColumnWidth,
} from "../git/commitGraphLayout";
import type { CommitSummary } from "../git/types";
import GitCommitGraphColumn from "./GitCommitGraphColumn.svelte";
import { mountComponent } from "./_testComponentMount";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../git/fixtures");

function readCommitFixture(name: string): CommitSummary[] {
  const raw = readFileSync(join(fixturesDir, name), "utf8");
  return JSON.parse(raw) as CommitSummary[];
}

describe("GitCommitGraphColumn.svelte", () => {
  it("renders lane segments and dots for a linear fixture", () => {
    const layout = buildCommitGraphLayout(readCommitFixture("commit-graph-linear.json"));
    const { host } = mountComponent(GitCommitGraphColumn, { layout });

    const svg = host.querySelector("svg.git-commit-graph");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(host.querySelectorAll(".git-graph-segment").length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".git-graph-dot")).toHaveLength(5);
    expect(host.querySelectorAll(".git-graph-curve")).toHaveLength(0);
  });

  it("renders merge curves for a merge topology fixture", () => {
    const layout = buildCommitGraphLayout(readCommitFixture("commit-graph-merge.json"));
    const { host } = mountComponent(GitCommitGraphColumn, { layout });

    expect(host.querySelectorAll(".git-graph-curve").length).toBeGreaterThan(0);
    expect(host.querySelector(".git-graph-dot-merge")).not.toBeNull();
  });

  it("sizes the SVG from lane count and explicit row count", () => {
    const linearCommits = readCommitFixture("commit-graph-linear.json");
    const linearLayout = buildCommitGraphLayout(linearCommits);
    const mergeLayout = buildCommitGraphLayout(readCommitFixture("commit-graph-merge.json"));

    const linearHost = mountComponent(GitCommitGraphColumn, {
      layout: linearLayout,
      rowCount: linearCommits.length,
    }).host;
    const mergeHost = mountComponent(GitCommitGraphColumn, { layout: mergeLayout }).host;

    const linearSvg = linearHost.querySelector("svg")!;
    const mergeSvg = mergeHost.querySelector("svg")!;

    expect(Number(linearSvg.getAttribute("width"))).toBe(
      commitGraphColumnWidth(linearLayout.laneCount),
    );
    expect(Number(linearSvg.getAttribute("height"))).toBe(
      linearCommits.length * ROW_HEIGHT,
    );
    expect(Number(mergeSvg.getAttribute("width"))).toBeGreaterThan(
      Number(linearSvg.getAttribute("width")),
    );
  });

  it("applies a selection ring to the selected commit dot", () => {
    const layout = buildCommitGraphLayout(readCommitFixture("commit-graph-linear.json"));
    const selectedSha = layout.dots[0]!.sha;
    const { host } = mountComponent(GitCommitGraphColumn, { layout, selectedSha });

    expect(host.querySelector(".git-graph-dot-selected")).not.toBeNull();
  });

  it("positions dots at lane and row centers", () => {
    const layout = buildCommitGraphLayout(readCommitFixture("commit-graph-linear.json"));
    const { host } = mountComponent(GitCommitGraphColumn, { layout });

    const dot = layout.dots[0]!;
    const circle = host.querySelector("circle")!;
    const expectedX = LANE_BASE_X + dot.lane * LANE_WIDTH;
    const expectedY = dot.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

    expect(circle.getAttribute("cx")).toBe(String(expectedX));
    expect(circle.getAttribute("cy")).toBe(String(expectedY));
    expect(circle.getAttribute("r")).toBe(String(DOT_RADIUS));
  });

  it("applies dimmed styling to non-highlighted graph primitives", () => {
    const commits = readCommitFixture("commit-graph-merge.json");
    const highlightedShas = new Set([
      "merge-main-head",
      "merge-main-tip",
      "merge-commit",
      "merge-base",
      "merge-root-2",
      "merge-root-1",
    ]);
    const layout = buildCommitGraphLayout(commits, { highlightedShas });
    const { host } = mountComponent(GitCommitGraphColumn, { layout });

    expect(host.querySelectorAll(".git-graph-dimmed").length).toBeGreaterThan(0);
    expect(host.querySelector(".git-graph-dot-head.git-graph-dimmed")).toBeNull();
  });
  it("scales every merge primitive with compact row centers", () => {
    const layout = buildCommitGraphLayout(readCommitFixture("commit-graph-merge.json"));
    const rowHeight = 24;
    const {host} = mountComponent(GitCommitGraphColumn, {layout,rowHeight});
    const scale=rowHeight/layout.rowHeight;
    const segment=layout.segments[0];
    expect(host.querySelector("polyline")?.getAttribute("points")).toBe(segment.points.map(p=>`${p.x},${p.y*scale}`).join(" "));
    const curve=layout.curves[0];
    expect(host.querySelector("path")?.getAttribute("d")).toBe(`M ${curve.start.x} ${curve.start.y*scale} Q ${curve.control.x} ${curve.control.y*scale} ${curve.end.x} ${curve.end.y*scale}`);
    expect(host.querySelector("circle")?.getAttribute("cy")).toBe(String(layout.dots[0].rowIndex*rowHeight+rowHeight/2));
  });

});
