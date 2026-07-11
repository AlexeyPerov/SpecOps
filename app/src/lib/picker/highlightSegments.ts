/**
 * Pure text segmentation for fuzzy match-range highlighting.
 *
 * Splits `text` into highlighted/non-highlighted segments using `ranges`
 * (each `{ start, end }` with exclusive end, indices into `text`). Adjacent or
 * overlapping ranges are merged so the screen-reader label stays a single
 * contiguous string — highlighting is visual only, never fragmenting the
 * accessible label.
 *
 * Used by the Quick Open picker to render `<mark>` spans around matched
 * characters without breaking the `aria-label` on the basename container.
 */

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split `text` into segments, marking which portions are inside `ranges`.
 * Ranges are clamped to `[0, text.length]`; out-of-bounds ranges are dropped.
 */
export function highlightSegments(
  text: string,
  ranges: readonly { start: number; end: number }[],
): HighlightSegment[] {
  if (ranges.length === 0) {
    return [{ text, match: false }];
  }

  const sorted = [...ranges]
    .filter((r) => r.start < r.end && r.start >= 0 && r.end <= text.length)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }

  const out: HighlightSegment[] = [];
  let pos = 0;
  for (const r of merged) {
    if (r.start > pos) {
      out.push({ text: text.slice(pos, r.start), match: false });
    }
    out.push({ text: text.slice(r.start, r.end), match: true });
    pos = r.end;
  }
  if (pos < text.length) {
    out.push({ text: text.slice(pos), match: false });
  }

  return out;
}
