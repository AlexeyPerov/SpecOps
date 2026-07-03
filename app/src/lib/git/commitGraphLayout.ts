/**
 * Commit graph layout engine — pure geometry from an ordered commit list.
 *
 * Coordinate system: origin top-left; x grows right; y grows down.
 * Row centers use `rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2`.
 * Lane centers use `LANE_BASE_X + lane * LANE_WIDTH`.
 *
 * Geometry constants (aligned with planned history-panel row height):
 * - ROW_HEIGHT = 26 px per commit row
 * - LANE_WIDTH = 12 px between lane centers
 * - DOT_RADIUS = 4 px (for consumers; dots are positioned at lane/row centers)
 * - COLOR_COUNT = 8 palette slots (round-robin assignment)
 *
 * Octopus merges: secondary parents beyond the first are each assigned a lane
 * curve when not already tracked; there is no hard cap on parent count, but very
 * large parent lists may widen `laneCount` proportionally.
 */
import type { CommitSummary } from "./types";

/** Vertical space per history row in pixels. */
export const ROW_HEIGHT = 26;

/** Horizontal spacing between lane centers in pixels. */
export const LANE_WIDTH = 12;

/** Planned commit-dot radius for SVG rendering. */
export const DOT_RADIUS = 4;

/** Number of distinct lane colors in the palette. */
export const COLOR_COUNT = 8;

/** Left offset for lane 0 center (matches reference graph margin). */
export const LANE_BASE_X = 10;

/** Right inset after the last lane center for SVG clip width. */
export const GRAPH_RIGHT_PADDING = 6;

/** Pixel width of the graph column for a given lane count. */
export function commitGraphColumnWidth(laneCount: number): number {
  if (laneCount <= 0) {
    return 0;
  }
  return LANE_BASE_X + laneCount * LANE_WIDTH + GRAPH_RIGHT_PADDING;
}

/** Number of commit rows represented in a layout result. */
export function commitGraphRowCount(layout: CommitGraphLayoutResult): number {
  if (layout.dots.length === 0) {
    return 0;
  }
  return Math.max(...layout.dots.map((dot) => dot.rowIndex)) + 1;
}

export type CommitGraphDotKind = "default" | "head" | "merge";

/** A commit dot on the graph at a row/lane intersection. */
export interface CommitGraphDot {
  rowIndex: number;
  lane: number;
  colorIndex: number;
  kind: CommitGraphDotKind;
  sha: string;
}

/** A point in layout pixel coordinates. */
export interface CommitGraphPoint {
  x: number;
  y: number;
}

/** Polyline segment for a continuing branch lane between rows. */
export interface CommitGraphSegment {
  colorIndex: number;
  points: CommitGraphPoint[];
}

/** Merge link from a commit dot to a secondary-parent lane. */
export interface CommitGraphCurve {
  colorIndex: number;
  kind: "quadratic";
  start: CommitGraphPoint;
  control: CommitGraphPoint;
  end: CommitGraphPoint;
}

/** Full layout output for SVG or canvas rendering. */
export interface CommitGraphLayoutResult {
  dots: CommitGraphDot[];
  segments: CommitGraphSegment[];
  curves: CommitGraphCurve[];
  laneCount: number;
  rowHeight: number;
}

export interface CommitGraphLayoutOptions {
  /** When true, only the first parent of merge commits is drawn (default false). */
  firstParentOnly?: boolean;
}

interface ActivePath {
  nextSha: string;
  colorIndex: number;
  lastX: number;
  lastY: number;
  endY: number;
  points: CommitGraphPoint[];
}

class ColorPicker {
  private queue: number[] = [];

  next(): number {
    if (this.queue.length === 0) {
      for (let i = 0; i < COLOR_COUNT; i++) {
        this.queue.push(i);
      }
    }
    return this.queue.shift()!;
  }

  recycle(index: number): void {
    if (!this.queue.includes(index)) {
      this.queue.push(index);
    }
  }
}

function laneFromX(x: number): number {
  return Math.round((x - LANE_BASE_X) / LANE_WIDTH);
}

function xFromLane(lane: number): number {
  return LANE_BASE_X + lane * LANE_WIDTH;
}

function rowCenterY(rowIndex: number): number {
  return rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function rowUnitY(rowIndex: number): number {
  return rowIndex + 0.5;
}

function unitYToPixelY(unitY: number): number {
  return unitY * ROW_HEIGHT;
}

function addPoint(path: ActivePath, x: number, unitY: number): void {
  const y = unitYToPixelY(unitY);
  if (path.endY < y) {
    path.points.push({ x, y });
    path.endY = y;
  }
}

function passPath(path: ActivePath, x: number, unitY: number, halfHeight: number): void {
  if (x > path.lastX) {
    addPoint(path, path.lastX, path.lastY);
    addPoint(path, x, unitY - halfHeight);
  } else if (x < path.lastX) {
    addPoint(path, path.lastX, unitY - halfHeight);
    const adjustedY = unitY + halfHeight;
    addPoint(path, x, adjustedY);
    unitY = adjustedY;
  }

  path.lastX = x;
  path.lastY = unitY;
}

function gotoPath(path: ActivePath, x: number, unitY: number, halfHeight: number): void {
  if (x > path.lastX) {
    addPoint(path, path.lastX, path.lastY);
    addPoint(path, x, unitY - halfHeight);
  } else if (x < path.lastX) {
    let minY = unitY - halfHeight;
    if (minY > path.lastY) {
      minY -= halfHeight;
    }
    addPoint(path, path.lastX, minY);
    addPoint(path, x, unitY);
  }

  path.lastX = x;
  path.lastY = unitY;
}

function endPath(path: ActivePath, x: number, unitY: number, halfHeight: number): void {
  if (x > path.lastX) {
    addPoint(path, path.lastX, path.lastY);
    addPoint(path, x, unitY - halfHeight);
  } else if (x < path.lastX) {
    addPoint(path, path.lastX, unitY - halfHeight);
  }

  addPoint(path, x, unitY);
  path.lastX = x;
  path.lastY = unitY;
}

function createPath(
  nextSha: string,
  colorIndex: number,
  startX: number,
  startUnitY: number,
): ActivePath {
  return {
    nextSha,
    colorIndex,
    lastX: startX,
    lastY: startUnitY,
    endY: 0,
    points: [{ x: startX, y: unitYToPixelY(startUnitY) }],
  };
}

function createPathWithSegment(
  nextSha: string,
  colorIndex: number,
  startX: number,
  startUnitY: number,
  endX: number,
  endUnitY: number,
): ActivePath {
  return {
    nextSha,
    colorIndex,
    lastX: endX,
    lastY: endUnitY,
    endY: 0,
    points: [
      { x: startX, y: unitYToPixelY(startUnitY) },
      { x: endX, y: unitYToPixelY(endUnitY) },
    ],
  };
}

function pathToSegment(path: ActivePath): CommitGraphSegment {
  return {
    colorIndex: path.colorIndex,
    points: [...path.points],
  };
}

function commitDotKind(rowIndex: number, parentCount: number): CommitGraphDotKind {
  if (rowIndex === 0) {
    return "head";
  }
  if (parentCount > 1) {
    return "merge";
  }
  return "default";
}

/**
 * Build lane assignments, branch segments, and merge curves for a commit list.
 *
 * @param commits Newest-first commit rows (same order as `GitHistoryPanel` / `queryCommits`).
 * @param options Optional layout flags.
 * @returns Layout primitives for graph rendering; empty lists when `commits` is empty.
 */
export function buildCommitGraphLayout(
  commits: CommitSummary[],
  options: CommitGraphLayoutOptions = {},
): CommitGraphLayoutResult {
  const firstParentOnly = options.firstParentOnly ?? false;
  const halfHeight = 0.5;
  const unitHeight = 1;

  if (commits.length === 0) {
    return {
      dots: [],
      segments: [],
      curves: [],
      laneCount: 0,
      rowHeight: ROW_HEIGHT,
    };
  }

  const shaSet = new Set(commits.map((commit) => commit.sha));
  const dots: CommitGraphDot[] = [];
  const segments: CommitGraphSegment[] = [];
  const curves: CommitGraphCurve[] = [];
  const unsolved: ActivePath[] = [];
  const colorPicker = new ColorPicker();

  let offsetY = -halfHeight;
  let maxLaneX = LANE_BASE_X;

  for (let rowIndex = 0; rowIndex < commits.length; rowIndex++) {
    const commit = commits[rowIndex]!;
    offsetY += unitHeight;

    let offsetX = 4 - LANE_WIDTH / 2;
    const maxOffsetOld = unsolved.length > 0 ? unsolved[unsolved.length - 1]!.lastX : offsetX + LANE_WIDTH;

    let major: ActivePath | null = null;
    const ended: ActivePath[] = [];

    for (const path of unsolved) {
      if (path.nextSha === commit.sha) {
        if (major === null) {
          offsetX += LANE_WIDTH;
          major = path;

          if (commit.parents.length > 0) {
            const firstParent = commit.parents[0]!;
            path.nextSha = firstParent;
            if (shaSet.has(firstParent)) {
              gotoPath(path, offsetX, offsetY, halfHeight);
            } else {
              endPath(path, offsetX, offsetY, halfHeight);
              ended.push(path);
            }
          } else {
            endPath(path, offsetX, offsetY, halfHeight);
            ended.push(path);
          }
        } else {
          endPath(path, major.lastX, offsetY, halfHeight);
          ended.push(path);
        }
      } else {
        offsetX += LANE_WIDTH;
        passPath(path, offsetX, offsetY, halfHeight);
      }
    }

    for (const path of ended) {
      colorPicker.recycle(path.colorIndex);
      const index = unsolved.indexOf(path);
      if (index >= 0) {
        unsolved.splice(index, 1);
      }
      if (path.points.length > 1) {
        segments.push(pathToSegment(path));
      }
    }

    if (major === null) {
      offsetX += LANE_WIDTH;
      if (commit.parents.length > 0) {
        const firstParent = commit.parents[0]!;
        const path = createPath(
          firstParent,
          colorPicker.next(),
          offsetX,
          offsetY,
        );
        unsolved.push(path);
        major = path;
      }
    }

    const dotX = major?.lastX ?? offsetX;
    const dotColor = major?.colorIndex ?? 0;
    const dotLane = laneFromX(dotX);

    dots.push({
      rowIndex,
      lane: dotLane,
      colorIndex: dotColor,
      kind: commitDotKind(rowIndex, commit.parents.length),
      sha: commit.sha,
    });

    const dotPixelY = rowCenterY(rowIndex);

    if (!firstParentOnly) {
      for (let parentIndex = 1; parentIndex < commit.parents.length; parentIndex++) {
        const parentSha = commit.parents[parentIndex]!;
        const existing = unsolved.find((path) => path.nextSha === parentSha);

        if (existing) {
          gotoPath(existing, existing.lastX, offsetY + halfHeight, halfHeight);
          curves.push({
            colorIndex: existing.colorIndex,
            kind: "quadratic",
            start: { x: dotX, y: dotPixelY },
            control: { x: existing.lastX, y: dotPixelY },
            end: { x: existing.lastX, y: unitYToPixelY(offsetY + halfHeight) },
          });
        } else {
          offsetX += LANE_WIDTH;
          const path = createPathWithSegment(
            parentSha,
            colorPicker.next(),
            dotX,
            offsetY,
            offsetX,
            offsetY + halfHeight,
          );
          unsolved.push(path);
          curves.push({
            colorIndex: path.colorIndex,
            kind: "quadratic",
            start: { x: dotX, y: dotPixelY },
            control: { x: offsetX, y: dotPixelY },
            end: { x: offsetX, y: unitYToPixelY(offsetY + halfHeight) },
          });
        }
      }
    }

    maxLaneX = Math.max(maxLaneX, offsetX, maxOffsetOld);
  }

  const endUnitY = (commits.length - 0.5) * unitHeight;
  for (let i = 0; i < unsolved.length; i++) {
    const path = unsolved[i]!;
    const endY = unitYToPixelY(endUnitY);
    if (path.points.length === 1 && Math.abs(path.points[0]!.y - endY) < 0.0001) {
      continue;
    }

    const endX = (i + 0.5) * LANE_WIDTH + 4;
    endPath(path, endX, endUnitY + halfHeight, halfHeight);
    if (path.points.length > 1) {
      segments.push(pathToSegment(path));
    }
  }

  const laneCount = Math.max(1, laneFromX(maxLaneX) + 1);

  return {
    dots,
    segments,
    curves,
    laneCount,
    rowHeight: ROW_HEIGHT,
  };
}
