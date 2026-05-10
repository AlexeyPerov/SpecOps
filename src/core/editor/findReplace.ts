export interface FindReplaceFlags {
  readonly caseSensitive: boolean
  readonly regex: boolean
}

export interface TextMatch {
  readonly start: number
  readonly end: number
}

export type FindPatternResult =
  | { readonly ok: true; readonly pattern: RegExp }
  | { readonly ok: false; readonly error: string }

/** Builds a global RegExp for scanning `text`. */
export function buildSearchPattern(find: string, flags: FindReplaceFlags): FindPatternResult {
  if (!flags.regex) {
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    try {
      return { ok: true, pattern: new RegExp(escaped, flags.caseSensitive ? 'g' : 'gi') }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Invalid pattern'
      }
    }
  }
  try {
    return { ok: true, pattern: new RegExp(find, flags.caseSensitive ? 'g' : 'gi') }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid regex'
    }
  }
}

function collectMatches(text: string, pattern: RegExp): TextMatch[] {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  const matches: TextMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length })
    if (m[0].length === 0) {
      re.lastIndex++
      if (re.lastIndex > text.length) break
    }
  }
  return matches
}

/** Next match at or after caret end (`Math.max(selStart, selEnd)`), else wrap to first match. */
export function findNext(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  find: string,
  flags: FindReplaceFlags
): TextMatch | null {
  if (!find) return null
  const built = buildSearchPattern(find, flags)
  if (!built.ok) return null
  const matches = collectMatches(text, built.pattern)
  if (!matches.length) return null
  const anchor = Math.max(selectionStart, selectionEnd)
  for (const mt of matches) {
    if (mt.start >= anchor) return mt
  }
  return matches[0] ?? null
}

/** Previous match ending before/at caret start (`Math.min(selStart, selEnd)`), else wrap to last match. */
export function findPrevious(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  find: string,
  flags: FindReplaceFlags
): TextMatch | null {
  if (!find) return null
  const built = buildSearchPattern(find, flags)
  if (!built.ok) return null
  const matches = collectMatches(text, built.pattern)
  if (!matches.length) return null
  const anchor = Math.min(selectionStart, selectionEnd)
  for (let i = matches.length - 1; i >= 0; i--) {
    const mt = matches[i]!
    if (mt.end <= anchor) return mt
  }
  return matches[matches.length - 1] ?? null
}

/** Whether the current selection exactly covers one search match. */
export function findMatchCovering(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  find: string,
  flags: FindReplaceFlags
): TextMatch | null {
  if (!find) return null
  const built = buildSearchPattern(find, flags)
  if (!built.ok) return null
  const lo = Math.min(selectionStart, selectionEnd)
  const hi = Math.max(selectionStart, selectionEnd)
  const matches = collectMatches(text, built.pattern)
  const hit = matches.find((m) => m.start === lo && m.end === hi)
  return hit ?? null
}

/** Literal replacement only (function replacer avoids `$` interpolation in replacement string). */
export function replaceAllLiteral(text: string, find: string, replaceWith: string, flags: FindReplaceFlags): string {
  if (!find) return text
  const built = buildSearchPattern(find, flags)
  if (!built.ok) return text
  return text.replace(built.pattern, () => replaceWith)
}
