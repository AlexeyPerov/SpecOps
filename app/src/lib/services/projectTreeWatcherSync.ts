/** Serializes native watch registration and retries failures without UI churn. */
export function createProjectTreeWatcherSync(deps: {
  sync: (roots: readonly string[]) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  let desired: readonly string[] | null = null;
  let requested = 0;
  let completed = 0;
  let running = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1000;
  let generation = 0;
  let onSynced: (() => void) | undefined;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const run = async (): Promise<void> => {
    if (running || desired === null || completed === requested) return;
    running = true;
    const startedGeneration = generation;
    const revision = requested;
    const roots = desired;
    let succeeded = false;
    try {
      await deps.sync(roots);
      if (startedGeneration !== generation) return;
      completed = revision;
      retryDelay = 1000;
      succeeded = true;
      if (revision === requested) onSynced?.();
    } catch (error) {
      if (startedGeneration !== generation) return;
      deps.onError(error);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void run();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    } finally {
      running = false;
      if (startedGeneration !== generation || revision !== requested || succeeded) {
        clearRetry();
        if (desired !== null && completed !== requested) void run();
      }
    }
  };

  return {
    request(roots: readonly string[], afterSync?: () => void) {
      desired = [...roots];
      onSynced = afterSync;
      requested += 1;
      clearRetry();
      void run();
    },
    recover() {
      if (desired === null || desired.length === 0) return;
      requested += 1;
      clearRetry();
      void run();
    },
    dispose() {
      generation += 1;
      desired = null;
      onSynced = undefined;
      clearRetry();
    },
  };
}
