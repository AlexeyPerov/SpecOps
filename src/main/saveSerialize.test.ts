import { describe, expect, it } from 'vitest'

import { createSaveQueue } from './saveSerialize'

describe('createSaveQueue', () => {
  it('runs tasks for the same window id sequentially', async () => {
    const q = createSaveQueue()
    const order: number[] = []
    const p1 = q.enqueue(9, async () => {
      await new Promise((r) => setTimeout(r, 15))
      order.push(1)
    })
    const p2 = q.enqueue(9, async () => {
      order.push(2)
    })
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  })

  it('allows parallel tasks for different window ids', async () => {
    const q = createSaveQueue()
    const order: string[] = []
    const p1 = q.enqueue(1, async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push('a')
    })
    const p2 = q.enqueue(2, async () => {
      order.push('b')
    })
    await Promise.all([p1, p2])
    expect(order[0]).toBe('b')
    expect(order).toContain('a')
  })
})
