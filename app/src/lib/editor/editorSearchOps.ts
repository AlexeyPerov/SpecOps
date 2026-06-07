export function normalizeForSearch(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

export function findNextMatchIndex(
  doc: string,
  query: string,
  caseSensitive: boolean,
  from: number,
): number | null {
  if (query.length === 0) {
    return null;
  }
  const haystack = normalizeForSearch(doc, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let idx = haystack.indexOf(needle, from);
  if (idx === -1) {
    idx = haystack.indexOf(needle, 0);
  }
  if (idx === -1) {
    return null;
  }
  return idx;
}

export function findPreviousMatchIndex(
  doc: string,
  query: string,
  caseSensitive: boolean,
  from: number,
): number | null {
  if (query.length === 0) {
    return null;
  }
  const haystack = normalizeForSearch(doc, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let idx = from > 0 ? haystack.lastIndexOf(needle, from - 1) : -1;
  if (idx === -1) {
    idx = haystack.lastIndexOf(needle);
  }
  if (idx === -1) {
    return null;
  }
  return idx;
}

export function selectionMatchesQuery(
  selectedText: string,
  query: string,
  caseSensitive: boolean,
): boolean {
  return (
    normalizeForSearch(selectedText, caseSensitive) ===
    normalizeForSearch(query, caseSensitive)
  );
}

export function replaceSelectionText(
  text: string,
  from: number,
  to: number,
  replacement: string,
): { text: string; from: number; to: number } {
  const rebuilt = `${text.slice(0, from)}${replacement}${text.slice(to)}`;
  return {
    text: rebuilt,
    from,
    to: from + replacement.length,
  };
}

export function countReplaceAllMatches(
  source: string,
  query: string,
  caseSensitive: boolean,
): number {
  if (query.length === 0) {
    return 0;
  }
  const haystack = normalizeForSearch(source, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let index = 0;
  let count = 0;
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    count += 1;
    index = found + Math.max(1, query.length);
  }
  return count;
}

export function buildReplaceAllChanges(
  source: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { changes: { from: number; to: number; insert: string }[]; count: number } {
  if (query.length === 0) {
    return { changes: [], count: 0 };
  }
  const haystack = normalizeForSearch(source, caseSensitive);
  const needle = normalizeForSearch(query, caseSensitive);
  let index = 0;
  let count = 0;
  const changes: { from: number; to: number; insert: string }[] = [];
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    changes.push({ from: found, to: found + query.length, insert: replacement });
    count += 1;
    index = found + Math.max(1, query.length);
  }
  return { changes, count };
}
