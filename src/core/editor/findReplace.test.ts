import { describe, expect, it } from 'vitest'

import {
  buildSearchPattern,
  findMatchCovering,
  findNext,
  findPrevious,
  replaceAllLiteral
} from './findReplace'

describe('buildSearchPattern', () => {
  it('rejects invalid regex mode pattern', () => {
    const r = buildSearchPattern('[', { caseSensitive: false, regex: true })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected failure')
    expect(r.error.length).toBeGreaterThan(0)
  })

  it('escapes literal dots in non-regex mode', () => {
    const r = buildSearchPattern('a.b', { caseSensitive: true, regex: false })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.pattern.test('a.b')).toBe(true)
    expect(r.pattern.test('axb')).toBe(false)
  })
})

describe('findNext', () => {
  it('wraps to first match after last occurrence', () => {
    const text = 'foo bar foo'
    const m = findNext(text, 9, 9, 'foo', { caseSensitive: true, regex: false })
    expect(m).toEqual({ start: 0, end: 3 })
  })

  it('finds next after caret', () => {
    const text = 'foo bar foo'
    const m = findNext(text, 1, 1, 'foo', { caseSensitive: true, regex: false })
    expect(m).toEqual({ start: 8, end: 11 })
  })

  it('honors case insensitive literal mode', () => {
    const text = 'Foo foo'
    const m = findNext(text, 0, 0, 'foo', { caseSensitive: false, regex: false })
    expect(m).toEqual({ start: 0, end: 3 })
  })
})

describe('findPrevious', () => {
  it('wraps from start to last match', () => {
    const text = 'foo bar foo'
    const m = findPrevious(text, 0, 0, 'foo', { caseSensitive: true, regex: false })
    expect(m).toEqual({ start: 8, end: 11 })
  })

  it('finds previous before caret', () => {
    const text = 'foo bar foo'
    const m = findPrevious(text, 9, 9, 'foo', { caseSensitive: true, regex: false })
    expect(m).toEqual({ start: 0, end: 3 })
  })
})

describe('findMatchCovering', () => {
  it('detects selection equal to a match', () => {
    const text = 'foo bar foo'
    const m = findMatchCovering(text, 8, 11, 'foo', { caseSensitive: true, regex: false })
    expect(m).toEqual({ start: 8, end: 11 })
  })

  it('returns null when selection does not align with a match', () => {
    const text = 'foo bar foo'
    expect(findMatchCovering(text, 9, 11, 'foo', { caseSensitive: true, regex: false })).toBeNull()
  })
})

describe('replaceAllLiteral', () => {
  it('replaces all literal occurrences without regex interpretation', () => {
    expect(replaceAllLiteral('a.b.c', '.', '-', { caseSensitive: true, regex: false })).toBe('a-b-c')
  })
})
