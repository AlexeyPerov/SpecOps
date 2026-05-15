import { describe, expect, it } from 'vitest'

import {
  resolveContainedScanRoot,
  sanitizeMarkdownScanFolderLines,
  sanitizeMarkdownScanRelativeFolderLine,
  sanitizeMarkdownScanRelativeFolders
} from './markdownScanFolders'

describe('markdownScanFolders', () => {
  it('sanitizes single-line paths', () => {
    expect(sanitizeMarkdownScanRelativeFolderLine('specs')).toBe('specs')
    expect(sanitizeMarkdownScanRelativeFolderLine('./specs')).toBe('specs')
    expect(sanitizeMarkdownScanRelativeFolderLine('/specs')).toBe('specs')
    expect(sanitizeMarkdownScanRelativeFolderLine('docs\\notes')).toBe('docs/notes')
  })

  it('rejects path escapes and empties', () => {
    expect(sanitizeMarkdownScanRelativeFolderLine('../evil')).toBeNull()
    expect(sanitizeMarkdownScanRelativeFolderLine('a/../b')).toBeNull()
    expect(sanitizeMarkdownScanRelativeFolderLine('')).toBeNull()
    expect(sanitizeMarkdownScanRelativeFolderLine('C:\\somewhere')).toBeNull()
  })

  it('sanitizes multiline block', () => {
    expect(sanitizeMarkdownScanFolderLines('specs\n./docs/a')).toEqual(['specs', 'docs/a'])
    expect(sanitizeMarkdownScanFolderLines('../evil')).toEqual([])
  })

  it('dedupes ordered folders list', () => {
    expect(sanitizeMarkdownScanRelativeFolders(['specs', 'specs', './specs'])).toEqual(['specs'])
  })

  it('resolveContainedScanRoot keeps paths inside project root', () => {
    expect(resolveContainedScanRoot('/proj', 'specs')).toBe('/proj/specs')
    expect(resolveContainedScanRoot('/proj/', 'nested/md-root')).toBe('/proj/nested/md-root')
    expect(resolveContainedScanRoot('/proj', '../outside')).toBeNull()
  })
})
