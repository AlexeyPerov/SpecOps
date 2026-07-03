<script lang="ts">
  import {
    COLOR_COUNT,
    DOT_RADIUS,
    LANE_BASE_X,
    LANE_WIDTH,
    ROW_HEIGHT,
    commitGraphColumnWidth,
    commitGraphRowCount,
    type CommitGraphCurve,
    type CommitGraphDot,
    type CommitGraphLayoutResult,
    type CommitGraphSegment,
  } from "../git/commitGraphLayout";

  interface Props {
    layout: CommitGraphLayoutResult;
    rowHeight?: number;
    selectedSha?: string | null;
    highlightedShas?: Set<string>;
  }

  let {
    layout,
    rowHeight = ROW_HEIGHT,
    selectedSha = null,
    highlightedShas = new Set<string>(),
  }: Props = $props();

  const svgWidth = $derived(commitGraphColumnWidth(layout.laneCount));
  const svgHeight = $derived(commitGraphRowCount(layout) * rowHeight);

  function segmentPolyline(segment: CommitGraphSegment): string {
    return segment.points.map((point) => `${point.x},${point.y}`).join(" ");
  }

  function curvePath(curve: CommitGraphCurve): string {
    const { start, control, end } = curve;
    return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  }

  function dotCenterX(dot: CommitGraphDot): number {
    return LANE_BASE_X + dot.lane * LANE_WIDTH;
  }

  function dotCenterY(dot: CommitGraphDot): number {
    return dot.rowIndex * rowHeight + rowHeight / 2;
  }

  function laneClass(colorIndex: number): string {
    return `git-graph-lane-${colorIndex % COLOR_COUNT}`;
  }

  function dotClass(dot: CommitGraphDot): string {
    const classes = ["git-graph-dot", `git-graph-dot-${dot.kind}`];
    if (selectedSha === dot.sha) {
      classes.push("git-graph-dot-selected");
    }
    if (highlightedShas.has(dot.sha)) {
      classes.push("git-graph-dot-highlighted");
    }
    return classes.join(" ");
  }
</script>

<svg
  class="git-commit-graph"
  role="img"
  aria-hidden="true"
  width={svgWidth}
  height={svgHeight}
  viewBox="0 0 {svgWidth} {svgHeight}"
>
  {#each layout.segments as segment, index (index)}
    <polyline
      class="git-graph-segment {laneClass(segment.colorIndex)}"
      points={segmentPolyline(segment)}
      fill="none"
    />
  {/each}

  {#each layout.curves as curve, index (index)}
    <path
      class="git-graph-curve {laneClass(curve.colorIndex)}"
      d={curvePath(curve)}
      fill="none"
    />
  {/each}

  {#each layout.dots as dot (dot.sha)}
    <circle
      class="{dotClass(dot)} {laneClass(dot.colorIndex)}"
      cx={dotCenterX(dot)}
      cy={dotCenterY(dot)}
      r={DOT_RADIUS}
    />
  {/each}
</svg>

<style>
  .git-commit-graph {
    display: block;
    flex-shrink: 0;
    overflow: visible;

    --graph-lane-0: #2376ff;
    --graph-lane-1: #50a14f;
    --graph-lane-2: #c18401;
    --graph-lane-3: #a626a4;
    --graph-lane-4: #0184bc;
    --graph-lane-5: #e45649;
    --graph-lane-6: #986801;
    --graph-lane-7: #4078f2;
  }

  :global([data-theme="dark"]) .git-commit-graph {
    --graph-lane-0: #57a1ff;
    --graph-lane-1: #98c379;
    --graph-lane-2: #e5c07b;
    --graph-lane-3: #c678dd;
    --graph-lane-4: #56b6c2;
    --graph-lane-5: #e06c75;
    --graph-lane-6: #d19a66;
    --graph-lane-7: #61afef;
  }

  .git-graph-segment,
  .git-graph-curve {
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .git-graph-lane-0 {
    stroke: var(--graph-lane-0);
  }
  .git-graph-lane-1 {
    stroke: var(--graph-lane-1);
  }
  .git-graph-lane-2 {
    stroke: var(--graph-lane-2);
  }
  .git-graph-lane-3 {
    stroke: var(--graph-lane-3);
  }
  .git-graph-lane-4 {
    stroke: var(--graph-lane-4);
  }
  .git-graph-lane-5 {
    stroke: var(--graph-lane-5);
  }
  .git-graph-lane-6 {
    stroke: var(--graph-lane-6);
  }
  .git-graph-lane-7 {
    stroke: var(--graph-lane-7);
  }

  .git-graph-dot {
    stroke-width: 2;
    fill: var(--color-surface-1);
  }

  .git-graph-dot-head {
    stroke: var(--color-surface-1);
    stroke-width: 2;
  }

  .git-graph-dot-merge {
    stroke-width: 2.5;
  }

  .git-graph-dot-head.git-graph-lane-0 {
    fill: var(--graph-lane-0);
  }
  .git-graph-dot-head.git-graph-lane-1 {
    fill: var(--graph-lane-1);
  }
  .git-graph-dot-head.git-graph-lane-2 {
    fill: var(--graph-lane-2);
  }
  .git-graph-dot-head.git-graph-lane-3 {
    fill: var(--graph-lane-3);
  }
  .git-graph-dot-head.git-graph-lane-4 {
    fill: var(--graph-lane-4);
  }
  .git-graph-dot-head.git-graph-lane-5 {
    fill: var(--graph-lane-5);
  }
  .git-graph-dot-head.git-graph-lane-6 {
    fill: var(--graph-lane-6);
  }
  .git-graph-dot-head.git-graph-lane-7 {
    fill: var(--graph-lane-7);
  }

  .git-graph-dot-selected {
    stroke: var(--color-accent) !important;
    stroke-width: 3;
    filter: drop-shadow(0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent));
  }

  .git-graph-dot-highlighted:not(.git-graph-dot-selected) {
    stroke-width: 3;
    filter: drop-shadow(0 0 1px color-mix(in srgb, currentColor 40%, transparent));
  }
</style>
