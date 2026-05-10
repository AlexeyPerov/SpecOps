export interface EditorSnapshot {
  readonly value: string
  readonly selStart: number
  readonly selEnd: number
}

/** Bounded undo/redo for textarea buffer + selection. Managed stack (always intercept when depth allows). */
export function createEditorHistory(maxDepth: number): {
  clear: () => void
  push: (snap: EditorSnapshot) => void
  peekUndo: () => EditorSnapshot | undefined
  undo: (current: EditorSnapshot) => EditorSnapshot | null
  redo: (current: EditorSnapshot) => EditorSnapshot | null
  canUndo: () => boolean
  canRedo: () => boolean
} {
  const undoStack: EditorSnapshot[] = []
  const redoStack: EditorSnapshot[] = []

  function trimUndo(): void {
    while (undoStack.length > maxDepth) undoStack.shift()
  }

  return {
    clear(): void {
      undoStack.length = 0
      redoStack.length = 0
    },
    push(snap: EditorSnapshot): void {
      undoStack.push(snap)
      trimUndo()
      redoStack.length = 0
    },
    peekUndo(): EditorSnapshot | undefined {
      return undoStack[undoStack.length - 1]
    },
    undo(current: EditorSnapshot): EditorSnapshot | null {
      if (!undoStack.length) return null
      const prev = undoStack.pop()!
      redoStack.push(current)
      return prev
    },
    redo(current: EditorSnapshot): EditorSnapshot | null {
      if (!redoStack.length) return null
      const next = redoStack.pop()!
      undoStack.push(current)
      return next
    },
    canUndo(): boolean {
      return undoStack.length > 0
    },
    canRedo(): boolean {
      return redoStack.length > 0
    }
  }
}
