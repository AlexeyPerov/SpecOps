import { describe, expect, it } from 'vitest'

import { deriveUntitledTitle, pathBasename, replaceBasename, stableDocIdForPath } from './paths'

describe('stableDocIdForPath', () => {
  it('normalizes backslashes to forward slashes', () => {
    expect(stableDocIdForPath('C:\\Users\\test\\doc.md')).toBe('C:/Users/test/doc.md')
  })
})

describe('pathBasename', () => {
  it('extracts final segment', () => {
    expect(pathBasename('/tmp/docs/readme.md')).toBe('readme.md')
  })
  it('returns whole string when no slash', () => {
    expect(pathBasename('file.txt')).toBe('file.txt')
  })
})

describe('replaceBasename', () => {
  it('replaces final segment', () => {
    expect(replaceBasename('/tmp/old.md', 'new.md')).toBe('/tmp/new.md')
  })
})

describe('deriveUntitledTitle', () => {
  it('uses first non-empty line', () => {
    expect(deriveUntitledTitle('\n  \nHello World\nline2')).toBe('Hello World')
  })

  it('trims whitespace from first line', () => {
    expect(deriveUntitledTitle('  Hello  ')).toBe('Hello')
  })

  it('caps at 60 characters', () => {
    const long = 'a'.repeat(80)
    expect(deriveUntitledTitle(long)).toBe('a'.repeat(60))
    expect(deriveUntitledTitle(long).length).toBe(60)
  })

  it('returns Untitled for empty content', () => {
    expect(deriveUntitledTitle('')).toBe('Untitled')
    expect(deriveUntitledTitle('\n\n  \n')).toBe('Untitled')
  })
})
