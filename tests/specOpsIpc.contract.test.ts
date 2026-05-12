import { describe, expect, it } from 'vitest'

import { SPEC_OPS_IPC } from '../src/ipc/specOpsIpc'

describe('SPEC_OPS_IPC contract', () => {
  it('channel values are unique', () => {
    const values = Object.values(SPEC_OPS_IPC)
    expect(new Set(values).size).toBe(values.length)
  })
})
