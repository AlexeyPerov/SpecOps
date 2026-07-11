/**
 * Pure fuzzy ranking for searchable pickers (quick-open, command palette).
 * No UI markup — returns scores, match ranges, and bounded ordered results.
 */

export interface FuzzyMatchRange {
  /** Inclusive start index in the matched text. */
  start: number;
  /** Exclusive end index in the matched text. */
  end: number;
}

export interface FuzzyCandidate<T> {
  item: T;
  /** Primary label / basename used for highlight ranges. */
  text: string;
  /** Extra searchable strings (path, aliases); lower weight than `text`. */
  altTexts?: readonly string[];
  /** Caller-supplied recency boost; higher wins ties when scores otherwise match. */
  recentScore?: number;
}

export interface FuzzyMatch<T> {
  item: T;
  score: number;
  /** Match ranges against the primary `text` (empty when query is empty). */
  ranges: readonly FuzzyMatchRange[];
}

export interface FuzzyRankOptions {
  /** Maximum results to return. Default: unbounded. */
  limit?: number;
}

const WORD_SEP = /[^a-zA-Z0-9]/;

function isWordBoundary(haystack: string, index: number): boolean {
  if (index <= 0) {
    return true;
  }
  const prev = haystack[index - 1]!;
  const cur = haystack[index]!;
  if (WORD_SEP.test(prev)) {
    return true;
  }
  // camelCase boundary
  if (prev === prev.toLowerCase() && cur === cur.toUpperCase() && /[a-zA-Z]/.test(cur)) {
    return true;
  }
  if (/\d/.test(prev) && /[a-zA-Z]/.test(cur)) {
    return true;
  }
  return false;
}

function basenameOf(pathLike: string): string {
  const normalized = pathLike.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/**
 * Score a single haystack against a lowercased needle.
 * Returns null when not all needle characters match in order.
 */
function scoreHaystack(
  haystack: string,
  needleLower: string,
): { score: number; ranges: FuzzyMatchRange[] } | null {
  if (needleLower.length === 0) {
    return { score: 0, ranges: [] };
  }

  const hayLower = haystack.toLowerCase();
  let score = 0;
  const ranges: FuzzyMatchRange[] = [];
  let hi = 0;
  let consecutive = 0;
  let rangeStart = -1;

  for (let ni = 0; ni < needleLower.length; ni += 1) {
    const ch = needleLower[ni]!;
    const found = hayLower.indexOf(ch, hi);
    if (found < 0) {
      return null;
    }

    let charScore = 1;
    if (found === hi && consecutive > 0) {
      consecutive += 1;
      charScore += 8 + consecutive;
    } else {
      consecutive = 1;
      if (rangeStart >= 0) {
        ranges.push({ start: rangeStart, end: hi });
        rangeStart = -1;
      }
    }

    if (found === 0) {
      charScore += 12;
    } else if (isWordBoundary(haystack, found)) {
      charScore += 10;
    }

    charScore += Math.max(0, 6 - Math.min(found, 6));
    score += charScore;

    if (rangeStart < 0) {
      rangeStart = found;
    }
    hi = found + 1;
  }

  if (rangeStart >= 0) {
    ranges.push({ start: rangeStart, end: hi });
  }

  if (hayLower === needleLower) {
    score += 100;
  } else if (hayLower.startsWith(needleLower)) {
    score += 40;
  }

  const span = hi - (ranges[0]?.start ?? 0);
  if (span > 0) {
    score += Math.round((needleLower.length / span) * 20);
  }

  return { score, ranges };
}

interface ScoredText {
  score: number;
  ranges: FuzzyMatchRange[];
  /** Whether ranges map onto the primary `text`. */
  primaryRanges: boolean;
}

function scoreCandidate<T>(
  candidate: FuzzyCandidate<T>,
  needleLower: string,
): ScoredText | null {
  let best: ScoredText | null = null;

  const consider = (score: number, ranges: FuzzyMatchRange[], primaryRanges: boolean) => {
    if (!best || score > best.score) {
      best = { score, ranges, primaryRanges };
    }
  };

  const primary = scoreHaystack(candidate.text, needleLower);
  if (primary) {
    consider(primary.score, primary.ranges, true);
  }

  const base = basenameOf(candidate.text);
  if (base !== candidate.text) {
    const baseMatch = scoreHaystack(base, needleLower);
    if (baseMatch) {
      const offset = candidate.text.length - base.length;
      const mapped = baseMatch.ranges.map((r) => ({
        start: r.start + offset,
        end: r.end + offset,
      }));
      // Basename preference over directory-only primary matches
      consider(baseMatch.score + 25, mapped, true);
    }
  }

  for (const alt of candidate.altTexts ?? []) {
    const altMatch = scoreHaystack(alt, needleLower);
    if (altMatch) {
      consider(Math.round(altMatch.score * 0.75), [], false);
    }
  }

  return best;
}

/**
 * Rank candidates by fuzzy score. Empty query preserves caller order (score 0).
 * Ties break by higher recentScore, then lower original index (stable).
 */
export function fuzzyRank<T>(
  candidates: readonly FuzzyCandidate<T>[],
  query: string,
  options: FuzzyRankOptions = {},
): FuzzyMatch<T>[] {
  const limit = options.limit;
  const needle = query.trim();

  if (needle.length === 0) {
    const preserved = candidates.map((c) => ({
      item: c.item,
      score: 0,
      ranges: [] as readonly FuzzyMatchRange[],
    }));
    return limit === undefined ? preserved : preserved.slice(0, Math.max(0, limit));
  }

  const needleLower = needle.toLowerCase();
  const scored: Array<FuzzyMatch<T> & { index: number; recent: number }> = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]!;
    const result = scoreCandidate(candidate, needleLower);
    if (!result) {
      continue;
    }
    const recent = candidate.recentScore ?? 0;
    scored.push({
      item: candidate.item,
      score: result.score + recent * 3,
      ranges: result.primaryRanges ? result.ranges : [],
      index: i,
      recent,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.recent !== a.recent) {
      return b.recent - a.recent;
    }
    return a.index - b.index;
  });

  const matches: FuzzyMatch<T>[] = scored.map(({ item, score, ranges }) => ({
    item,
    score,
    ranges,
  }));

  return limit === undefined ? matches : matches.slice(0, Math.max(0, limit));
}
