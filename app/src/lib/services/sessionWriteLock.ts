/**
 * Serializes read-modify-write access to shared `session.json`.
 *
 * Both window session persistence and the open-file registry mutate the same
 * file. Without a queue, concurrent RMWs from different windows (or a persist
 * racing a registry sync) can drop entries.
 *
 * Callers that nest multiple session mutations must run them inside a single
 * {@link withSessionWriteLock} callback (use unlocked helpers), not nest
 * separate lock acquisitions — awaiting inside a lock would otherwise allow
 * unsafe re-entry.
 */

let writeChain: Promise<void> = Promise.resolve();

/** Run `fn` exclusively against other session.json writers. */
export function withSessionWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Wait until all queued session writes have settled. */
export async function awaitSessionWriteLock(): Promise<void> {
  await writeChain;
}

/** Clears the write chain between unit tests. */
export function resetSessionWriteLockForTests(): void {
  writeChain = Promise.resolve();
}
