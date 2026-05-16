import { describe, expect, it } from 'vitest'

import { hasNulByte, replacementCharRatio } from './registerFileHandlers'

describe('registerFileHandlers guardrail helpers', () => {
  it('detects NUL bytes', () => {
    expect(hasNulByte(Buffer.from('abc', 'utf8'))).toBe(false)
    expect(hasNulByte(Buffer.from([0x61, 0x00, 0x62]))).toBe(true)
  })

  it('suppresses low replacement-char noise', () => {
    const tinyNoise = `hello${String.fromCharCode(0xfffd)}world`
    expect(replacementCharRatio(tinyNoise)).toBe(0)
  })

  it('returns ratio when replacement chars are substantial', () => {
    const noisy = `${String.fromCharCode(0xfffd).repeat(100)}${'x'.repeat(100)}`
    expect(replacementCharRatio(noisy)).toBeGreaterThan(0.02)
  })
})
