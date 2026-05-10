/** Serialize async work per browser window (Electron webContents id) for NR-07-style save ordering. */
export function createSaveQueue(): {
  enqueue: <T>(webContentsId: number, task: () => Promise<T>) => Promise<T>
} {
  const tails = new Map<number, Promise<unknown>>()

  return {
    enqueue<T>(webContentsId: number, task: () => Promise<T>): Promise<T> {
      const prev = tails.get(webContentsId) ?? Promise.resolve()
      const next = prev.catch(() => undefined).then(() => task())
      tails.set(
        webContentsId,
        next.then(
          () => undefined,
          () => undefined
        )
      )
      return next
    }
  }
}
