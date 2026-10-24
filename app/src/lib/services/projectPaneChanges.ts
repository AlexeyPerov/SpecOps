import type { FileWatcherEventKind } from "./fileWatcher";

type Listener = (path: string, kind: FileWatcherEventKind) => void;
const listeners = new Set<Listener>();
/** Shares the existing runtime watcher; the pane never registers another native watch. */
export function notifyProjectPaneChange(path: string, kind: FileWatcherEventKind): void {
  for (const listener of listeners) listener(path, kind);
}
export function subscribeProjectPaneChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
