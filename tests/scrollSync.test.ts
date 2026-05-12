// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { getScrollFraction, maxScrollTop, setScrollFraction } from '../src/renderer/editor/scrollSync'

function fakeScrollable(el: Partial<Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>>): {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
} {
  const state = {
    scrollHeight: el.scrollHeight ?? 0,
    clientHeight: el.clientHeight ?? 0,
    scrollTop: el.scrollTop ?? 0
  }
  return state as unknown as { scrollHeight: number; clientHeight: number; scrollTop: number }
}

describe('scrollSync', () => {
  it('maxScrollTop is non-negative', () => {
    const el = fakeScrollable({ scrollHeight: 100, clientHeight: 40 })
    expect(maxScrollTop(el as HTMLElement)).toBe(60)
    const short = fakeScrollable({ scrollHeight: 40, clientHeight: 100 })
    expect(maxScrollTop(short as HTMLElement)).toBe(0)
  })

  it('getScrollFraction and setScrollFraction round-trip', () => {
    const el = fakeScrollable({ scrollHeight: 200, clientHeight: 100, scrollTop: 50 })
    expect(getScrollFraction(el as HTMLElement)).toBeCloseTo(50 / 100, 5)
    setScrollFraction(el as HTMLElement, 0.25)
    expect(el.scrollTop).toBeCloseTo(25, 5)
    setScrollFraction(el as HTMLElement, 1)
    expect(el.scrollTop).toBe(100)
    setScrollFraction(el as HTMLElement, -1)
    expect(el.scrollTop).toBe(0)
  })
})
