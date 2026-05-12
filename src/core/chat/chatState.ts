import type { ChatMessage, ChatRole, ChatState, ChatThread } from './types'

/** JSON snapshot embedded in session v2 per project (see `sessionCodec`). */
export interface ChatStatePersistedV1 {
  readonly threads: readonly ChatThread[]
  readonly activeThreadId: string | null
  readonly messagesByThread: readonly {
    readonly threadId: string
    readonly messages: readonly ChatMessage[]
  }[]
}

const CHAT_ROLES: readonly ChatRole[] = ['user', 'assistant', 'system']

export function createEmptyChatState(): ChatState {
  return {
    threadsById: new Map(),
    activeThreadId: null,
    messagesByThreadId: new Map()
  }
}

export function chatStateToPersisted(state: ChatState): ChatStatePersistedV1 {
  const threads = [...state.threadsById.values()]
  const messagesByThread = [...state.messagesByThreadId.entries()].map(([threadId, messages]) => ({
    threadId,
    messages: [...messages]
  }))
  return {
    threads,
    activeThreadId: state.activeThreadId,
    messagesByThread
  }
}

function isChatRole(x: unknown): x is ChatRole {
  return typeof x === 'string' && (CHAT_ROLES as readonly string[]).includes(x)
}

function parseMessage(raw: unknown): ChatMessage | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : null
  const role = isChatRole(o.role) ? o.role : null
  const body = typeof o.body === 'string' ? o.body : null
  const createdAtIso = typeof o.createdAtIso === 'string' ? o.createdAtIso : null
  if (!id || !role || body === null || !createdAtIso) return null
  return { id, role, body, createdAtIso }
}

function parseThread(raw: unknown): ChatThread | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : null
  const title = typeof o.title === 'string' ? o.title : null
  const createdAtIso = typeof o.createdAtIso === 'string' ? o.createdAtIso : null
  if (!id || title === null || !createdAtIso) return null
  return { id, title, createdAtIso }
}

/** Restore chat from persisted JSON; invalid fragments are dropped. */
export function chatStateFromPersisted(p: ChatStatePersistedV1 | undefined | null): ChatState {
  if (!p || typeof p !== 'object') return createEmptyChatState()

  const threadsById = new Map<string, ChatThread>()
  const threadIds = new Set<string>()
  if (Array.isArray(p.threads)) {
    for (const t of p.threads) {
      const thread = parseThread(t)
      if (thread && !threadsById.has(thread.id)) {
        threadsById.set(thread.id, thread)
        threadIds.add(thread.id)
      }
    }
  }

  const messagesByThreadId = new Map<string, ChatMessage[]>()
  if (Array.isArray(p.messagesByThread)) {
    for (const block of p.messagesByThread) {
      if (block === null || typeof block !== 'object') continue
      const threadId = typeof (block as { threadId?: unknown }).threadId === 'string'
        ? (block as { threadId: string }).threadId
        : null
      if (!threadId || !threadIds.has(threadId)) continue
      const rawMsgs = (block as { messages?: unknown }).messages
      if (!Array.isArray(rawMsgs)) continue
      const msgs: ChatMessage[] = []
      for (const m of rawMsgs) {
        const pm = parseMessage(m)
        if (pm) msgs.push(pm)
      }
      messagesByThreadId.set(threadId, msgs)
    }
  }

  const activeThreadId =
    typeof p.activeThreadId === 'string' && threadIds.has(p.activeThreadId) ? p.activeThreadId : null

  return {
    threadsById,
    activeThreadId,
    messagesByThreadId
  }
}

/**
 * Narrow unknown JSON to a persisted chat blob; returns `undefined` if unusable.
 * Used at the main-process persistence boundary (RR-04.2).
 */
export function tryParseChatStatePersisted(raw: unknown): ChatStatePersistedV1 | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.threads) || !Array.isArray(o.messagesByThread)) return undefined
  if (o.activeThreadId !== null && typeof o.activeThreadId !== 'string') return undefined

  const threads: ChatThread[] = []
  for (const t of o.threads) {
    const pt = parseThread(t)
    if (pt) threads.push(pt)
  }

  const messagesByThread: ChatStatePersistedV1['messagesByThread'] = []
  for (const block of o.messagesByThread) {
    if (block === null || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (typeof b.threadId !== 'string') continue
    if (!Array.isArray(b.messages)) continue
    const messages: ChatMessage[] = []
    for (const m of b.messages) {
      const pm = parseMessage(m)
      if (pm) messages.push(pm)
    }
    messagesByThread.push({ threadId: b.threadId, messages })
  }

  return {
    threads,
    activeThreadId: o.activeThreadId === null ? null : o.activeThreadId,
    messagesByThread
  }
}
