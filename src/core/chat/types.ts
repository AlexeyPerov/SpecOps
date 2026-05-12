/** Chat domain (RR-03): per-project threads and messages; no vendor transport in core. */

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  readonly id: string
  readonly role: ChatRole
  readonly body: string
  /** ISO-8601 */
  readonly createdAtIso: string
}

export interface ChatThread {
  readonly id: string
  readonly title: string
  readonly createdAtIso: string
}

/**
 * In-memory chat slice for a project. Maps match other `ProjectState` fields.
 */
export interface ChatState {
  readonly threadsById: ReadonlyMap<string, ChatThread>
  readonly activeThreadId: string | null
  readonly messagesByThreadId: ReadonlyMap<string, readonly ChatMessage[]>
}
