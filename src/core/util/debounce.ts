/** Schedule trailing-edge invocation of `fn` after `waitMs`. `.flush()` runs immediately (preview-on-open). */
export interface DebouncedFunction {
  (): void
  flush(): void
}

export function debounce(fn: () => void, waitMs: number): DebouncedFunction {
  let timer: ReturnType<typeof setTimeout> | undefined

  const wrapped = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn()
    }, waitMs)
  }

  wrapped.flush = () => {
    clearTimeout(timer)
    timer = undefined
    fn()
  }

  return wrapped
}
