/**
 * Narrow notification seam for document disk reloads → session cache invalidation.
 * Listeners are registered by the route that owns the session cache.
 */
type DocumentReloadListener = (documentId: string) => void;

const listeners = new Set<DocumentReloadListener>();

export function subscribeDocumentDiskReload(
  listener: DocumentReloadListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyDocumentDiskReload(documentId: string): void {
  if (!documentId) {
    return;
  }
  for (const listener of listeners) {
    listener(documentId);
  }
}
