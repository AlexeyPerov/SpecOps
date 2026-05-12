import { describe, expect, it } from 'vitest'

import {
  normalizeAbsolutePathArg,
  normalizeRenamePathsPayload,
  normalizeWriteTextFilePayload
} from './ipcPayloadNormalize'

describe('ipcPayloadNormalize', () => {
  it('normalizeAbsolutePathArg rejects non-strings and blanks', () => {
    expect(normalizeAbsolutePathArg(null)).toBeNull()
    expect(normalizeAbsolutePathArg(1)).toBeNull()
    expect(normalizeAbsolutePathArg('')).toBeNull()
    expect(normalizeAbsolutePathArg('   ')).toBeNull()
  })

  it('normalizeAbsolutePathArg resolves to absolute path', () => {
    const r = normalizeAbsolutePathArg('/tmp/specops-ipc-test')
    expect(r).toMatch(/^\/tmp\/specops-ipc-test$/)
  })

  it('normalizeWriteTextFilePayload requires string content and valid path', () => {
    expect(normalizeWriteTextFilePayload(null)).toBeNull()
    expect(normalizeWriteTextFilePayload({})).toBeNull()
    expect(
      normalizeWriteTextFilePayload({ absolutePath: '/tmp/x', content: 'body' })
    ).toEqual({ absolutePath: expect.stringMatching(/\/tmp\/x$/), content: 'body' })
    expect(normalizeWriteTextFilePayload({ absolutePath: '/tmp/x', content: null })).toBeNull()
  })

  it('normalizeRenamePathsPayload rejects equal paths', () => {
    expect(
      normalizeRenamePathsPayload({ fromPath: '/tmp/a', toPath: '/tmp/a' })
    ).toBeNull()
  })

  it('normalizeRenamePathsPayload accepts distinct absolute paths', () => {
    const r = normalizeRenamePathsPayload({ fromPath: '/tmp/old', toPath: '/tmp/new' })
    expect(r).not.toBeNull()
    expect(r!.fromPath).toMatch(/\/tmp\/old$/)
    expect(r!.toPath).toMatch(/\/tmp\/new$/)
  })
})
