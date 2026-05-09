import { describe, expect, it, vi } from 'vitest'

import { debounce } from './debounce'

describe('debounce', () => {
  it('invokes after waitMs', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('flush runs immediately', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d()
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
