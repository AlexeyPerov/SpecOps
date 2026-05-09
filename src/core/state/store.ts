import type { AppAction, AppState } from './types'
import { createInitialAppState, reduceAppState } from './transitions'

export interface AppStore {
  getState(): AppState
  dispatch(action: AppAction, nowIso?: string): void
  subscribe(listener: () => void): () => void
}

export function createAppStore(initial?: AppState): AppStore {
  let state = initial ?? createInitialAppState()
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    dispatch(action: AppAction, nowIso?: string) {
      state = reduceAppState(state, action, nowIso ?? new Date().toISOString())
      listeners.forEach((l) => l())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
