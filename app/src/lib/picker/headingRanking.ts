/**
 * Heading-jump ranking adapter over shared fuzzy scoring.
 *
 * Reuses the M4.2 Markdown heading model (`MarkdownHeadingSnapshot`) and the
 * shared `fuzzyRank` engine — there is no second heading parser here. Headings
 * are ranked by fuzzy match against their display text; hierarchy/line context
 * is exposed as secondary metadata so duplicate labels stay distinguishable.
 *
 * Tie-breaks (per the plan): fuzzy score → proximity to the cursor (closer to
 * the active heading ranks higher) → document order. The empty query preserves
 * document order and flags the heading nearest the cursor as current.
 *
 * Pure and side-effect free: no state mutation, no I/O.
 */

import type { MarkdownHeadingSnapshot } from "../types/editor";
import {
  fuzzyRank,
  type FuzzyCandidate,
  type FuzzyMatch,
  type FuzzyMatchRange,
} from "./fuzzyRank";

export interface RankHeadingsOptions {
  /** Maximum number of ranked results to return. Default unbounded. */
  limit?: number;
}

/** A ranked heading ready for heading-jump picker rendering. */
export interface RankedHeading {
  heading: MarkdownHeadingSnapshot;
  score: number;
  /** Match ranges against the heading text for highlighting. */
  ranges: readonly FuzzyMatchRange[];
  /** Secondary label: hierarchy + line, so duplicates stay distinguishable. */
  hierarchyLabel: string;
  /** True for the heading nearest the cursor (document-order active section). */
  isCurrent: boolean;
}

/** Metadata about the ranking pass. */
export interface RankedHeadingsResult {
  matches: RankedHeading[];
  totalMatches: number;
  scannedCount: number;
  truncated: boolean;
}

function hierarchyLabelFor(heading: MarkdownHeadingSnapshot): string {
  return `H${heading.level} · line ${heading.line}`;
}

function proximityScore(heading: MarkdownHeadingSnapshot, cursorPos: number): number {
  // Closer headings (by document position) get a higher tie-break boost.
  // Capped so fuzzy score still dominates the ranking.
  const distance = Math.abs(heading.from - cursorPos);
  return Math.max(0, 1_000_000 - distance);
}

function toCandidate(
  heading: MarkdownHeadingSnapshot,
  cursorPos: number,
): FuzzyCandidate<MarkdownHeadingSnapshot> {
  return {
    item: heading,
    text: heading.text || "(empty heading)",
    altTexts: [`h${heading.level}`, `line ${heading.line}`],
    recentScore: proximityScore(heading, cursorPos),
  };
}

function activeLineForCursor(
  headings: readonly MarkdownHeadingSnapshot[],
  cursorPos: number,
): number | null {
  // Active heading = nearest heading at or above the cursor (document order).
  let activeLine: number | null = null;
  for (const heading of headings) {
    if (heading.from <= cursorPos) {
      activeLine = heading.line;
    } else {
      break;
    }
  }
  return activeLine;
}

/**
 * Rank Markdown headings for the heading-jump picker.
 *
 * Empty query preserves document order and marks the active heading. With a
 * query, fuzzy score dominates; ties break by proximity to the cursor then by
 * document order.
 */
export function rankHeadings(
  headings: readonly MarkdownHeadingSnapshot[],
  query: string,
  cursorPos: number,
  options: RankHeadingsOptions = {},
): RankedHeadingsResult {
  const limit = options.limit;
  const scannedCount = headings.length;
  const activeLine = activeLineForCursor(headings, cursorPos);
  const activeHeadingLine = activeLine;
  const needle = query.trim();

  if (needle.length === 0) {
    const matches: RankedHeading[] = headings.map((heading) => ({
      heading,
      score: 0,
      ranges: [],
      hierarchyLabel: hierarchyLabelFor(heading),
      isCurrent: heading.line === activeHeadingLine,
    }));
    return {
      matches: limit === undefined ? matches : matches.slice(0, Math.max(0, limit)),
      totalMatches: matches.length,
      scannedCount,
      truncated: limit !== undefined && matches.length > limit,
    };
  }

  const candidates = headings.map((heading) => toCandidate(heading, cursorPos));
  const ranked: FuzzyMatch<MarkdownHeadingSnapshot>[] = fuzzyRank(candidates, query);

  // fuzzyRank already breaks ties by recentScore (proximity) then original
  // index (document order), which matches the desired tie-break policy.
  const matches: RankedHeading[] = ranked.map((match) => ({
    heading: match.item,
    score: match.score,
    ranges: match.ranges,
    hierarchyLabel: hierarchyLabelFor(match.item),
    isCurrent: match.item.line === activeHeadingLine,
  }));

  return {
    matches: limit === undefined ? matches : matches.slice(0, Math.max(0, limit)),
    totalMatches: matches.length,
    scannedCount,
    truncated: limit !== undefined && matches.length > limit,
  };
}
